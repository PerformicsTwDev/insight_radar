import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { mapAiCapture } from '../captures/mapping/ai-mapper';
import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import { serpAiConfig } from '../config/serp-ai.config';
import { scrubSecrets } from '../logger/redaction';
import {
  SERPAPI_AI_CLIENT,
  SERPAPI_AI_SCHEMA_VERSION,
  type SerpAiProvider,
  type SerpApiAiClient,
  type SerpApiAiOverview,
  type SerpApiAiOverviewInline,
  type SerpApiAiOverviewResult,
  type SerpApiGoogleAiOverviewResponse,
} from './serpapi-ai.types';

/**
 * SerpApi AI Overview adapter（T14.2，FR-38，**reserved**，`SERPAPI_AI_ENABLED=false` 預設關）——實作
 * {@link SerpAiProvider}，經 {@link SerpApiAiClient}（DI 可 mock）抓取 Google AI Overview。本期建置**不接線到 live
 * 抓取**（T14.6 job 才接），契約測試以 T14.1 fixtures 為 golden。
 *
 * **AIO 兩路（AC-38.1）**：`engine=google` 回應內嵌 `ai_overview.text_blocks` → 直接解析；只回 `ai_overview.page_token`
 * → `engine=google_ai_overview` **二次抓取**（`SERPAPI_AIO_PAGE_TOKEN_TIMEOUT_MS` 內完成；page_token <1min 過期）。
 *
 * **graceful degradation（AC-38.2）**：無 `ai_overview` / `ai_overview.error` / 二次抓取失敗 / 逾時 / credit 不足
 * → **`aiOverview=null`（非錯誤、不阻斷、下游容忍 null）**。產出對映 `AiSearchCapture` 中立形狀（複用 T14.4
 * `mapAiCapture`，source=serpapi/channel=aiOverview；SerpApi 與 extension 同一 canonical）。
 *
 * **credit 治理（AC-38.5 / NFR-18）**：一發送即計費（不論結果）——內嵌路 = 1、`page_token` 路 = 2 credits/query；
 * 全批受 `SERPAPI_AI_CREDITS_BUDGET` 治理，會超出預算的請求**不發送**（該 query degrade）。`hl=zh-tw`/`gl=tw`。
 *
 * 降級邏輯照抄 brand_intent_radar `serp/search/route.ts`（二次抓取 + null 容忍）。
 */
@Injectable()
export class SerpApiAiProvider implements SerpAiProvider {
  private readonly logger = new Logger(SerpApiAiProvider.name);

  constructor(
    @Inject(SERPAPI_AI_CLIENT) private readonly client: SerpApiAiClient,
    @Inject(serpAiConfig.KEY) private readonly config: ConfigType<typeof serpAiConfig>,
  ) {}

  async fetchAiOverviews(keywords: string[]): Promise<SerpApiAiOverviewResult[]> {
    // reserved：關閉時短路，不打供應商（TC-74「SERPAPI_AI_ENABLED=false 不啟用」）。
    if (!this.config.enabled) {
      return keywords.map((query) => ({ query, aiOverview: null, creditsUsed: 0 }));
    }

    const results: SerpApiAiOverviewResult[] = [];
    let spent = 0; // 全批已消耗 credit（per-job budget 治理）
    const budget = this.config.creditsBudget;

    for (const query of keywords) {
      // 主查詢 = 1 credit；會超出預算 → 不發送（degrade，creditsUsed=0）。
      if (spent + 1 > budget) {
        results.push({ query, aiOverview: null, creditsUsed: 0 });
        continue;
      }
      spent += 1;
      let creditsUsed = 1;

      const response = await this.client.searchGoogle({
        q: query,
        hl: this.config.hl,
        gl: this.config.gl,
      });

      let inline: SerpApiAiOverviewInline | null = null;
      const aio = response.ai_overview;

      if (aio && isInline(aio)) {
        // 路一：內嵌 text_blocks，直接解析。
        inline = aio;
      } else if (aio && !aio.error && aio.page_token) {
        // 路二：只回 page_token → 二次抓取（若預算允許再發送 → 一發送即 +1 credit）。
        if (spent + 1 > budget) {
          this.logger.warn(
            `AIO secondary fetch skipped (credit budget ${budget} reached): degrading to null`,
          );
        } else {
          spent += 1;
          creditsUsed = 2;
          inline = await this.fetchAiOverviewWithinTimeout(aio.page_token);
        }
      }
      // else：無 ai_overview / 有 error / 未知形狀 → inline 保持 null（degradation，AC-38.2）。

      results.push({
        query,
        aiOverview: inline ? this.toCanonical(query, inline) : null,
        creditsUsed,
      });
    }
    return results;
  }

  /**
   * `engine=google_ai_overview` 以 `page_token` 二次抓取，`SERPAPI_AIO_PAGE_TOKEN_TIMEOUT_MS` 內完成（page_token
   * <1min 過期）。失敗/逾時 → **回 null（degradation，非拋錯）**：AC-38.2「二次抓取失敗 → aiOverview=null 非錯誤」。
   * 逾時以 AbortController 取消真實 HTTP 並在時限內以 timeout 敗選（fake-timer 友善、決定論）。
   */
  private async fetchAiOverviewWithinTimeout(
    pageToken: string,
  ): Promise<SerpApiAiOverviewInline | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`AIO page_token fetch exceeded ${this.config.aioPageTokenTimeoutMs}ms`));
      }, this.config.aioPageTokenTimeoutMs);
    });
    try {
      const step2: SerpApiGoogleAiOverviewResponse = await Promise.race([
        this.client.fetchAiOverview({ pageToken, signal: controller.signal }),
        timeout,
      ]);
      return step2.ai_overview ?? null;
    } catch (error) {
      // 祕密不入 log（NFR-5）：供應商錯誤可夾帶 api_key（URL query）。
      this.logger.warn(
        `AIO page_token secondary fetch degraded to null: ${scrubSecrets(String(error))}`,
      );
      return null;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * SerpApi AIO 內嵌形狀 → `AiSearchCapture` 中立 canonical（複用 T14.4 `mapAiCapture`；source=serpapi、
   * channel=aiOverview）。`text_blocks`/`references` 經 mapper alias 收斂（references 複用 `normalizeReferences`
   * 統一為 `{title,link,snippet?,source?,index}`）。query 恆存在 → 不會 `failed`；理論上 `canonical=null` 亦 degrade。
   */
  private toCanonical(query: string, inline: SerpApiAiOverviewInline): AiSearchCanonical | null {
    const { canonical } = mapAiCapture({
      source: 'serpapi',
      channel: 'aiOverview',
      schemaVersion: SERPAPI_AI_SCHEMA_VERSION,
      payload: {
        q: query,
        text_blocks: inline.text_blocks,
        references: inline.references,
      },
      capturedAt: new Date(),
    });
    return canonical;
  }
}

/** 兩路判別：內嵌路帶 `text_blocks`、二次抓取路只帶 `page_token`（fixture baseline 同一判別）。 */
function isInline(aio: SerpApiAiOverview): aio is SerpApiAiOverviewInline {
  return 'text_blocks' in aio;
}
