import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Job, Worker } from 'bullmq';
import { AiAnalysisService } from '../ai-visibility/ai-analysis.service';
import { mapAiCapture } from '../captures/mapping/ai-mapper';
import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';
import { normalizeText } from '../google-ads/normalize';
import { scrubSecrets } from '../logger/redaction';
import {
  SERP_AI_PROVIDER,
  type SerpAiProvider,
  type SerpCreditLedger,
} from '../serp/serpapi-ai.types';
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
  // M14-R3/#579 [8]：extension raw capture 收斂掃描的回溯視窗（天）+ 筆數上限（防無界掃全歷史）。
  captureLookbackDays: number;
  captureScanLimit: number;
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
    private readonly aiAnalysis: AiAnalysisService,
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
    const { runId, ownerId, keywords, channels, brandProfileId } = job.data;
    try {
      await this.runRepo.markStatus(runId, 'running');
      await this.reportProgress(job, runId, 'pulling', 20);

      // 抓取合流（reuse-on-retry：見 {@link gatherCaptures}，#683/M15-R1）——第一 attempt clean-slate + 兩來源
      // fetch + 落列；BullMQ 重試則重用前次已落庫的合流（不重打 PAID SerpAPI pull → 不重扣 credit）。
      const { merged, captureCount } = await this.gatherCaptures(
        job,
        runId,
        ownerId,
        keywords,
        channels,
      );

      // 分析 stage（T15.5，沿用抓取 job 落點）：合流 captures → 三線 LLM pipeline（品牌/情緒/媒體）→
      // buildAiVisibility → 持久化分析結果 + 指標（clean-slate by jobId，idempotent re-run）。mapper/postProcess
      // 皆補預設不 throw，故正常路徑恆完成；某 query/某線 LLM 降級收斂為 `needsReview`（→ partial，AC-42.5）。
      await this.reportProgress(job, runId, 'analyzing', 92);
      const analysis = await this.aiAnalysis.analyzeAndPersist({
        jobId: runId,
        ownerId,
        brandProfileId,
        captures: merged,
      });

      // partial（INV-6）：任一請求渠道零 capture（抓取缺）**或** 某線/某 query LLM 降級（analysis needsReview>0）
      // → partial（該格 null，不整批失敗）；全覆蓋且分析無降級 → completed。
      const covered = new Set(merged.map((capture) => capture.channel));
      const fetchPartial = channels.some((channel) => !covered.has(channel));
      const status = fetchPartial || analysis.needsReview > 0 ? 'partial' : 'completed';
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
   * 抓取合流 + 落列，回 `{ merged, captureCount }` 供 analysis stage 消費。**重試不重扣 PAID fetch（#683/M15-R1）**：
   *
   * analysis stage 在 PAID SerpAPI pull + 落列**之後**跑；若 analysis 於**非 final** attempt throw，BullMQ 會整個
   * `process()` 從頭重試——若每次都重跑 `pullSerpapi`（每 attempt 一份 fresh `SerpCreditLedger`），SerpAPI credit 會
   * **每次重試重複計費**、爆 per-job `SERPAPI_AI_CREDITS_BUDGET`。故：
   * - **第一 attempt（`attemptsMade === 0`，含 partial-reset 重入列）**：clean-slate → 兩來源 fetch → **落列**（durable
   *   `ai_search_captures` by jobId）。partial-reset 屬新 job 實例（attemptsMade 歸零）→ 走此路重抓，保留其「async 到達
   *   的 extension capture 重送可再收」語意（M14-R3/#579）。
   * - **BullMQ 重試（`attemptsMade > 0`）**：前一 attempt 已完成 PAID pull 並落列（在 throw 的 analysis 之前）→ **重用**
   *   已落庫合流、**不重打供應商、不 clean-slate、不重落列**（無重扣、無重複列）。前一 attempt 若在落列前就 throw
   *   （pull/persist 基礎設施錯）→ 無可重用列 → fall through 走完整 fetch（該情境無 durable 結果可省）。
   *
   * **PAID pull 緊接 persist（M15-R12/#701，補 M15-R1 殘餘窗）**：reuse-on-retry guard 只在 `persistCanonical` 落列後才免
   * 重扣，故 PAID pull 與 persist 之間**不得**夾任何會 throw 的 op（否則非 final attempt 於此 throw → 無 durable 列 →
   * 重試 fall-through 重打供應商重扣）。因此：(a) extension 收斂（DB 讀）**移到 pull 之前**——若其 transient throw，pull
   * 尚未發生 → 乾淨中止、零扣抵、重試僅重抓一次；(b) pull 與 persist 之間僅餘 cosmetic 進度 tick，改 best-effort（吞瞬時
   * DB 錯 + log，比照 INV-3 的 'done' tick #578）**絕不** throw 進 catch 逼出重扣。剩餘唯一重扣窗＝`persistCanonical`
   * 本身 throw（無 durable 列可省，屬不可免、各修法皆同的 accepted trade-off）。
   */
  private async gatherCaptures(
    job: Job<AiSearchJobPayload>,
    runId: string,
    ownerId: string | null,
    keywords: string[],
    channels: CaptureChannel[],
  ): Promise<{ merged: AiSearchCanonical[]; captureCount: number }> {
    if (job.attemptsMade > 0) {
      const persisted = await this.captureRepo.readCanonicalByJobId(runId);
      if (persisted.length > 0) {
        // 重用前次 attempt 已落庫的合流（含 PAID serpapi 列）→ 直接進 analysis，零外部呼叫、零重扣（#683）。
        return { merged: persisted, captureCount: persisted.length };
      }
      // 前次 attempt 落列前即失敗（無 durable 列）→ 落至完整 fetch（re-charge 不可免，但該情境本無可省之結果）。
    }

    // clean slate：重入列/retry 時清舊合流列，避免重複落列（idempotent re-run）。
    await this.captureRepo.deleteByJobId(runId);

    const merged: AiSearchCanonical[] = [];
    // 1. extension push（經 `/captures` 已落 raw）：讀 owner 範圍內指定渠道 → 收斂 + 依 query 集合流。**先於** PAID
    //    pull（M15-R12/#701）——此 DB 讀 transient throw 發生在 pull 之前 → 乾淨中止、零扣抵。
    await this.reportProgress(job, runId, 'collecting', 60);
    merged.push(...(await this.collectExtension(ownerId, extensionChannelsOf(channels), keywords)));

    // 2. SerpAPI PAID pull（reserved；關閉時 provider 回 null → 該渠道缺 → partial，零外部呼叫）。**緊接** persist：
    //    以下僅一個 best-effort 進度 tick，pull 與 persist 之間無會 throw 的 op（M15-R12/#701）。
    merged.push(...(await this.pullSerpapi(serpapiChannelsOf(channels), keywords)));

    await this.reportProgressBestEffort(job, runId, 'persisting', 85);
    const captureCount = await this.captureRepo.persistCanonical(runId, ownerId, merged);
    return { merged, captureCount };
  }

  /**
   * SerpAPI reserved pull（AC-41.2）：僅對請求到的 serpapi 渠道發送；provider 於 `SERPAPI_AI_ENABLED=false` 短路回 null
   * （degradation，非拋）→ 該渠道無 capture → partial。回**非 null** 的 canonical（source=serpapi）。
   */
  private async pullSerpapi(
    channels: CaptureChannel[],
    keywords: string[],
  ): Promise<AiSearchCanonical[]> {
    // 單一 per-job credit ledger（NFR-18 / #581）：跨 aiOverview/aiMode/bingCopilot 三個渠道 method 共用同一
    // SERPAPI_AI_CREDITS_BUDGET（per-job 上限，Design §14）——否則各 method 各起一份 accumulator → 總花費達 N×。
    const ledger: SerpCreditLedger = { spent: 0 };
    // 三渠道僅「請求判定 / fetch method / canonical 欄位」不同，共用同一收斂路徑（M14-R7/#583 [10]，統一原 3 個
    // near-identical loop）；順序 aiOverview→aiMode→bingCopilot 與 ledger 共用不變。
    const out: AiSearchCanonical[] = [];
    out.push(
      ...(await this.pullChannel(
        channels,
        'aiOverview',
        () => this.serpAi.fetchAiOverviews(keywords, ledger),
        (r) => r.aiOverview,
      )),
    );
    out.push(
      ...(await this.pullChannel(
        channels,
        'aiMode',
        () => this.serpAi.fetchAiModes(keywords, ledger),
        (r) => r.aiMode,
      )),
    );
    out.push(
      ...(await this.pullChannel(
        channels,
        'bingCopilot',
        () => this.serpAi.fetchBingCopilot(keywords, ledger),
        (r) => r.copilot,
      )),
    );
    return out;
  }

  /**
   * 單一 serpapi 渠道的收斂（M14-R7/#583 [10]，統一原 3 個 near-identical loop）：僅當該渠道被請求時才 `fetch`
   * （否則零外部呼叫、回 []，保 AC-41.2「只對請求到的渠道發送」）；對回傳逐筆以 `pick` 取 canonical，degradation
   * 的 `null`（無 AIO/失敗/逾時/credit 不足）略過（非拋）。
   */
  private async pullChannel<R>(
    channels: CaptureChannel[],
    channel: CaptureChannel,
    fetch: () => Promise<R[]>,
    pick: (result: R) => AiSearchCanonical | null,
  ): Promise<AiSearchCanonical[]> {
    if (!channels.includes(channel)) {
      return [];
    }
    const out: AiSearchCanonical[] = [];
    for (const result of await fetch()) {
      const canonical = pick(result);
      if (canonical) {
        out.push(canonical);
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
    // 有界掃描（M14-R3/#579 [8]）：回溯視窗（config 天數，job 執行當下計算——支援 async 到達的 capture 於窗內再收）+
    // take 上限（防病態量拉全表 + 全 payload）。keyword 過濾於下方 map 後施加。
    const capturedAfter = new Date(
      Date.now() - this.config.captureLookbackDays * 24 * 60 * 60 * 1000,
    );
    const raw = await this.captureRepo.readRawExtensionCaptures({
      ownerId,
      channels,
      capturedAfter,
      limit: this.config.captureScanLimit,
    });
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
