import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma, type Keyword as KeywordRow } from '@prisma/client';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import { cacheConfig } from '../config/cache.config';
import { scrubSecrets } from '../logger/redaction';
import { PrismaService } from '../prisma';
import type { Keyword } from './keyword.types';
import type { CompetitionLevel } from './mapping/map-competition';
import type { MonthlySearchVolume } from './mapping/map-monthly-volumes';
import { microsToAmount, parseMicros } from './mapping/micros';

/** metrics 快取所需情境（地區/語言）——ExpandParams / HistoricalParams 的共用子集。 */
export interface MetricsCacheParams {
  geo: string;
  language: string;
}

/**
 * Metrics 快取（T4.1/T4.4/T4.6，FR-10/NFR-4）。**分層**：Redis 為快取、**DB `keywords` 為持久後備**。
 * Redis key = `metrics:{geo}:{lang}:{normalizedText}`；DB PK = `[geo, language, normalizedText]`。批次處理前先
 * `mget`、只對 cache-miss 打 Ads（命中省 `GenerateKeywordIdeas`）。
 *
 * - **mget**：Redis 先查 → miss 落 DB canonical 回填 → 命中即 warm Redis（Redis 失效不致重打全部 Ads，T4.6）。
 * - 去重 key 與快取 key 共用同一 `normalizedText`；TTL 一律**毫秒**（`CACHE_TTL_METRICS_MS`，預設 21 天）。
 * - DB 後備一律以 keyword **自身 `normalizedText`** 為 canonical key；Redis 的 close-variant 別名（seedOrigins）
 *   為 Redis 專屬、失效後落回 canonical（可接受降級）。micros↔BigInt 經共用 mapper（缺值≠0 單點）。
 */
@Injectable()
export class MetricsCache {
  private readonly logger = new Logger(MetricsCache.name);

  constructor(
    private readonly cache: CacheService,
    @Inject(cacheConfig.KEY) private readonly config: ConfigType<typeof cacheConfig>,
    private readonly prisma: PrismaService,
  ) {}

  private keyFor(params: MetricsCacheParams, normalizedText: string): string {
    return this.cache.buildKey(CacheNamespace.METRICS, params.geo, params.language, normalizedText);
  }

  /**
   * 回寫純屬**快取暖機**（writeback）：Redis/DB 寫入失敗只降級為「下次重抓」，**不可**拖垮已付費（Ads/LLM）
   * 的 job——吞錯記 warn（祕密經 {@link scrubSecrets} 清洗），與 markStatus 的 best-effort 一致（M3-R6）。
   */
  private async bestEffort(work: Promise<unknown>, context: string): Promise<void> {
    try {
      await work;
    } catch (error) {
      this.logger.warn(`${context} failed (best-effort): ${scrubSecrets(String(error))}`);
    }
  }

  /** 批次查 metrics（依 `normalizedTexts` 對齊；Redis miss 落 DB 後備、命中即 warm Redis；皆 miss = `undefined`）。 */
  async mget(
    normalizedTexts: string[],
    params: MetricsCacheParams,
  ): Promise<(Keyword | undefined)[]> {
    if (normalizedTexts.length === 0) {
      return [];
    }
    const redis = await this.cache.mget<Keyword>(
      normalizedTexts.map((nt) => this.keyFor(params, nt)),
    );

    const missNts = normalizedTexts.filter((_nt, i) => redis[i] === undefined);
    if (missNts.length === 0) {
      return redis;
    }
    // DB 後備：以 [geo, language, normalizedText] 查 canonical；命中回填 Redis（Redis 失效不重打 Ads）。
    const rows = await this.prisma.keyword.findMany({
      where: {
        geo: params.geo,
        language: params.language,
        normalizedText: { in: [...new Set(missNts)] },
      },
    });
    const dbByNt = new Map(rows.map((r) => [r.normalizedText, rowToKeyword(r)]));
    // warm Redis：best-effort——暖機失敗不可拖垮這次成功的讀取（T4.6）。
    await this.bestEffort(
      Promise.all(
        [...dbByNt.values()].map((kw) =>
          this.cache.set(this.keyFor(params, kw.normalizedText), kw, this.config.metricsTtlMs),
        ),
      ),
      'metrics cache warm',
    );
    return normalizedTexts.map((nt, i) => redis[i] ?? dbByNt.get(nt));
  }

  /**
   * 回寫（writeback）：寫 Redis（以**每個原始輸入** `seedOrigins` 的 nt 為 key——Ads near-exact 聚合把 `'car'`
   * 對回 canonical `'cars'`，故快取在被查詢的輸入上）+ **upsert DB canonical**（以各字自身 nt）。無 `seedOrigins`
   * （無資料 seed 列）→ Redis 退回 `normalizedText`。
   */
  async mset(keywords: Keyword[], params: MetricsCacheParams): Promise<void> {
    // 只回寫**有指標**者（比照 intent 不快取空標籤）：無指標列（expand 未取數的 user seed = noMetrics()）
    // 既無快取價值，又會（a）覆蓋既有有指標 canonical row、（b）成為壓制未來真實抓取的 false null 命中（M4-R1）。
    const persistable = keywords.filter(hasMetrics);
    if (persistable.length === 0) {
      return;
    }
    await this.bestEffort(
      Promise.all([
        ...persistable.flatMap((kw) => {
          const inputs = kw.seedOrigins?.length ? kw.seedOrigins : [kw.normalizedText];
          return inputs.map((input) =>
            this.cache.set(this.keyFor(params, input), kw, this.config.metricsTtlMs),
          );
        }),
        this.upsertDb(persistable, params),
      ]),
      'metrics cache writeback',
    );
  }

