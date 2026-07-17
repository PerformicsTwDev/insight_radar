import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow, canAccess } from '../common/owner-scope';
import { scrubSecrets } from '../logger/redaction';
import { PrismaService } from '../prisma';
import { CUSTOM_CLASSIFY_QUEUE } from '../queue/queue.constants';
import type { CustomClassifyJobPayload } from '../queue/custom-classify-job.types';
import type { CustomLabel } from './custom-classify.schema';
import {
  computeCustomClassifyIdempotencyKey,
  computeLabelsHash,
} from './custom-classify-idempotency';
import { CustomClassifyRunRepository } from './custom-classify-run.repository';
import type { CustomClassifyRunParams } from './custom-classify-run.types';

/** DI token for CustomClassifyRunService 設定（由 module 從 cache/azure/queue config 組裝）。 */
export const CUSTOM_CLASSIFY_RUN_CONFIG = Symbol('CUSTOM_CLASSIFY_RUN_CONFIG');

export interface CustomClassifyRunConfig {
  schemaVersion: string;
  deployment: string;
  /** 確認標籤數上限（成本護欄，= `CUSTOM_CLASSIFY_MAX_LABELS`；AC-34.1 標籤上限一體適用）。 */
  maxLabels: number;
  /** 單次歸類的關鍵字數上限（成本護欄）。 */
  maxKeywords: number;
  jobAttempts: number;
  jobBackoffMs: number;
  jobBackoffJitter: number;
}

/** GET .../assignments 回應（run 狀態，供輪詢；label 表另經 POST /query{view:'custom:{cid}'}，T12.9）。 */
export interface CustomClassifyStatusResponse {
  jobId: string;
  status: string;
  progress: unknown;
  keywordCount: number | null;
}

/**
 * CustomClassifyRunService（T12.8，FR-34/AC-34.2）。`create` = **enqueue-only**（NFR-1，不呼叫任何外部 API）：
 * **owner/存在性單點**——`:cid` 必屬 `:id`（否則 404）且 `:id` 分析由 actor 擁有（`assertOwnedRow`，未知/他人→同一
 * 404、param 不可繞，IDOR 單點 S8）→ **空確認標籤→409**（無法建動態 enum）→ **input 上限**（keyword 數 >
 * `maxKeywords`→413，成本護欄）→ 回寫 `custom_classifications.labels`（反映 HITL 確認）→ idempotency（cid +
 * snapshot.checksum + `labelsHash`；改標籤→新 run）→ `createRun`（命中回同一 jobId、不重跑）→ 僅 created 才
 * `queue.add`。入列失敗補償刪孤兒 run。歸類/寫入皆在 worker（processor）。
 */
@Injectable()
export class CustomClassifyRunService {
  private readonly logger = new Logger(CustomClassifyRunService.name);

