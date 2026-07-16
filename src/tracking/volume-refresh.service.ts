import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { trackingConfig } from '../config/tracking.config';
import { GoogleAdsService, type HistoricalParams } from '../google-ads/google-ads.service';
import type { Keyword } from '../google-ads/keyword.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  limitToRecentMonths,
  sameObservation,
  type MonthlyVolumePoint,
  type VolumeObservation,
} from './volume-observation';

/** 刷新結果摘要（partial 語意可斷言，AC-29.5）。 */
export interface RefreshListResult {
  listId: string;
  fetchedAt: Date;
  memberCount: number;
  /** 新落一筆快照的成員數（值變 / 首次）。 */
  appended: number;
  /** 同值略過寫入、僅更新 `lastCheckedAt` 的成員數（store-on-change）。 */
  unchanged: number;
  /** 該批 Ads 失敗、該次無列且 `lastCheckedAt` 未前進的成員數（partial）。 */
  failed: number;
}

/** currencyCode 僅供 mapper 的 CPC 浮點欄位（**不落快照**——快照存 micros）；任意值皆不影響儲存。 */
const REFRESH_CURRENCY = 'TWD';

/** 該成員本次要落列與否的判定結果。 */
type StoreOutcome = 'appended' | 'unchanged';

/** 清單層語境（快照 geo/language 固定於清單，AC-28.5）。 */
interface ListContext {
  geo: string;
  language: string;
}

/**
 * 搜量時序快照刷新服務（T11.5，FR-29 AC-29.1/29.3/29.4/29.5 · NFR-16）。**Service only**：不含 BullMQ
 * repeatable job / HTTP endpoint（T11.6+）。以清單成員的 `geo/language` 語境、經**既有
 * `GoogleAdsService.fetchHistoricalMetrics`**（exact 模式 `GenerateKeywordHistoricalMetrics` + 既有
 * `AdsRateLimiter` per-CID ~1 QPS + 共用 mapper；不新增限流器、不放大 QPS，ADR-0001）批次取數，
 * 以 **store-on-change** 落 `VolumeSnapshot`（append-only）。
 *
 * - **每批 seed ≤ 20**（AC-29.2；由 {@link maxSeedsPerBatch} 控，測試可調以隔離 per-batch partial）。
 * - **null 不補 0**：任一缺值一律 null（鐵律）；`cpc = micros/1e6` 於 mapper，micros 缺 → null。
 * - **月粒度**：`MonthOfYear` 以名稱映射 1–12（於 mapper）；`fetchedAt` = 觀測時點（非每日搜量，S1）。
 * - **partial（AC-29.5）**：某批 Ads 失敗達重試上限 → 該批成員該次無列、`lastCheckedAt` 不前進、
 *   其他批照常、整體不 throw；回摘要供呼叫端/測試斷言。
 */
