import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { JobStatus, Prisma } from '@prisma/client';
import { type Job, UnrecoverableError } from 'bullmq';
import { queueConfig } from '../config/queue.config';
import { classifyError, isTerminalJobError } from './error-classification';
import { PrismaService } from '../prisma';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import type { ExpandParams } from '../google-ads/google-ads.service';
import type { Keyword, KeywordCandidate } from '../google-ads/keyword.types';
import { normalizeText } from '../google-ads/normalize';
import { MetricsCache } from '../google-ads/metrics-cache';
import { IntentService } from '../intent/intent.service';
import type { LabelResult } from '../intent/intent.service';
import { scrubSecrets } from '../logger/redaction';
import { KEYWORD_ANALYSIS_QUEUE } from '../queue/queue.constants';
import type { SnapshotRowData } from './result-snapshot.checksum';
import { ResultSnapshotService } from './result-snapshot.service';
import type {
  AnalysisJobPayload,
  AnalysisParams,
  AnalysisProgress,
} from './keyword-analysis.service';

/** 階段完成時的累積進度百分比（fetch→metrics→intent，intent 完成＝100）。 */
const PHASE_PERCENT = { fetch: 40, metrics: 60, intent: 100 } as const;
/** 終態（§6.8）：worker 對 DB 狀態的寫入皆條件式（status notIn 此集）以不覆寫已終結 job。 */
const TERMINAL_STATUSES: readonly JobStatus[] = ['completed', 'failed', 'canceled'];

/**
 * KeywordAnalysisProcessor（T3.5 + T3.7，FR-12/13、NFR-1）。`@Processor` + `WorkerHost`：
 * 依 `params.mode` 取數（expand 串流 / exact 一次取回）→ **邊拓展邊貼標**（A/B overlap，T3.7）→
 * 每階段 `updateProgress`，回 `{count}`。
 *
 * A/B overlap：expand 模式以 `expandStream` 逐批產出關鍵字，立即餵入 `intent.labelStream`
 * （內部 `p-limit(llmConcurrency)` 控 LLM 並發），讓 expand（Ads ~1 QPS 綁死）與 label（LLM 並發）
 * 階段時間重疊（`T_total ≈ max(T_expand,T_label)+尾段`，量測於 T4.5）。Ads 限流（T3.6）、worker
 * concurrency（NFR-8）、LLM p-limit（T3.7）為三個獨立維度。
 *
 * 範圍邊界：ResultSnapshot 固化（`resultSnapshotId`）為 T3.10——本 task 仍只回 `{count}` + 貼標。
 * ⚠ T3.10 注意：`expandStream` 採 first-occurrence 去重，`keywords[]` 為**較低保真**（跨批 seedOrigins
 * union / 指標 merge 未套用）；固化 snapshot 時須改用 `GoogleAdsService.expand`（dedupeMerge 權威），
 * 不可直接重用此處 `expandStream` 來源的 `keywords[]`。
 */
