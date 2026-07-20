import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Job, Worker } from 'bullmq';
import { mapAiCapture } from '../captures/mapping/ai-mapper';
import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';
import { normalizeText } from '../google-ads/normalize';
import { scrubSecrets } from '../logger/redaction';
import { SERP_AI_PROVIDER, type SerpAiProvider } from '../serp/serpapi-ai.types';
import type { AiSearchJobPayload, AiSearchJobResult } from '../queue/ai-search-job.types';
import { AI_SEARCH_QUEUE } from '../queue/queue.constants';
import { extensionChannelsOf, serpapiChannelsOf } from './ai-search-channels';
import { AiSearchCaptureRepository } from './ai-search-capture.repository';
import { AiSearchRunRepository } from './ai-search-run.repository';
import type { AiSearchPhase } from './ai-search-run.types';

/** DI token for processor 設定（worker 並發；由 module 從 AI_SEARCH_QUEUE_CONCURRENCY 組裝）。 */
export const AI_SEARCH_PROCESSOR_CONFIG = Symbol('AI_SEARCH_PROCESSOR_CONFIG');

export interface AiSearchProcessorConfig {
  queueConcurrency: number;
}

/**
 * AI Search 抓取 processor（T14.6，FR-41/AC-41.2）。`@Processor('ai-search')` + `WorkerHost`：SerpAPI pull（reserved，
 * 關閉時 provider short-circuit null）+ 收 extension push（經 `/captures` 已落 raw `captures`）→ 以 `mapAiCapture`（T14.4
 * 純函式）收斂 + 依 query 集合流 → 落 `ai_search_captures`（以 jobId 關聯）；**某渠道缺 → partial**（不整批失敗，INV-6）。
 *
 * `mapAiCapture` 對 malformed payload 回 `failed`（canonical=null，**不 throw**）、provider degradation 回 null（不 throw），
 * 故正常路徑恆完成（completed/partial）；catch 只餘基礎設施錯（Prisma/Redis）→ 於**最終 attempt**（BullMQ 不再重試）標
 * `failed` 並 rethrow 讓 BullMQ 依 JOB_ATTEMPTS 重試（比照 journey M12-R9）。`autorun:false` + onApplicationBootstrap 接
 * config 並發；`onModuleDestroy` 排空 worker（防 hang）。
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

  async process(job: Job<AiSearchJobPayload>): Promise<AiSearchJobResult> {
    const { runId, ownerId, keywords, channels } = job.data;
    try {
      await this.runRepo.markStatus(runId, 'running');
      await this.reportProgress(job, runId, 'pulling', 20);

      // clean slate：重入列/retry 時清舊合流列，避免重複落列（idempotent re-run）。
      await this.captureRepo.deleteByJobId(runId);

      const merged: AiSearchCanonical[] = [];
      // 1. SerpAPI pull（reserved；關閉時 provider 回 null → 該渠道缺 → partial，零外部呼叫）。
      merged.push(...(await this.pullSerpapi(serpapiChannelsOf(channels), keywords)));

      await this.reportProgress(job, runId, 'collecting', 60);
      // 2. extension push（經 `/captures` 已落 raw）：讀 owner 範圍內指定渠道 → 收斂 + 依 query 集合流。
      merged.push(
        ...(await this.collectExtension(ownerId, extensionChannelsOf(channels), keywords)),
      );

      await this.reportProgress(job, runId, 'persisting', 85);
      const captureCount = await this.captureRepo.persistCanonical(runId, ownerId, merged);

      // partial（INV-6）：任一請求渠道零 capture → partial（該格 null，不整批失敗）；全覆蓋 → completed。
      const covered = new Set(merged.map((capture) => capture.channel));
      const status = channels.some((channel) => !covered.has(channel)) ? 'partial' : 'completed';
      await this.runRepo.markStatus(runId, status, { captureCount });
      // INV-3: the run is now durably terminal (completed/partial). The trailing 'done' tick is
      // cosmetic (SSE/GET) — write it best-effort so a transient DB/SSE error can never throw into
      // the catch and flip the already-committed terminal status to `failed` (#578, M14-R2).
      await this.reportProgressBestEffort(job, runId, 'done', 100);
      return { status, captureCount };
    } catch (error) {
      // 只餘基礎設施錯（mapper/provider 皆不 throw）。**僅最終 attempt**（BullMQ 不再重試）才標 failed（否則重試窗內
      // DB 誤顯 failed、擾動 reset）；判定式＝ BullMQ `shouldRetryJob` 的同一式（比照 journey M12-R9）。markStatus best-effort。
      const msg = scrubSecrets(error instanceof Error ? error.message : String(error));
      this.logger.error(`ai-search run ${runId} failed: ${msg}`);
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt) {
        await this.runRepo.markStatus(runId, 'failed', { error: msg }).catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * SerpAPI reserved pull（AC-41.2）：僅對請求到的 serpapi 渠道發送；provider 於 `SERPAPI_AI_ENABLED=false` 短路回 null
   * （degradation，非拋）→ 該渠道無 capture → partial。回**非 null** 的 canonical（source=serpapi）。
   */
  private async pullSerpapi(
    channels: CaptureChannel[],
    keywords: string[],
  ): Promise<AiSearchCanonical[]> {
    const out: AiSearchCanonical[] = [];
    if (channels.includes('aiOverview')) {
      for (const result of await this.serpAi.fetchAiOverviews(keywords)) {
        if (result.aiOverview) {
          out.push(result.aiOverview);
        }
      }
    }
    if (channels.includes('aiMode')) {
      for (const result of await this.serpAi.fetchAiModes(keywords)) {
        if (result.aiMode) {
          out.push(result.aiMode);
        }
      }
    }
    if (channels.includes('bingCopilot')) {
      for (const result of await this.serpAi.fetchBingCopilot(keywords)) {
        if (result.copilot) {
          out.push(result.copilot);
        }
      }
    }
    return out;
  }

  /**
   * extension push 合流（AC-41.2）：讀 owner 範圍內指定渠道的 raw capture（`POST /captures` 已落）→ `mapAiCapture`
   * 收斂 → 只留可映（非 failed）且 query 命中請求關鍵字集（共用 `normalizeText`，去重/快取同一規則）者。
   */
  private async collectExtension(
    ownerId: string | null,
    channels: CaptureChannel[],
    keywords: string[],
  ): Promise<AiSearchCanonical[]> {
    if (channels.length === 0) {
      return [];
    }
    const raw = await this.captureRepo.readRawExtensionCaptures({ ownerId, channels });
    const wanted = new Set(keywords.map((keyword) => normalizeText(keyword)));
    const out: AiSearchCanonical[] = [];
    for (const row of raw) {
      const { canonical } = mapAiCapture({
        source: row.source,
        channel: row.channel,
        schemaVersion: row.schemaVersion,
        payload: row.payload,
        capturedAt: row.capturedAt,
      });
      if (canonical && wanted.has(normalizeText(canonical.query))) {
        out.push(canonical);
      }
    }
    return out;
  }

  /** 進度：寫 DB（GET 讀）+ best-effort `job.updateProgress`（SSE 推送；失敗不阻斷）。 */
  private async reportProgress(
    job: Job<AiSearchJobPayload>,
    runId: string,
    phase: AiSearchPhase,
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

  /**
   * 終態後的 'done' 進度 tick：run 已 durably 落 completed/partial，此寫入純為顯示（SSE/GET）。整段 best-effort
   * （吞 DB 寫入錯 + observability log，比照 `reportProgress` 的 `job.updateProgress` publish 慣例）——**絕不**讓瞬時
   * 錯誤 throw 進 catch 而覆寫已 committed 的終態（INV-3，#578）。
   */
  private async reportProgressBestEffort(
    job: Job<AiSearchJobPayload>,
    runId: string,
    phase: AiSearchPhase,
    percent: number,
  ): Promise<void> {
    try {
      await this.reportProgress(job, runId, phase, percent);
    } catch (error) {
      this.logger.warn(
        `terminal progress write failed (best-effort): ${scrubSecrets(String(error))}`,
      );
    }
  }
}
