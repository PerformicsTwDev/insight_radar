import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import type { ExpandParams } from '../google-ads/google-ads.service';
import type { Keyword } from '../google-ads/keyword.types';
import { IntentService } from '../intent/intent.service';
import { KEYWORD_ANALYSIS_QUEUE } from '../queue/queue.constants';
import type {
  AnalysisJobPayload,
  AnalysisParams,
  AnalysisProgress,
} from './keyword-analysis.service';

/** 取數策略：mode → GoogleAdsService 方法。避免 if/else 蔓延（重構重點）。 */
type FetchStrategy = (
  ads: GoogleAdsService,
  seeds: string[],
  params: ExpandParams,
) => Promise<Keyword[]>;

const FETCH_STRATEGIES: Record<AnalysisParams['mode'], FetchStrategy> = {
  expand: (ads, seeds, params) => ads.expand(seeds, params),
  exact: (ads, seeds, params) => ads.fetchHistoricalMetrics(seeds, params),
};

/** 階段完成時的累積進度百分比（fetch→metrics→intent，intent 完成＝100）。 */
const PHASE_PERCENT = { fetch: 40, metrics: 60, intent: 100 } as const;

/**
 * KeywordAnalysisProcessor（T3.5，FR-12/13、NFR-1）。`@Processor` + `WorkerHost`：
 * 依 `params.mode` 取數（expand / exact）→ 指標（兩模式皆「同一回應即帶指標」，無額外 API）→
 * 貼標（IntentService）→ 每階段 `updateProgress`，回 `{count}`。
 *
 * 範圍邊界：Ads ~1 QPS/CID 集中式限流器為 T3.6、LLM p-limit 並發為 T3.7、ResultSnapshot
 * 固化（`resultSnapshotId`）為 T3.10——本 task 只負責三階段編排骨架與 mode 分流。
 * worker `concurrency` 由 config 設定（T3.6/§14 WORKER_CONCURRENCY）。
 */
@Processor(KEYWORD_ANALYSIS_QUEUE)
export class KeywordAnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(KeywordAnalysisProcessor.name);

  constructor(
    private readonly ads: GoogleAdsService,
    private readonly intent: IntentService,
  ) {
    super();
  }

  async process(job: Job<AnalysisJobPayload>): Promise<{ count: number }> {
    const { seeds, params } = job.data;

    // phase 1：取數（依 mode 分流；指標同回應夾帶）。job.data 為反序列化 JSON、非型別保證，
    // 故顯式守 unknown mode（拋非重試性錯誤，避免 FETCH_STRATEGIES[undefined] 變 TypeError 而耗盡 attempts）。
    const fetchStrategy = FETCH_STRATEGIES[params.mode];
    if (!fetchStrategy) {
      throw new Error(`Unknown analysis mode: ${String(params.mode)}`);
    }
    const keywords = await fetchStrategy(this.ads, seeds, toExpandParams(params));
    await this.report(job, 'fetch', keywords.length);

    // phase 2：指標（兩模式皆已隨取數回應帶回，無額外 Ads 呼叫）。
    await this.report(job, 'metrics', keywords.length);

    // phase 3：貼標（intent）。以 normalizedText 為 key 貼標。
    await this.intent.labelKeywords(keywords.map((k) => k.normalizedText));
    await this.report(job, 'intent', keywords.length);

    return { count: keywords.length };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AnalysisJobPayload>, error: Error): void {
    this.logger.error(`Analysis ${job?.id ?? 'unknown'} failed: ${error.message}`);
  }

  private async report(
    job: Job<AnalysisJobPayload>,
    phase: keyof typeof PHASE_PERCENT,
    total: number,
  ): Promise<void> {
    const progress: AnalysisProgress = { phase, percent: PHASE_PERCENT[phase], total };
    await job.updateProgress(progress);
  }
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