  constructor(
    @InjectQueue(CUSTOM_CLASSIFY_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly repo: CustomClassifyRunRepository,
    @Inject(CUSTOM_CLASSIFY_RUN_CONFIG) private readonly config: CustomClassifyRunConfig,
  ) {}

  async create(
    analysisId: string,
    classificationId: string,
    labels: CustomLabel[],
    actor: AuthenticatedUser,
  ): Promise<{ jobId: string }> {
    const classification = await this.resolveOwnedClassification(
      analysisId,
      classificationId,
      actor,
    );

    // 空確認標籤 → 409（無法建動態 enum；DTO ArrayMinSize 已擋空陣列，此為服務層防禦）。
    if (labels.length === 0) {
      throw new ConflictException(
        `custom classification ${classificationId} requires at least one confirmed label`,
      );
    }
    // 確認標籤數上限（成本護欄）：AC-34.1 的標籤上限對階段二確認集一體適用——避免無界 taxonomy 撐爆 LLM
    // system prompt（DTO ArrayMaxSize(500) 為 enum 硬上限、此為業務上限 CUSTOM_CLASSIFY_MAX_LABELS）。
    if (labels.length > this.config.maxLabels) {
      throw new PayloadTooLargeException(
        `confirmed labels ${labels.length} exceed custom-classify max ${this.config.maxLabels}`,
      );
    }

    // input 上限（成本護欄）：整批 LLM 歸類成本隨 keyword 數線性上升 → 超過上限拒絕（413）。
    const keywordCount = await this.prisma.snapshotRow.count({
      where: { snapshotId: classification.snapshotId },
    });
    if (keywordCount > this.config.maxKeywords) {
      throw new PayloadTooLargeException(
        `snapshot has ${keywordCount} keywords, exceeds custom-classify max ${this.config.maxKeywords}`,
      );
    }

    // 回寫確認標籤（反映 HITL 確認；last-write-wins）——階段一存草案，此處以確認集為準。
    await this.prisma.customClassification.update({
      where: { id: classificationId },
      data: { labels },
    });

    const snapshot = await this.prisma.resultSnapshot.findUniqueOrThrow({
      where: { id: classification.snapshotId },
      select: { checksum: true },
    });
    const params: CustomClassifyRunParams = {
      schemaVersion: this.config.schemaVersion,
      deployment: this.config.deployment,
      labelsHash: computeLabelsHash(labels),
    };
    const idempotencyKey = computeCustomClassifyIdempotencyKey(
      classificationId,
      snapshot.checksum,
      params,
    );

    const { runId, created } = await this.repo.createRun({
      classificationId,
      keywordAnalysisId: analysisId,
      snapshotId: classification.snapshotId,
      idempotencyKey,
      params,
    });

    // idempotency 命中（created=false）→ 既有 run，不重複 enqueue。
    if (created) {
      const payload: CustomClassifyJobPayload = {
        runId,
        analysisId,
        classificationId,
        snapshotId: classification.snapshotId,
        labels, // 此 run 的確認標籤快照（對齊 labelsHash）——processor 據此歸類、不重讀 live labels
        params,
      };
      try {
        // reset 的 run 沿用同一 jobId：先移除 BullMQ failed set 內的舊 job（新 run 為 no-op）才能以同 jobId 重加（M12-R1）。
        await this.queue.remove(runId).catch(() => undefined);
        await this.queue.add(CUSTOM_CLASSIFY_QUEUE, payload, {
          jobId: runId,
          attempts: this.config.jobAttempts,
          backoff: {
            type: 'exponential',
            delay: this.config.jobBackoffMs,
            jitter: this.config.jobBackoffJitter,
          },
        });
      } catch (error) {
        // 入列失敗（Redis 短暫不可用）→ 標 failed（**非** delete）：刪除會使並發 idempotent 202 已回的 jobId 變 404
        // （M12-R7）；標 failed 則可由後續重送 reset 重入列（M12-R1），並發輪詢見 failed 非 404。
        this.logger.error(`enqueue custom-classify job failed: ${scrubSecrets(String(error))}`);
        await this.repo.markStatus(runId, 'failed', {
          error: `enqueue failed: ${scrubSecrets(String(error))}`,
        });
        throw error;
      }
    }

    return { jobId: runId };
  }

  /** 取某分類定義最新 run 狀態（GET；無 run→404；進行中→回其 status，client 續輪詢）。 */
  async getStatus(
    analysisId: string,
    classificationId: string,
    actor: AuthenticatedUser,
  ): Promise<CustomClassifyStatusResponse> {
    await this.resolveOwnedClassification(analysisId, classificationId, actor);
    const run = await this.repo.findLatestRunByClassification(classificationId);
    if (!run) {
      throw new NotFoundException(`no custom-classify run for classification ${classificationId}`);
    }
    return {
      jobId: run.id,
      status: run.status,
      progress: run.progress,
      keywordCount: run.keywordCount,
    };
  }

  /**
   * SSE 用輕量 run 參照：(analysisId, cid) → 最新 run 的 {runId, status}（SSE key=runId，因 queue.add jobId=runId）。
   * owner 過濾用 `canAccess`（非 assertOwnedRow）避免 SSE 路徑拋例外——他人/未知/cid 不屬 :id → null → 空串流。
   */
  async getRunRef(
    analysisId: string,
    classificationId: string,
    actor: AuthenticatedUser,
  ): Promise<{ runId: string; status: string } | null> {
    const classification = await this.prisma.customClassification.findUnique({
      where: { id: classificationId },
      select: { analysisId: true },
    });
    if (!classification || classification.analysisId !== analysisId) {
      return null;
    }
    const owner = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { ownerId: true },
    });
    if (!owner || !canAccess(owner, actor)) {
      return null;
    }
    const run = await this.repo.findLatestRunByClassification(classificationId);
    return run ? { runId: run.id, status: run.status } : null;
  }

  /**
   * owner/存在性單點（S8，IDOR）：`:cid` 必存在且 `analysisId === :id`（否則 404），且 `:id` 分析由 actor 擁有
   * （`assertOwnedRow`：未知/他人 → 同一 404、param 不可繞）。回 classification（含 snapshotId）。
   */
  private async resolveOwnedClassification(
    analysisId: string,
    classificationId: string,
    actor: AuthenticatedUser,
  ): Promise<{ snapshotId: string }> {
    const classification = await this.prisma.customClassification.findUnique({
      where: { id: classificationId },
      select: { analysisId: true, snapshotId: true },
    });
    // cid 未知、或不屬此 :id → 404（同一訊息、不洩漏存在性）。
    if (!classification || classification.analysisId !== analysisId) {
      throw new NotFoundException(`custom classification ${classificationId} not found`);
    }
    const owner = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { ownerId: true },
    });
    assertOwnedRow(owner, actor, `custom classification ${classificationId} not found`);
    return { snapshotId: classification.snapshotId };
  }
}