// autorun:false（M3-R2）：BullExplorer 以 decorator 的**靜態** WorkerOptions 建 worker，無法注入 config；
// 故停用 autostart，待 onApplicationBootstrap 接上 config 的 concurrency 後才 run()，避免啟動瞬間以預設 1 跑。
@Processor(KEYWORD_ANALYSIS_QUEUE, { autorun: false })
export class KeywordAnalysisProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(KeywordAnalysisProcessor.name);

  constructor(
    private readonly ads: GoogleAdsService,
    private readonly intent: IntentService,
    private readonly snapshots: ResultSnapshotService,
    private readonly prisma: PrismaService,
    private readonly metricsCache: MetricsCache,
    @Inject(queueConfig.KEY) private readonly config: ConfigType<typeof queueConfig>,
  ) {
    super();
  }

  /**
   * 接上 WORKER_CONCURRENCY（M3-R2/M-3、NFR-8、T3.1 DoD）。`@Processor` 的 WorkerOptions 為靜態、讀不到
   * 已驗證 config → 在此 bootstrap（worker 已由 BullExplorer 於 onModuleInit 建好）設 concurrency 後啟動。
   * BullMQ 預設 concurrency=1，未接上則 NFR-8 的並發失效。run() 在 worker close 前不 resolve，故 fire-and-forget。
   */
  onApplicationBootstrap(): Promise<void> {
    const worker = this.worker;
    worker.concurrency = this.config.workerConcurrency;
    // run() 在 worker close 前不 resolve → fire-and-forget；rejection 以 catch 吞掉（不擋 bootstrap）。
    void worker.run().catch((error: unknown) => {
      this.logger.error(`worker run() failed: ${scrubSecrets(String(error))}`);
    });
    return Promise.resolve();
  }

  async process(job: Job<AnalysisJobPayload>): Promise<{ count: number }> {
    const { analysisId, seeds, params } = job.data;
    const report = (phase: keyof typeof PHASE_PERCENT, total: number): Promise<void> =>
      this.report(job, phase, total);

    // 推進 DB 狀態機（M3-R1/M-1）：開工標 running+startedAt（條件式，不覆寫已終結 job）。
    await this.markStatus(analysisId, { status: 'running', startedAt: new Date() });

    try {
      // 依 mode 取數 + 邊拓展邊貼標（overlap）。**snapshot 用權威 mergeExpansion**（非 first-occurrence）。
      const { keywords, labels } = await this.fetchAndLabel(
        params.mode,
        seeds,
        toExpandParams(params),
        report,
      );
      await report('metrics', keywords.length); // 指標隨取數回應夾帶（無額外 Ads 呼叫）

      // 固化不可變 snapshot（T3.10）：合併 intent（by normalizedText）→ rows → 落 DB + 回填 FK/status。
      const intentByKeyword = new Map(labels.labeled.map((l) => [l.keyword, l.labels]));
      const rows = keywords.map((kw) =>
        toSnapshotRow(kw, intentByKeyword.get(kw.normalizedText) ?? []),
      );
      const { count } = await this.snapshots.saveResult(analysisId, rows);

      // 報 intent/100：DB progress 已由 saveResult 與 status='completed' **原子寫入**（M3-R5）；此處 report 僅
      // 為 SSE/QueueEvents 即時事件（job.updateProgress），其 DB 鏡像因已終態 no-op（不重複寫、亦不覆寫）。
      await report('intent', keywords.length);
      return { count };
    } catch (error) {
      // 兩層重試分工（T7.1，Design §11）：**終態、不重試整 job** ＝ Ads 配額經 job 內退避（T3.6）仍耗盡、
      // Ads 不可重試（InvalidArgument 等）、LLM 內容結果（確定性、重試無益）——皆以 `UnrecoverableError` 收尾，
      // 避免 BullMQ 整 job 重跑重打 Ads/LLM、放大用量。**INFRA/UNKNOWN 照舊原樣拋** → BullMQ 依 `attempts`
      // 整 job 重試（保留無錯誤碼暫時性故障的安全網，不改既有行為）。
      if (isTerminalJobError(classifyError(error))) {
        const message = error instanceof Error ? error.message : String(error);
        throw new UnrecoverableError(message);
      }
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<AnalysisJobPayload>, error: Error): Promise<void> {
    // 祕密不入 log / DB error 欄（NFR-5、§5.1）：上游錯誤訊息可能夾帶連線字串密碼/bearer token。
    const safeMessage = scrubSecrets(error.message);
    this.logger.error(`Analysis ${job?.id ?? 'unknown'} failed: ${safeMessage}`);
    const analysisId = job?.data?.analysisId;
    if (typeof analysisId !== 'string') {
      return;
    }
    // BullMQ 對「每次」失敗都發 failed（含將被重試的中間嘗試）；只有最終態（重試耗盡/不可重試）
    // 才寫 DB failed。否則中途瞬時錯誤把列推進終態 → markStatus/saveResult 皆守 notIn 終態 →
    // 擋掉後續成功重試的 running/completed 寫入，完成的 job 在 DB 永遠停 failed（M3-R1 review）。
    // moveToFailed 僅在非重試分支設 finishedOn（且於 emit 前），故 finishedOn 已設 ⟺ 最終態失敗。
    if (!isTerminalFailure(job)) {
      return;
    }
    // 推進 DB 狀態機（M3-R1/M-1）：標 failed+error+finishedAt（條件式，不覆寫 canceled/completed）。
    // FR-8 輪詢以 DB 為真實來源——未寫則失敗 job 在 DB 永遠停 queued、永不見終態。markStatus 為 best-effort。
    await this.markStatus(analysisId, {
      status: 'failed',
      error: safeMessage,
      finishedAt: new Date(),
    });
  }

  /**
   * 條件式推進 DB 狀態（只在仍非終態時寫，§6.8 終態不可逆；M3-R1）。
   * **best-effort（M3-R6/#2）**：DB 狀態/進度鏡像為 FR-8 輪詢便利，暫時性錯誤**不應**讓 worker 流程失敗
   * 重跑（已成功取數/貼標的 job 不該因一次 progress 寫入失敗而丟棄）。終態正確性由 saveResult/cancel 的
   * 守門寫入保證，非此處。錯誤遮罩後記 warn（NFR-5/#9：Prisma 錯誤可夾帶連線字串密碼）。
   */
  private async markStatus(
    analysisId: string,
    data: Prisma.KeywordAnalysisUpdateManyMutationInput,
  ): Promise<void> {
    await this.prisma.keywordAnalysis
      .updateMany({
        where: { id: analysisId, status: { notIn: [...TERMINAL_STATUSES] } },
        data,
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `markStatus(${analysisId}) failed (best-effort): ${scrubSecrets(String(error))}`,
        );
      });
  }

  /**
   * 依 mode 取數並邊取邊貼標（A/B overlap），回**權威**關鍵字（snapshot 用）+ 貼標結果。
   * - **expand**：`expandStreamRaw` 逐批原始候選 → 取首見 normalizedText 餵 `labelStream`（overlap）→
   *   累積全部候選後 `mergeExpansion`（dedupeMerge 權威：union seedOrigins、擇非空指標，T3.10/FR-2）。
   * - **exact**：指定字已知（`fetchHistoricalMetrics` 已 dedupeMerge）→ 單批貼標。
   * - unknown mode 同步拋非重試性錯誤（job.data 為反序列化 JSON，避免 TypeError 耗盡 attempts）。
   */
  private async fetchAndLabel(
    mode: AnalysisParams['mode'],
    seeds: string[],
    params: ExpandParams,
    report: (phase: keyof typeof PHASE_PERCENT, total: number) => Promise<void>,
  ): Promise<{ keywords: Keyword[]; labels: LabelResult }> {
    if (mode === 'expand') {
      const candidates: KeywordCandidate[] = [];
      const seen = new Set<string>();
      const ads = this.ads;
      async function* texts(): AsyncGenerator<string[]> {
        for await (const batch of ads.expandStreamRaw(seeds, params)) {
          candidates.push(...batch);
          const fresh: string[] = [];
          for (const candidate of batch) {
            const normalized = normalizeText(candidate.text);
            if (!seen.has(normalized)) {
              seen.add(normalized);
              fresh.push(normalized);
            }
          }
          await report('fetch', seen.size);
          if (fresh.length > 0) {
            yield fresh;
          }
        }
      }
      const labels = await this.intent.labelStream(texts());
      // 權威合併（dedupeMerge）→ **回寫 metrics 快取**（T4.4）：expand 須打 Ads 取數，但結果回寫後，未來
      // 同字的 exact 查詢/重跑即命中、省 Ads（兩階段皆 cache-first 的「回寫」半邊）。
      // ⚠ 用 `msetByText`（各字自身 nt 為 key）**非** `mset`：拓展字的 seedOrigins=來源 seed，用 mset 會把
      // 拓展字寫到 seed 的 key、污染 seed 指標（exact 命中即回錯字/錯指標，AC-10.5）。
      const keywords = this.ads.mergeExpansion(candidates, params);
      await this.metricsCache.msetByText(keywords, params);
      return { keywords, labels };
    }
    if (mode === 'exact') {
      const keywords = await this.fetchExactCached(seeds, params);
      await report('fetch', keywords.length);
      const labels = await this.intent.labelStream([keywords.map((kw) => kw.normalizedText)]);
      return { keywords, labels };
    }
    throw new Error(`Unknown analysis mode: ${String(mode)}`);
  }

  /**
   * exact 模式 cache-first（T4.1，FR-10/NFR-4）：先以 `normalizedText` 批查 metrics 快取，**命中省 Ads
   * 呼叫**；只對 cache-miss 打 `fetchHistoricalMetrics`，取回後回寫（之後可命中）。去重 key 與快取 key
   * 共用同一 `normalizeText`，故命中判定與 snapshot 去重一致。
   */
  private async fetchExactCached(seeds: string[], params: ExpandParams): Promise<Keyword[]> {
    const normalized = seeds.map(normalizeText);
    const cached = await this.metricsCache.mget(normalized, params);
    const hits = cached.filter((kw): kw is Keyword => kw !== undefined);
    const missSeeds = seeds.filter((_seed, i) => cached[i] === undefined);
    const fetched =
      missSeeds.length > 0 ? await this.ads.fetchHistoricalMetrics(missSeeds, params) : [];
    if (fetched.length > 0) {
      await this.metricsCache.mset(fetched, params);
    }
    // 依 normalizedText 去重（命中不得改變正確性，AC-10.5）：重複 normalize 的 seed 會回同一命中多次，
    // 且 close-variant 的命中可能與新取的 canonical 撞同字——cold 路徑（fetchHistoricalMetrics 內 dedupeMerge）
    // 為無碰撞，故合併後須去重，否則 snapshot 出現重複列、keywordCount 膨脹、checksum 漂移（NFR-7）。
    return dedupeByNormalizedText([...hits, ...fetched]);
  }

  private async report(
    job: Job<AnalysisJobPayload>,
    phase: keyof typeof PHASE_PERCENT,
    total: number,
  ): Promise<void> {
    const progress: AnalysisProgress = { phase, percent: PHASE_PERCENT[phase], total };
    await job.updateProgress(progress); // BullMQ/Redis（SSE / QueueEvents 即時串流）
    // 鏡像到 DB progress 欄（M3-R1/M-2）：getStatus/輪詢（FR-8）以 DB 為真實來源——未鏡像則 progress
    // 永遠停在 {queued,0}（連 completed job 也是）。經 markStatus 走**條件式**寫入（notIn 終態）：
    // 已 cancel 但仍在跑的 job 不被推回 intent/100（M3-R1 review）。updateMany 不因 0 列拋錯。
    await this.markStatus(job.data.analysisId, {
      progress: progress as unknown as Prisma.InputJsonValue,
    });
  }
}

