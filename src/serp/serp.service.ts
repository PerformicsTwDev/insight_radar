import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { serpConfig } from '../config/serp.config';
import { scrubSecrets } from '../logger/redaction';
import { isTransientSerpError } from './serp-errors';
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
 *
 * **Per-query 韌性（M8-R10，NFR-12 partial 意圖「保留已完成階段」）**：單一 query 的**暫時性**失敗
 * （429/5xx/傳輸層，已達重試上限）只**剔除該 query** 的 SERP、續跑其餘 query（consumer 對該字降級純文字），
 * 並發**結構化 warn**（可觀測、非靜默吞錯）。**非暫時性/契約錯**（4xx `InvalidArgument`/憑證錯、DB 錯）為
 * 系統性、重試無益 → **上拋浮現**（比照 `ClusteringContractError` 精神，#530），不得靜默降級遮蔽。
 */
@Injectable()
export class SerpService implements SerpProvider {
  private readonly logger = new Logger(SerpService.name);

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
      try {
        results.push(await this.fetchOne(query));
      } catch (error) {
        if (!isTransientSerpError(error)) {
          throw error; // 契約/設定/DB 錯：系統性、重試無益 → 浮現而非靜默降級（#530 精神）
        }
        // 暫時性失敗（達重試上限）：只剔除此 query 的 SERP、續跑其餘（NFR-12 保留已完成階段）。
        // 祕密不入 log（NFR-5）：供應商錯誤可夾帶 api_key（URL query）。
        this.logger.warn(
          `SERP query degraded (dropped from run): normalizedText=${query.normalizedText} — ${scrubSecrets(String(error))}`,
        );
      }
    }
    return results;
  }

  /** 單一 query：freshness 窗內重用（不打供應商），否則抓取 + append-only 寫入。 */
  private async fetchOne(query: SerpQuery): Promise<SerpFetchResult> {
    const reused = await this.repository.findLatestWithin(query, this.config.freshnessDays);
    if (reused) {
      return reused; // 窗內重用，不打供應商
    }
    const [fetched] = await this.fetcher.fetch([query]);
    await this.repository.append(fetched); // append-only 保留歷史
    return fetched;
  }
}
