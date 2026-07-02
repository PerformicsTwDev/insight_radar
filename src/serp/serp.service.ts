import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { serpConfig } from '../config/serp.config';
import { SerpApiProvider } from './serp-api.provider';
import { SerpRepository } from './serp.repository';
import type { SerpProvider } from './serp-provider.port';
import type { SerpFetchResult, SerpQuery } from './serp.types';

/**
 * Freshness-aware SERP 編排（T8.3，FR-15/TC-47）——對外 {@link SerpProvider}（decorator）。
 *
 * - `SERP_ENABLED=false` → **回 []**（降級純文字 embedding；不打供應商、不阻斷）。
 * - 否則逐 query：durable `serp_fetches` freshness 窗內有 → **重用**（不打供應商）；否則 {@link SerpApiProvider}
 *   抓取 → append-only 寫入 → 回。保留歷史（SERP-over-time）。
 */
@Injectable()
export class SerpService implements SerpProvider {
  constructor(
    private readonly fetcher: SerpApiProvider,
    private readonly repository: SerpRepository,
    @Inject(serpConfig.KEY) private readonly config: ConfigType<typeof serpConfig>,
  ) {}

  async fetch(queries: SerpQuery[]): Promise<SerpFetchResult[]> {
    if (!this.config.enabled || queries.length === 0) {
      return []; // 降級：純文字 embedding（consumer 依 normalizedText 找不到 → 不帶 SERP）
    }
    const results: SerpFetchResult[] = [];
    for (const query of queries) {
      const reused = await this.repository.findLatestWithin(query, this.config.freshnessDays);
      if (reused) {
        results.push(reused); // 窗內重用，不打供應商
        continue;
      }
      const [fetched] = await this.fetcher.fetch([query]);
      await this.repository.append(fetched); // append-only 保留歷史
      results.push(fetched);
    }
    return results;
  }
}