/**
 * 此次 failed 事件是否為**最終態失敗**（重試耗盡或不可重試），而非將被重試的中間嘗試。
 * BullMQ `moveToFailed` 僅在非重試分支設 `finishedOn`（且於 emit('failed') 前），故 `finishedOn`
 * 已設即最終態；以 `attemptsMade >= attempts` 為文件化備援（涵蓋 attempts 未設等邊界）。
 */
function isTerminalFailure(job: Job<AnalysisJobPayload>): boolean {
  if (job.finishedOn != null) {
    return true;
  }
  const attempts = job.opts?.attempts ?? 1;
  return job.attemptsMade >= attempts;
}

/** 依 `normalizedText` 去重（保留首見；去重 key 與快取 key 共用），讓 cache-warm 結果與 cold 一致。 */
function dedupeByNormalizedText(keywords: Keyword[]): Keyword[] {
  const byNt = new Map<string, Keyword>();
  for (const kw of keywords) {
    if (!byNt.has(kw.normalizedText)) {
      byNt.set(kw.normalizedText, kw);
    }
  }
  return [...byNt.values()];
}

/** Keyword + intent → snapshot 列（攤平 5 欄 + intent；labels 排序使 checksum 確定，NFR-7）。 */
function toSnapshotRow(kw: Keyword, intent: string[]): SnapshotRowData {
  return {
    text: kw.text,
    normalizedText: kw.normalizedText,
    avgMonthlySearches: kw.avgMonthlySearches,
    competition: kw.competition,
    competitionIndex: kw.competitionIndex,
    cpcLow: kw.cpcLow,
    cpcHigh: kw.cpcHigh,
    intent: [...intent].sort(),
    monthlyVolumes: kw.monthlyVolumes,
  };
}

/** AnalysisParams → GoogleAds ExpandParams（currencyCode 由 geo/語言情境決定，此處沿用預設 TWD 由下游覆寫）。 */
function toExpandParams(params: AnalysisParams): ExpandParams {
  return {
    geo: params.geo,
    language: params.language,
    currencyCode: typeof params.currencyCode === 'string' ? params.currencyCode : 'TWD',
    network: params.network as ExpandParams['network'],
    includeAdult: params.includeAdult,
  };
}
