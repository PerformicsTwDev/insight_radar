import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Job, Worker } from 'bullmq';
import { scrubSecrets } from '../logger/redaction';
import { SERP_AI_PROVIDER, type SerpAiProvider } from '../serp/serpapi-ai.types';
import { AI_SEARCH_QUEUE } from '../queue/queue.constants';
import type { AiSearchJobPayload, AiSearchJobResult } from '../queue/ai-search-job.types';
import { AiSearchCaptureRepository } from './ai-search-capture.repository';
import { AiSearchRunRepository } from './ai-search-run.repository';

/** DI token for processor 設定（worker 並發；由 module 從 AI_SEARCH_QUEUE_CONCURRENCY 組裝）。 */
export const AI_SEARCH_PROCESSOR_CONFIG = Symbol('AI_SEARCH_PROCESSOR_CONFIG');

export interface AiSearchProcessorConfig {
  queueConcurrency: number;
}

/**
 * AI Search 抓取 processor（T14.6，FR-41/AC-41.2）。`@Processor('ai-search')` + `WorkerHost`：SerpAPI pull（reserved，
 * 關閉時 short-circuit null）+ 收 extension push（經 `/captures` 已落 raw）→ 以 `mapAiCapture` 收斂 + 依 query 集合流 →
 * 落 `ai_search_captures`（以 jobId 關聯）；某渠道缺 → partial（不整批失敗，INV-6）。`autorun:false` + onApplicationBootstrap
 * 接 config 並發；`onModuleDestroy` 排空 worker（防 hang）。（`process` 實作於 green。）
 */
@Processor(AI_SEARCH_QUEUE, { autorun: false })
export class AiSearchProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AiSearchProcessor.name);

  constructor(
    @Inject(SERP_AI_PROVIDER) private readonly serpAi: SerpAiProvider,
    private readonly runRepo: AiSearchRunRepository,
    private readonly captureRepo: AiSearchCaptureRepository,
    @Inject(AI_SEARCH_PROCESSOR_CONFIG) private readonly config: AiSearchProcessorConfig,
  ) {
    super();
  }

  /** 接上 AI_SEARCH_QUEUE_CONCURRENCY 後才啟動 worker（`@Processor` WorkerOptions 為靜態、讀不到 config）。 */
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

  process(_job: Job<AiSearchJobPayload>): Promise<AiSearchJobResult> {
    void this.serpAi;
    void this.runRepo;
    void this.captureRepo;
    throw new Error('AiSearchProcessor.process not implemented');
  }
}
