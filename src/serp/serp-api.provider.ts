import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { serpConfig } from '../config/serp.config';
import { scrubSecrets } from '../logger/redaction';
import { parseSerpApiResponse } from './parse-serpapi';
import { SERP_API_CLIENT, type SerpApiClient, type SerpApiResponse } from './serp-api.types';
import { isTransientSerpError } from './serp-errors';
import type { SerpProvider } from './serp-provider.port';
import type { SerpFetchResult, SerpQuery } from './serp.types';

/**
 * serpapi adapter（T8.3，FR-15）：實作 {@link SerpProvider}，經 {@link SerpApiClient} 抓取 → `parseSerpApiResponse`
 * 轉中立 `SerpResult`（取 SERP_TOP_N）。429/5xx/傳輸層指數退避（config 驅動）。
 *
 * ⚠ 本 slice **尚不接持久層**（freshness / serp_fetches append-only 重用留 slice 3）——每次 `fetch` 皆打供應商。
 */
@Injectable()
export class SerpApiProvider implements SerpProvider {
  private readonly logger = new Logger(SerpApiProvider.name);

  constructor(
    @Inject(SERP_API_CLIENT) private readonly client: SerpApiClient,
    @Inject(serpConfig.KEY) private readonly config: ConfigType<typeof serpConfig>,
  ) {}

  async fetch(queries: SerpQuery[]): Promise<SerpFetchResult[]> {
    const results: SerpFetchResult[] = [];
    // 逐一抓（SERP 非高 QPS；供應商各有速率限制）。退避處理暫時性錯誤。
    for (const query of queries) {
      const response = await this.searchWithBackoff(query);
      results.push({
        ...query,
        provider: this.config.provider,
        results: parseSerpApiResponse(response, this.config.topN),
        fetchedAt: new Date(),
      });
    }
    return results;
  }

  private async searchWithBackoff(query: SerpQuery): Promise<SerpApiResponse> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.client.search({
          q: query.keyword,
          gl: query.geo,
          hl: query.language,
          num: this.config.topN,
          ...(query.device ? { device: query.device } : {}),
        });
      } catch (error) {
        attempt += 1;
        if (attempt > this.config.maxRetries || !isTransientSerpError(error)) {
          throw error;
        }
        const delayMs = this.config.backoffBaseMs * 2 ** (attempt - 1);
        // 祕密不入 log（NFR-5）：供應商錯誤可夾帶 api_key（URL query）。
        this.logger.warn(
          `SERP retry ${attempt}/${this.config.maxRetries} after ${delayMs}ms: ${scrubSecrets(String(error))}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}
