import { buildGenerateKeywordIdeasRequest } from './ads-request.builder';
import type { AdsClient, RawKeywordIdeaMetrics } from './ads-client.port';
import type { Keyword, KeywordCandidate, KeywordMetrics } from './keyword.types';
import { mapCompetition, mapCompetitionIndex } from './mapping/map-competition';
import { mapMetrics } from './mapping/map-metrics';
import { mapMonthlyVolumes } from './mapping/map-monthly-volumes';
import { chunkSeeds } from './chunk';
import { dedupeMerge, normalizeText } from './normalize';

export interface ExpandParams {
  geo: string;
  language: string;
  currencyCode: string;
  network?: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
  includeAdult?: boolean;
}

/** 缺指標時的攤平預設值（cpc/competition/avg 全 null、monthlyVolumes 空）。 */
const NO_METRICS = {
  avgMonthlySearches: null,
  competition: 'UNSPECIFIED' as const,
  competitionIndex: null,
  cpcLow: null,
  cpcHigh: null,
  cpcLowMicros: null,
  cpcHighMicros: null,
  monthlyVolumes: [],
};

/**
 * Google Ads 服務（拓展模式編排，FR-2）。串接 chunk → generateKeywordIdeas → map → dedupeMerge。
 *
 * - 拓展字與指標來自**同一回應**（`keywordIdeaMetrics`），**不**為拓展字另發 historical metrics。
 * - 外部 client 經 `AdsClient` Port 注入（DI 可 mock；完整 Adapter 見 T1.8）。
 */
export class GoogleAdsService {
  constructor(private readonly client: AdsClient) {}

  async expand(seeds: string[], params: ExpandParams): Promise<Keyword[]> {
    const seedKeys = new Set(seeds.map(normalizeText));
    // 使用者原字一律納入（source=seed）。
    const candidates: KeywordCandidate[] = seeds.map((text) => ({ text, source: 'seed' }));

    for (const batch of chunkSeeds(seeds)) {
      const req = buildGenerateKeywordIdeasRequest(batch, params);
      const results = await this.client.generateKeywordIdeas(req);
      const batchOrigins = batch.map(normalizeText);
      for (const result of results) {
        const normalized = normalizeText(result.text);
        const isSeed = seedKeys.has(normalized);
        candidates.push({
          text: result.text,
          source: isSeed ? 'seed' : 'expanded',
          metrics: this.toMetrics(result.keywordIdeaMetrics, params.currencyCode),
          // 拓展字記 seedOrigins = 產生它的那批 seeds（跨批由 dedupeMerge union）。
          seedOrigins: isSeed ? undefined : batchOrigins,
        });
      }
    }

    return dedupeMerge(candidates).map((kw) => this.flatten(kw));
  }

  /** 把原始 keywordIdeaMetrics 映射為 KeywordMetrics；缺指標回 undefined。 */
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
      competitionIndex: mapCompetitionIndex(raw.competitionIndex),
      monthlyVolumes: mapMonthlyVolumes(raw.monthlySearchVolumes),
    };
  }

  /** 攤平 DedupedKeyword（nested metrics）為最終 Keyword。 */
  private flatten(kw: ReturnType<typeof dedupeMerge>[number]): Keyword {
    const m = kw.metrics;
    return {
      text: kw.text,
      normalizedText: kw.normalizedText,
      source: kw.source,
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
        : NO_METRICS),
      currencyCode: m?.currencyCode,
    };
  }
}
