import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Job, Worker } from 'bullmq';
import { normalizeText } from '../google-ads/normalize';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import { scrubSecrets } from '../logger/redaction';
import { PrismaService } from '../prisma';
import { CUSTOM_CLASSIFY_QUEUE } from '../queue/queue.constants';
import type {
  CustomClassifyJobPayload,
  CustomClassifyJobResult,
} from '../queue/custom-classify-job.types';
import { CustomClassifyAssignService } from './custom-classify-assign.service';
import { CustomClassifyAssignRepository } from './custom-classify-assign.repository';
import { CustomClassifyRunRepository } from './custom-classify-run.repository';
import type { CustomClassifyPhase } from './custom-classify-run.types';

/** DI token for processor 設定（worker 並發；由 module 從 CUSTOM_CLASSIFY_QUEUE_CONCURRENCY 組裝）。 */
export const CUSTOM_CLASSIFY_PROCESSOR_CONFIG = Symbol('CUSTOM_CLASSIFY_PROCESSOR_CONFIG');

export interface CustomClassifyProcessorConfig {
  queueConcurrency: number;
}

/**
 * 自訂分類階段二 processor（T12.8，FR-34/AC-34.2）。`@Processor('custom-classify')` + `WorkerHost`：
 * `load labels + keywords → classify（動態 enum）→ persist`，每階段 `updateProgress`（DB + best-effort
 * `job.updateProgress` for SSE）。確認標籤由 run-service 回寫 `custom_classifications.labels`，此處讀出。
 *
 * `CustomClassifyAssignService.classifyByLabels` 內部已對 LLM 失敗（refusal/content_filter/length）降級 sentinel
 * `unclassified`、**不** throw，故正常路徑恆完成（completed）；此處 catch 只餘基礎設施錯（Prisma/Redis）→ 標
 * `failed` + rethrow 讓 BullMQ 重試。`autorun:false` + `onApplicationBootstrap` 接 config 並發；`onModuleDestroy`
 * 排空 worker（防 hang）。
 */
@Processor(CUSTOM_CLASSIFY_QUEUE, { autorun: false })
export class CustomClassifyAssignProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CustomClassifyAssignProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assign: CustomClassifyAssignService,
    private readonly assignments: CustomClassifyAssignRepository,
    private readonly runRepo: CustomClassifyRunRepository,
    @Inject(CUSTOM_CLASSIFY_PROCESSOR_CONFIG)
    private readonly config: CustomClassifyProcessorConfig,
  ) {
    super();
  }

  /** 接上 CUSTOM_CLASSIFY_QUEUE_CONCURRENCY 後才啟動 worker（`@Processor` WorkerOptions 為靜態、讀不到 config）。 */
  onApplicationBootstrap(): Promise<void> {
    const worker = this.worker;
    worker.concurrency = this.config.queueConcurrency;
    void worker.run().catch((error: unknown) => {
      this.logger.error(`worker run() failed: ${scrubSecrets(String(error))}`);
    });
    return Promise.resolve();
  }

  /** Graceful shutdown：排空 in-flight job（讀 backing `_worker`，未初始化時安全 no-op）。 */
  async onModuleDestroy(): Promise<void> {
    const worker = (this as unknown as { _worker?: Worker })._worker;
    if (worker) {
      await worker.close();
    }
  }

  async process(job: Job<CustomClassifyJobPayload>): Promise<CustomClassifyJobResult> {
    const { runId, classificationId, snapshotId, labels } = job.data;
    try {
      await this.runRepo.markStatus(runId, 'running');
      await this.reportProgress(job, runId, 'loading', 10);

      // 標籤取自 payload（此 run 建立當下的快照，對齊 labelsHash）——不重讀 live `custom_classifications.labels`，
      // 避免同 cid 快速連續 HITL 改動時舊 run 以新標籤歸類（reviewer #490）。
      const keywords = await this.loadKeywords(snapshotId);

      await this.reportProgress(job, runId, 'classifying', 40);
      const assigned = await this.assign.classifyByLabels(classificationId, labels, keywords);

      await this.reportProgress(job, runId, 'persisting', 80);
      await this.assignments.saveAssignments(
        classificationId,
        assigned.map((a) => ({ normalizedText: normalizeText(a.keyword), label: a.label })),
      );

      await this.runRepo.markStatus(runId, 'completed', { keywordCount: assigned.length });
      await this.reportProgress(job, runId, 'done', 100);
      return { status: 'completed', keywordCount: assigned.length };
    } catch (error) {
      // classify 內部已降級 LLM 失敗、不 throw → 此處只餘基礎設施錯（Prisma/Redis）。rethrow 讓 BullMQ 依
      // JOB_ATTEMPTS 重試。**僅於 attempts 耗盡（BullMQ 不再重試）才標 `failed`**（M12-R9，與 journey 同構）——否則
      // 重試/backoff 窗內 DB 誤顯 `failed`（run 實仍在重試）、且 `failed` 非真終態會擾動 M12-R1 reset。判定式＝ BullMQ
      // `shouldRetryJob` 同一式（`attemptsMade + 1 < attempts` 取反）。非最終 attempt 不覆寫狀態（維持 `running`）。
      const msg = scrubSecrets(error instanceof Error ? error.message : String(error));
      this.logger.error(`custom-classify run ${runId} failed: ${msg}`);
      // 註：此為**預測式**判定（假設 BullMQ 只因 attempts 耗盡而終止）。本 processor 的 catch **從不** throw
      // `UnrecoverableError`／呼叫 `job.discard()`，且未用會回 -1 的自訂 backoff，故此預測與 BullMQ 實際決策一致。
      // 若未來引入上述任一，改採 keyword-analysis.processor 的事後式 `@OnWorkerEvent('failed')` + `isTerminalFailure(job)`
      // （查 `job.finishedOn`）以免預測失準致 run 卡 `running`。
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt) {
        await this.runRepo.markStatus(runId, 'failed', { error: msg }).catch(() => undefined);
      }
      throw error;
    }
  }

  /** 進度：寫 DB（GET 讀）+ best-effort `job.updateProgress`（SSE 推送；失敗不阻斷）。 */
  private async reportProgress(
    job: Job<CustomClassifyJobPayload>,
    runId: string,
    phase: CustomClassifyPhase,
    percent: number,
  ): Promise<void> {
    const progress = { phase, percent };
    await this.runRepo.updateProgress(runId, progress);
    try {
      await job.updateProgress(progress);
    } catch (error) {
      this.logger.warn(`job progress publish failed (best-effort): ${scrubSecrets(String(error))}`);
    }
  }

  /** 讀不可變 snapshot 的關鍵字原字（依 rowIndex 序）；classify 以原字入、後處理以 normalizedText 對回。 */
  private async loadKeywords(snapshotId: string): Promise<string[]> {
    const rows = await this.prisma.snapshotRow.findMany({
      where: { snapshotId },
      orderBy: { rowIndex: 'asc' },
      select: { data: true }, // 只取 data（各字僅用 .text；避免 5000 列過取，M12-C2）
    });
    return rows.map((row) => (row.data as unknown as SnapshotRowData).text);
  }
}
