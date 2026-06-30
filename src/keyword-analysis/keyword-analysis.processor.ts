import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { JobStatus, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import type { ExpandParams } from '../google-ads/google-ads.service';
import type { Keyword, KeywordCandidate } from '../google-ads/keyword.types';
import { normalizeText } from '../google-ads/normalize';
import { IntentService } from '../intent/intent.service';
import type { LabelResult } from '../intent/intent.service';
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
@Processor(KEYWORD_ANALYSIS_QUEUE)
export class KeywordAnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(KeywordAnalysisProcessor.name);

  constructor(
    private readonly ads: GoogleAdsService,
    private readonly intent: IntentService,
    private readonly snapshots: ResultSnapshotService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<AnalysisJobPayload>): Promise<{ count: number }> {
    const { analysisId, seeds, params } = job.data;
    const report = (phase: keyof typeof PHASE_PERCENT, total: number): Promise<void> =>
      this.report(job, phase, total);

    // 推進 DB 狀態機（M3-R1/M-1）：開工標 running+startedAt（條件式，不覆寫已終結 job）。
    await this.markStatus(analysisId, { status: 'running', startedAt: new Date() });

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

    await report('intent', keywords.length); // 貼標 + 固化完成 → 100%
    return { count };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<AnalysisJobPayload>, error: Error): Promise<void> {
    this.logger.error(`Analysis ${job?.id ?? 'unknown'} failed: ${error.message}`);
    // 推進 DB 狀態機（M3-R1/M-1）：標 failed+error+finishedAt（條件式，不覆寫 canceled/completed）。
    // FR-8 輪詢以 DB 為真實來源——未寫則失敗 job 在 DB 永遠停 queued、永不見終態。
    const analysisId = job?.data?.analysisId;
    if (typeof analysisId !== 'string') {
      return;
    }
    await this.markStatus(analysisId, {
      status: 'failed',
      error: error.message,
      finishedAt: new Date(),
    }).catch((persistError: unknown) => {
      this.logger.error(
        `failed to persist 'failed' status for ${analysisId}: ${String(persistError)}`,
      );
    });
  }

  /** 條件式推進 DB 狀態（只在仍非終態時寫，§6.8 終態不可逆；M3-R1）。 */
  private async markStatus(
    analysisId: string,
    data: Prisma.KeywordAnalysisUpdateManyMutationInput,
  ): Promise<void> {
    await this.prisma.keywordAnalysis.updateMany({
      where: { id: analysisId, status: { notIn: [...TERMINAL_STATUSES] } },
      data,
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
      return { keywords: this.ads.mergeExpansion(candidates, params), labels };
    }
    if (mode === 'exact') {
      const keywords = await this.ads.fetchHistoricalMetrics(seeds, params);
      await report('fetch', keywords.length);
      const labels = await this.intent.labelStream([keywords.map((kw) => kw.normalizedText)]);
      return { keywords, labels };
    }
    throw new Error(`Unknown analysis mode: ${String(mode)}`);
  }

  private async report(
    job: Job<AnalysisJobPayload>,
    phase: keyof typeof PHASE_PERCENT,
    total: number,
  ): Promise<void> {
    const progress: AnalysisProgress = { phase, percent: PHASE_PERCENT[phase], total };
    await job.updateProgress(progress); // BullMQ/Redis（SSE / QueueEvents 即時串流）
    // 鏡像到 DB progress 欄（M3-R1/M-2）：getStatus/輪詢（FR-8）以 DB 為真實來源——未鏡像則 progress
    // 永遠停在 {queued,0}（連 completed job 也是）。updateMany 不因 0 列拋錯。
    await this.prisma.keywordAnalysis.updateMany({
      where: { id: job.data.analysisId },
      data: { progress: progress as unknown as Prisma.InputJsonValue },
    });
  }
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
