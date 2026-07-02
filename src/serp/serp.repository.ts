import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import type { SerpFetchResult, SerpQuery, SerpResult } from './serp.types';

const MS_PER_DAY = 86_400_000;

/**
 * serp_fetches 儲存層（T8.3，FR-15）：**append-only** 持久 SSOT（非 TTL 快取）——每次抓取 create 一列、保留歷史
 * （供 freshness 窗重用 + SERP-over-time）。`results` 為 typed Prisma Json 欄（非 Unsupported）→ 用 `prisma.serpFetch`。
 * **不** update/delete（保留歷史；retention 清理另議）。
 */
@Injectable()
export class SerpRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** append 一筆抓取結果（保留歷史；id 由 Prisma 產生）。 */
  async append(fetch: SerpFetchResult): Promise<void> {
    await this.prisma.serpFetch.create({
      data: {
        normalizedText: fetch.normalizedText,
        keyword: fetch.keyword,
        geo: fetch.geo,
        language: fetch.language,
        device: fetch.device ?? null,
        provider: fetch.provider,
        results: fetch.results as unknown as Prisma.InputJsonValue,
        fetchedAt: fetch.fetchedAt,
      },
    });
  }

  /**
   * 取 freshness 窗（`freshnessDays` 內）該 query 的**最新**一列；無則回 null（→ 呼叫端重抓）。
   * `freshnessDays=0` → cutoff=now → 幾乎不重用（每次重抓）。
   */
  async findLatestWithin(query: SerpQuery, freshnessDays: number): Promise<SerpFetchResult | null> {
    const cutoff = new Date(Date.now() - freshnessDays * MS_PER_DAY);
    const row = await this.prisma.serpFetch.findFirst({
      where: {
        geo: query.geo,
        language: query.language,
        normalizedText: query.normalizedText,
        fetchedAt: { gte: cutoff },
      },
      orderBy: { fetchedAt: 'desc' },
    });
    if (!row) {
      return null;
    }
    return {
      normalizedText: row.normalizedText,
      keyword: row.keyword,
      geo: row.geo,
      language: row.language,
      device: row.device ?? undefined,
      provider: row.provider,
      results: row.results as unknown as SerpResult,
      fetchedAt: row.fetchedAt,
    };
  }
}
