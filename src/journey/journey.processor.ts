import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Job, Worker } from 'bullmq';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import { scrubSecrets } from '../logger/redaction';
import { PrismaService } from '../prisma';
import { JOURNEY_QUEUE } from '../queue/queue.constants';
import type { JourneyJobPayload, JourneyJobResult } from '../queue/journey-job.types';
import { JourneyRepository } from './journey.repository';
import { JourneyRunRepository } from './journey-run.repository';
import type { JourneyPhase } from './journey-run.types';
import { JourneyService } from './journey.service';

/** DI token for processor 設定（worker 並發；由 module 從 JOURNEY_QUEUE_CONCURRENCY 組裝）。 */
export const JOURNEY_PROCESSOR_CONFIG = Symbol('JOURNEY_PROCESSOR_CONFIG');

export interface JourneyProcessorConfig {
  queueConcurrency: number;
}

/**
 * 購買歷程分類 processor（T12.6，FR-33/AC-33.6）。`@Processor('journey')` + `WorkerHost`：
 * `load → classify → persist`，每階段 `updateProgress`（DB + best-effort `job.updateProgress` for SSE）。
 *
 * `JourneyService.classify` 內部已對 LLM 失敗（refusal/content_filter/length）降級 `need_definition`、**不** throw，
 * 故正常路徑恆完成（completed）；此處 catch 只餘基礎設施錯（Prisma/Redis）→ 標 `failed` + rethrow 讓 BullMQ
 * 重試（JOB_ATTEMPTS）。`autorun:false` + `onApplicationBootstrap` 接 config 並發；`onModuleDestroy` 排空 worker（防 hang）。
 */
@Processor(JOURNEY_QUEUE, { autorun: false })
export class JourneyProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(JourneyProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journey: JourneyService,
    private readonly assignments: JourneyRepository,
    private readonly runRepo: JourneyRunRepository,
    @Inject(JOURNEY_PROCESSOR_CONFIG) private readonly config: JourneyProcessorConfig,
  ) {
    super();
  }

  /** 接上 JOURNEY_QUEUE_CONCURRENCY 後才啟動 worker（`@Processor` WorkerOptions 為靜態、讀不到 config）。 */
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

  async process(job: Job<JourneyJobPayload>): Promise<JourneyJobResult> {
    const { runId, analysisId, snapshotId } = job.data;
    try {
      await this.runRepo.markStatus(runId, 'running');
      await this.reportProgress(job, runId, 'loading', 10);

      const keywords = await this.loadKeywords(snapshotId);

      await this.reportProgress(job, runId, 'classifying', 40);
      const staged = await this.journey.classify(keywords);

      await this.reportProgress(job, runId, 'persisting', 80);
      await this.assignments.saveAssignments({ analysisId, snapshotId, staged });

      await this.runRepo.markStatus(runId, 'completed', { keywordCount: staged.length });
      await this.reportProgress(job, runId, 'done', 100);
      return { status: 'completed', keywordCount: staged.length };
    } catch (error) {
      // classify 內部已降級 LLM 失敗、不 throw → 此處只餘基礎設施錯（Prisma/Redis）。rethrow 讓 BullMQ 依
      // JOB_ATTEMPTS 重試。**僅於 attempts 耗盡（BullMQ 不再重試）才標 `failed`**（M12-R9）——否則重試/backoff 窗內
      // DB 會誤顯 `failed`（run 實仍在重試）、且 `failed` 非真終態會擾動 M12-R1 reset。判定式＝ BullMQ `shouldRetryJob`
      // 的同一式（job.js `attemptsMade + 1 < attempts` 取反）。非最終 attempt 不覆寫狀態（維持 attempt 開始的
      // `running`，下次 attempt 再標 `running`）。markStatus 亦 best-effort（DB 全掛時不掩蓋原錯）。
      const msg = scrubSecrets(error instanceof Error ? error.message : String(error));
      this.logger.error(`journey run ${runId} failed: ${msg}`);
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt) {
        await this.runRepo.markStatus(runId, 'failed', { error: msg }).catch(() => undefined);
      }
      throw error;
    }
  }

  /** 進度：寫 DB（GET 讀）+ best-effort `job.updateProgress`（SSE 推送；失敗不阻斷）。 */
  private async reportProgress(
    job: Job<JourneyJobPayload>,
    runId: string,
    phase: JourneyPhase,
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
    });
    return rows.map((row) => (row.data as unknown as SnapshotRowData).text);
  }
}
