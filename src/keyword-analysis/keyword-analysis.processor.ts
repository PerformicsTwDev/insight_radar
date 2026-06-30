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

/** 階段完成時的累積進度百分比（fetch→metrics→intent，intent 完成＝100）。 */
const PHASE_PERCENT = { fetch: 40, metrics: 60, intent: 100 } as const;

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
    const keywords: Keyword[] = [];

    // 依 mode 取得關鍵字串流（expand 串流逐批；exact 指定字已知 → 單批）。unknown mode 同步拋
    // 非重試性錯誤（job.data 為反序列化 JSON，避免 TypeError 耗盡 attempts）。
    const source = this.keywordSource(params.mode, seeds, toExpandParams(params));

    // 邊拓展邊貼標：拓展批產出即轉成 normalizedText 餵 labelStream（intent 內 p-limit 控並發）。
    const report = (phase: keyof typeof PHASE_PERCENT): Promise<void> =>
      this.report(job, phase, keywords.length);
    async function* texts(): AsyncGenerator<string[]> {
      for await (const batch of source) {
        keywords.push(...batch);
        await report('fetch'); // 取數階段進度（total 隨拓展遞增）
        yield batch.map((k) => k.normalizedText);
      }
    }

    await this.intent.labelStream(texts());

    // 指標兩模式皆隨取數回應夾帶（無額外 Ads 呼叫）；貼標完成 → 100%。
    await report('metrics');
    await report('intent');
    return { count: keywords.length };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AnalysisJobPayload>, error: Error): void {
    this.logger.error(`Analysis ${job?.id ?? 'unknown'} failed: ${error.message}`);
  }

  /** mode → 關鍵字批串流：expand 用 `expandStream`（overlap）、exact 用 `fetchHistoricalMetrics`（單批）。 */
  private keywordSource(
    mode: AnalysisParams['mode'],
    seeds: string[],
    params: ExpandParams,
  ): AsyncIterable<Keyword[]> {
    if (mode === 'expand') {
      return this.ads.expandStream(seeds, params);
    }
    if (mode === 'exact') {
      return onceStream(() => this.ads.fetchHistoricalMetrics(seeds, params));
    }
    throw new Error(`Unknown analysis mode: ${String(mode)}`);
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

/** 把「一次取回」的 fetch 包成單批 async iterable（指定模式無拓展可重疊，仍走同一 labelStream pipeline）。 */
async function* onceStream(fetch: () => Promise<Keyword[]>): AsyncGenerator<Keyword[]> {
  yield await fetch();
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