@Injectable()
export class VolumeRefreshService {
  /** 觀測時點時鐘（fetchedAt / lastCheckedAt）；測試可覆寫成可控時鐘（決定性斷言）。 */
  now: () => Date = () => new Date();
  /** 每批 seed 上限（AC-29.2 ≤20）；測試可覆寫以隔離 per-batch partial 語意。 */
  maxSeedsPerBatch = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ads: GoogleAdsService,
    @Inject(trackingConfig.KEY) private readonly config: ConfigType<typeof trackingConfig>,
  ) {}

  /**
   * 刷新單一清單所有成員的搜量快照（FR-29）。成員 key = `normalizedText`（S4，與去重/快取同一套）。
   * 未知清單 → 404。此方法**不做 owner 過濾**（排程 job 遍歷所有清單；手動刷新的 owner 守門於 T11.6 入口）。
   */
  async refreshList(listId: string): Promise<RefreshListResult> {
    const list = await this.prisma.trackingList.findUnique({
      where: { id: listId },
      select: {
        geo: true,
        language: true,
        members: {
          select: { normalizedText: true, text: true },
          orderBy: { normalizedText: 'asc' },
        },
      },
    });
    if (!list) {
      throw new NotFoundException(`Tracking list ${listId} not found`);
    }

    const fetchedAt = this.now();
    const members = list.members;
    let appended = 0;
    let unchanged = 0;
    let failed = 0;

    const params: HistoricalParams = {
      geo: list.geo,
      language: list.language,
      currencyCode: REFRESH_CURRENCY,
      batchSize: this.maxSeedsPerBatch,
    };

    for (const batch of this.chunk(members)) {
      let fetched: Keyword[];
      try {
        fetched = await this.ads.fetchHistoricalMetrics(
          batch.map((m) => m.text),
          params,
        );
      } catch {
        // AC-29.5：整批失敗 → 該批成員無列、lastCheckedAt 不前進、其他批照常、整體不 throw。
        failed += batch.length;
        continue;
      }
      const kwByKey = indexKeywords(fetched);
      for (const member of batch) {
        // 不變量：fetchHistoricalMetrics 對每個輸入 seed 皆回一列（無資料→補「無指標 seed 列」+ dedupeMerge
        // 以 normalizedText 為鍵），故 kwByKey **必**含 member.normalizedText。以 non-null 斷言表達此不變量，
        // 避免一條不可達的防禦分支（若不變量遭破壞，取值即 throw、由 int-spec 攔截，不會靜默走錯路）。
        const kw = kwByKey.get(member.normalizedText)!;
        const outcome = await this.storeOnChange(
          listId,
          list,
          member.normalizedText,
          kw,
          fetchedAt,
        );
        if (outcome === 'appended') {
          appended += 1;
        } else {
          unchanged += 1;
        }
      }
    }

    return { listId, fetchedAt, memberCount: members.length, appended, unchanged, failed };
  }

  /**
   * store-on-change（AC-29.4 / S3）：把本次觀測與該成員**最新一筆**快照全欄比對——相同→略過寫入、
   * 只更新 `lastCheckedAt`（值變才 append）。無論落列與否，成功刷新一律前進 `lastCheckedAt`。
   */
  private async storeOnChange(
    listId: string,
    ctx: ListContext,
    normalizedText: string,
    kw: Keyword,
    fetchedAt: Date,
  ): Promise<StoreOutcome> {
    const observation = this.toObservation(kw);
    const latest = await this.prisma.volumeSnapshot.findFirst({
      where: { listId, normalizedText },
      orderBy: { fetchedAt: 'desc' },
      select: {
        avgMonthlySearches: true,
        competition: true,
        cpcLowMicros: true,
        cpcHighMicros: true,
        monthlyVolumes: true,
      },
    });
    const changed = !latest || !sameObservation(observation, snapshotToObservation(latest));

    if (changed) {
      await this.prisma.volumeSnapshot.create({
        data: {
          listId,
          normalizedText,
          geo: ctx.geo,
          language: ctx.language,
          avgMonthlySearches: observation.avgMonthlySearches,
          monthlyVolumes: observation.monthlyVolumes as unknown as Prisma.InputJsonValue,
          competition: observation.competition,
          competitionIndex: kw.competitionIndex ?? null,
          cpcLowMicros: observation.cpcLowMicros === null ? null : BigInt(observation.cpcLowMicros),
          cpcHighMicros:
            observation.cpcHighMicros === null ? null : BigInt(observation.cpcHighMicros),
          fetchedAt,
        },
      });
    }

    await this.prisma.trackingListMember.update({
      where: { listId_normalizedText: { listId, normalizedText } },
      data: { lastCheckedAt: fetchedAt },
    });

    return changed ? 'appended' : 'unchanged';
  }

  /**
   * Keyword → 觀測；`monthlyVolumes` 裁切至最近 `backfillMonths` 月（AC-29.1）。無 Ads 指標的輸入由
   * `fetchHistoricalMetrics` 補「無指標 seed 列」（competition 為 `UNSPECIFIED`、其餘 null；斷點語意、
   * null 不補 0），故此處恆收到真實 `Keyword`（不需 undefined 防禦分支——見 refreshList 的不變量斷言）。
   */
  private toObservation(kw: Keyword): VolumeObservation {
    return {
      avgMonthlySearches: kw.avgMonthlySearches,
      competition: kw.competition,
      cpcLowMicros: kw.cpcLowMicros,
      cpcHighMicros: kw.cpcHighMicros,
      monthlyVolumes: limitToRecentMonths(kw.monthlyVolumes, this.config.backfillMonths),
    };
  }

  /** 切批（每批 ≤ maxSeedsPerBatch；partial 韌性以「批」為粒度，AC-29.5）。 */
  private chunk<T>(items: T[]): T[][] {
    const size = Math.max(1, this.maxSeedsPerBatch);
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }
}

/**
 * 把 fetchHistoricalMetrics 回列以 `normalizedText` 索引；含**近義聚合**：一列可經 `seedOrigins`
 * 對回多個原始輸入（car/cars 併為一列），故 canonical 與各 origin 皆映射到同列（同一觀測）。
 */
function indexKeywords(fetched: Keyword[]): Map<string, Keyword> {
  const byKey = new Map<string, Keyword>();
  for (const kw of fetched) {
    for (const key of new Set<string>([kw.normalizedText, ...(kw.seedOrigins ?? [])])) {
      byKey.set(key, kw);
    }
  }
  return byKey;
}

/** 最新快照列 → 觀測（micros bigint→string、monthlyVolumes Json→陣列），與新觀測同型以全欄比對。 */
function snapshotToObservation(row: {
  avgMonthlySearches: number | null;
  competition: string | null;
  cpcLowMicros: bigint | null;
  cpcHighMicros: bigint | null;
  monthlyVolumes: Prisma.JsonValue;
}): VolumeObservation {
  return {
    avgMonthlySearches: row.avgMonthlySearches,
    competition: row.competition,
    cpcLowMicros: row.cpcLowMicros === null ? null : row.cpcLowMicros.toString(),
    cpcHighMicros: row.cpcHighMicros === null ? null : row.cpcHighMicros.toString(),
    monthlyVolumes: row.monthlyVolumes as unknown as MonthlyVolumePoint[],
  };
}
