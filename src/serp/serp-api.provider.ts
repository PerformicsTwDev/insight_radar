import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { serpConfig } from '../config/serp.config';
import { scrubSecrets } from '../logger/redaction';
import { parseSerpApiResponse } from './parse-serpapi';
import { SERP_API_CLIENT, type SerpApiClient, type SerpApiResponse } from './serp-api.types';
import type { SerpProvider } from './serp-provider.port';
import type { SerpFetchResult, SerpQuery } from './serp.types';

/** 傳輸層暫時性錯誤碼（同 embeddings；長跑 HTTP 最常見的暫時失敗）。 */
const TRANSIENT_TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** 可重試：數值 429/5xx，或傳輸層暫時錯（node 系統碼 / AbortError / undici fetch failed）。 */
function isRetryableSerpError(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown; name?: unknown } | null;
  const status =
    typeof e?.status === 'number' ? e.status : typeof e?.code === 'number' ? e.code : undefined;
  if (status === 429 || (typeof status === 'number' && status >= 500 && status < 600)) {
    return true;
  }
  if (typeof e?.code === 'string' && TRANSIENT_TRANSPORT_CODES.has(e.code)) {
    return true;
  }
  if (e?.name === 'AbortError') {
    return true;
  }
  return err instanceof Error && /fetch failed/i.test(err.message);
}

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
        if (attempt > this.config.maxRetries || !isRetryableSerpError(error)) {
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
