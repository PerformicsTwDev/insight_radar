import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { googleAdsConfig } from '../config/google-ads.config';
import {
  buildGenerateKeywordIdeasRequest,
  buildHistoricalMetricsRequest,
} from './ads-request.builder';
import { ADS_CLIENT } from './ads-client.port';
import type { AdsClient, RawKeywordIdeaMetrics } from './ads-client.port';
import type { Keyword, KeywordCandidate, KeywordMetrics } from './keyword.types';
import { mapCompetition, mapCompetitionIndex } from './mapping/map-competition';
import { mapMetrics } from './mapping/map-metrics';
import { mapMonthlyVolumes } from './mapping/map-monthly-volumes';
import { chunkHistorical, chunkSeeds } from './chunk';
import { dedupeMerge, normalizeText } from './normalize';

export interface ExpandParams {
  geo: string;
  language: string;
  currencyCode: string;
  network?: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
  includeAdult?: boolean;
  /** 每批大小；省略 → config（GOOGLE_ADS_SEED/HISTORICAL_BATCH_SIZE）→ chunk 預設。 */
  batchSize?: number;
}

/** 指定模式參數（同 ExpandParams）。 */
export type HistoricalParams = ExpandParams;

/** 缺指標時的攤平預設值（cpc/competition/avg 全 null、monthlyVolumes 空）。每列回傳新物件，避免共享 `[]`。 */
function noMetrics() {
  return {
    avgMonthlySearches: null,
    competition: 'UNSPECIFIED' as const,
    competitionIndex: null,
    cpcLow: null,
    cpcHigh: null,
    cpcLowMicros: null,
    cpcHighMicros: null,
    monthlyVolumes: [],
  };
}

/**
 * Google Ads 服務（拓展模式編排，FR-2）。串接 chunk → generateKeywordIdeas → map → dedupeMerge。
 *
 * - 拓展字與指標來自**同一回應**（`keyword_idea_metrics`），**不**為拓展字另發 historical metrics。
 * - 外部 client 經 `AdsClient` Port 注入（DI 可 mock；完整 Adapter 見 T1.8）。
 */
@Injectable()
export class GoogleAdsService {
  constructor(
    @Inject(ADS_CLIENT) private readonly client: AdsClient,
    @Optional()
    @Inject(googleAdsConfig.KEY)
    private readonly config?: ConfigType<typeof googleAdsConfig>,
  ) {}

  async expand(seeds: string[], params: ExpandParams): Promise<Keyword[]> {
    const seedKeys = new Set(seeds.map(normalizeText));
    // 使用者原字一律納入（source=seed）。
    const candidates: KeywordCandidate[] = seeds.map((text) => ({ text, source: 'seed' }));

    const batchSize = params.batchSize ?? this.config?.seedBatchSize;
    for (const batch of chunkSeeds(seeds, batchSize)) {
      const req = buildGenerateKeywordIdeasRequest(batch, params);
      const results = await this.client.generateKeywordIdeas(req);
      const batchOrigins = batch.map(normalizeText);
      for (const result of results) {
        const normalized = normalizeText(result.text);
        const isSeed = seedKeys.has(normalized);
        candidates.push({
          text: result.text,
          source: isSeed ? 'seed' : 'expanded',
          metrics: this.toMetrics(result.keyword_idea_metrics, params.currencyCode),
          // 拓展字記 seedOrigins = 產生它的那批 seeds（跨批由 dedupeMerge union）。
          seedOrigins: isSeed ? undefined : batchOrigins,
        });
      }
    }

    return dedupeMerge(candidates).map((kw) => this.flatten(kw, params));
  }

  /**
   * 指定模式（FR-13，TC-34）：對使用者指定關鍵字取歷史指標，**不拓展**，輸出全部 `source='seed'`。
   *
   * - 批次 ≤ `GOOGLE_ADS_HISTORICAL_BATCH_SIZE`（預設 1000，硬上限 10,000）。
   * - 上游 near-exact 聚合 close variants（輸入↔輸出非 1:1）：以 `text` + `close_variants` 的
   *   normalizedText 把結果對回**每個**原始輸入，並記於 `seedOrigins`。
   * - 找不到對應資料的輸入 → 仍輸出一列（無指標 seed 列，不漏輸入）。
   * - 指標映射與 expand **共用同一 mapper**（micros/competition/monthlyVolumes）。
   */
  async fetchHistoricalMetrics(keywords: string[], params: HistoricalParams): Promise<Keyword[]> {
    const candidates: KeywordCandidate[] = [];
    const covered = new Set<string>();

    const batchSize = params.batchSize ?? this.config?.historicalBatchSize;
    for (const batch of chunkHistorical(keywords, batchSize)) {
      const req = buildHistoricalMetricsRequest(batch, params);
      const results = await this.client.generateKeywordHistoricalMetrics(req);
      const batchKeys = batch.map(normalizeText);
      for (const result of results) {
        // 把此列對回它涵蓋的原始輸入（text 自身 + close_variants），限定在本批輸入內。
        const variantKeys = [result.text, ...(result.close_variants ?? [])].map(normalizeText);
        const origins = batchKeys.filter((k) => variantKeys.includes(k));
        // 對不到任何使用者輸入的列直接略過（輸出只含使用者輸入，AC-13.2）。
        if (origins.length === 0) {
          continue;
        }
        for (const key of origins) {
          covered.add(key);
        }
        candidates.push({
          text: result.text,
          source: 'seed', // 指定模式所有列皆 seed
          metrics: this.toMetrics(result.keyword_metrics, params.currencyCode),
          seedOrigins: origins,
        });
      }
    }

    // 無對應資料的輸入 → 補無指標 seed 列（不漏輸入）。
    for (const keyword of keywords) {
      if (!covered.has(normalizeText(keyword))) {
        candidates.push({ text: keyword, source: 'seed' });
      }
    }

    return dedupeMerge(candidates).map((kw) => this.flatten(kw, params));
  }

  /** 把原始 keyword(Idea)Metrics 映射為 KeywordMetrics；缺指標回 undefined。 */
  private toMetrics(
    raw: RawKeywordIdeaMetrics | null | undefined,
    currencyCode: string,
  ): KeywordMetrics | undefined {
    if (!raw) {
      return undefined;
    }
    const metrics = mapMetrics(raw, currencyCode);
    return {
      ...metrics,
      competition: mapCompetition(raw.competition),
      competitionIndex: mapCompetitionIndex(raw.competition_index),
      monthlyVolumes: mapMonthlyVolumes(raw.monthly_search_volumes),
    };
  }

  /** 攤平 DedupedKeyword（nested metrics）為最終 Keyword；從 params 蓋上 geo/language（canonical key）。 */
  private flatten(kw: ReturnType<typeof dedupeMerge>[number], params: ExpandParams): Keyword {
    const m = kw.metrics;
    return {
      text: kw.text,
      normalizedText: kw.normalizedText,
      source: kw.source,
      geo: params.geo,
      language: params.language,
      ...(kw.seedOrigins ? { seedOrigins: kw.seedOrigins } : {}),
      ...(m
        ? {
            avgMonthlySearches: m.avgMonthlySearches,
            competition: m.competition,
            competitionIndex: m.competitionIndex,
            cpcLow: m.cpcLow,
            cpcHigh: m.cpcHigh,
            cpcLowMicros: m.cpcLowMicros,
            cpcHighMicros: m.cpcHighMicros,
            monthlyVolumes: m.monthlyVolumes,
          }
        : noMetrics()),
      currencyCode: m?.currencyCode,
    };
  }
}