  /**
   * 回寫（以**各字自身** `normalizedText` 為 key）：**expand** 拓展字用此（T4.4）。寫 Redis + upsert DB canonical。
   * ⚠ 拓展字的 `seedOrigins` = **來源 seed**（非指標等價輸入），不可用 {@link mset}（會污染 seed 自身指標）。
   */
  async msetByText(keywords: Keyword[], params: MetricsCacheParams): Promise<void> {
    // 同 {@link mset}：跳過無指標列，避免 expand 攤平的 noMetrics() seed 污染 canonical（M4-R1）。
    const persistable = keywords.filter(hasMetrics);
    if (persistable.length === 0) {
      return;
    }
    await this.bestEffort(
      Promise.all([
        ...persistable.map((kw) =>
          this.cache.set(this.keyFor(params, kw.normalizedText), kw, this.config.metricsTtlMs),
        ),
        this.upsertDb(persistable, params),
      ]),
      'metrics cache writeback',
    );
  }

  /** upsert 進 DB canonical `keywords`（持久後備；以各字自身 nt + geo/language 為 PK）。 */
  private async upsertDb(keywords: Keyword[], params: MetricsCacheParams): Promise<void> {
    await Promise.all(
      keywords.map((kw) => {
        const data = keywordToRow(kw, params);
        return this.prisma.keyword.upsert({
          where: {
            geo_language_normalizedText: {
              geo: params.geo,
              language: params.language,
              normalizedText: kw.normalizedText,
            },
          },
          create: data,
          update: data,
        });
      }),
    );
  }
}

/**
 * 此 keyword 是否帶任何指標訊號（M4-R1）。`noMetrics()`（全 null + 空 volumes + competition UNSPECIFIED）→ `false`。
 * 任一指標欄非空即視為有指標——回寫只持久有指標者，無指標列不入快取/canonical（防污染 + 防 false null 命中）。
 */
function hasMetrics(kw: Keyword): boolean {
  return (
    kw.avgMonthlySearches !== null ||
    kw.competitionIndex !== null ||
    kw.cpcLowMicros !== null ||
    kw.cpcHighMicros !== null ||
    kw.competition !== 'UNSPECIFIED' ||
    kw.monthlyVolumes.length > 0
  );
}

/** DB `keywords` 列 → 領域 `Keyword`（micros→金額經共用 mapper，缺值≠0；source 不存於 canonical，預設 seed）。 */
function rowToKeyword(row: KeywordRow): Keyword {
  const cpcLowMicros = row.cpcLowMicros?.toString() ?? null;
  const cpcHighMicros = row.cpcHighMicros?.toString() ?? null;
  return {
    text: row.text,
    normalizedText: row.normalizedText,
    source: 'seed',
    geo: row.geo,
    language: row.language,
    avgMonthlySearches: row.avgMonthlySearches,
    competition: (row.competition ?? 'UNSPECIFIED') as CompetitionLevel,
    competitionIndex: row.competitionIndex,
    cpcLow: microsToAmount(cpcLowMicros),
    cpcHigh: microsToAmount(cpcHighMicros),
    cpcLowMicros,
    cpcHighMicros,
    currencyCode: row.currencyCode ?? undefined,
    monthlyVolumes: row.monthlyVolumes as unknown as MonthlySearchVolume[],
  };
}

/**
 * 領域 `Keyword` → DB `keywords` 寫入資料（micros→BigInt 經共用 mapper）。`metricsFetchedAt` 顯式寫入
 * 「現在」：upsert 的 **update** 分支不會重跑 `@default(now())`，故須在此蓋上新鮮時間戳以追蹤 canonical 新鮮度。
 */
function keywordToRow(kw: Keyword, params: MetricsCacheParams): Prisma.KeywordUncheckedCreateInput {
  return {
    geo: params.geo,
    language: params.language,
    normalizedText: kw.normalizedText,
    text: kw.text,
    avgMonthlySearches: kw.avgMonthlySearches,
    competition: kw.competition,
    competitionIndex: kw.competitionIndex,
    cpcLowMicros: parseMicros(kw.cpcLowMicros),
    cpcHighMicros: parseMicros(kw.cpcHighMicros),
    monthlyVolumes: kw.monthlyVolumes as unknown as Prisma.InputJsonValue,
    currencyCode: kw.currencyCode,
    metricsFetchedAt: new Date(),
  };
}
