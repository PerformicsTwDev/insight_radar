import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { mapAiCapture } from '../captures/mapping/ai-mapper';
import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';
import { serpAiConfig } from '../config/serp-ai.config';
import { scrubSecrets } from '../logger/redaction';
import {
  SERPAPI_AI_CLIENT,
  SERPAPI_AI_SCHEMA_VERSION,
  type SerpAiProvider,
  type SerpApiAiClient,
  type SerpApiAiModeResult,
  type SerpApiAiOverview,
  type SerpApiAiOverviewInline,
  type SerpApiAiOverviewResult,
  type SerpApiAiReference,
  type SerpApiAiSearchParams,
  type SerpApiAiTextBlock,
  type SerpApiBingCopilotResult,
  type SerpApiGoogleAiOverviewResponse,
  type SerpApiTopLevelAiResponse,
} from './serpapi-ai.types';

/** {@link SerpApiAiProvider.runTopLevelEngine} 的逐 query 中立列（capture 或 degradation null + credit）。 */
interface TopLevelEngineRow {
  readonly query: string;
  readonly capture: AiSearchCanonical | null;
  readonly creditsUsed: number;
}

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
        // AIO 內嵌形狀 → 共用 mapper（channel=aiOverview；與 AI Mode / Copilot 同一中立 AiSearchCapture 路徑）。
        aiOverview: inline
          ? this.mapEngineCapture('aiOverview', query, {
              textBlocks: inline.text_blocks,
              references: inline.references,
            })
          : null,
        creditsUsed,
      });
    }
    return results;
  }

  /**
   * AI Mode（`engine=google_ai_mode`，AC-38.3）批次抓取 → `AiSearchCapture`（channel=aiMode，複用共用 mapper）。
   * per-engine gate `aiModeEnabled` 連同 master `enabled` 皆開才啟用；否則短路全 `null`、不打供應商（reserved）。
   * 單次呼叫（無 page_token 兩路）＝1 credit/query；degradation + budget 治理沿用 AIO（見 {@link runTopLevelEngine}）。
   */
  async fetchAiModes(keywords: string[]): Promise<SerpApiAiModeResult[]> {
    if (!this.config.enabled || !this.config.aiModeEnabled) {
      return keywords.map((query) => ({ query, aiMode: null, creditsUsed: 0 }));
    }
    const rows = await this.runTopLevelEngine(keywords, 'aiMode', (params) =>
      this.client.searchAiMode(params),
    );
    return rows.map(({ query, capture, creditsUsed }) => ({ query, aiMode: capture, creditsUsed }));
  }

  /**
   * Bing Copilot（`engine=bing_copilot`，AC-38.4，**could**）批次抓取 → `AiSearchCapture`（channel=bingCopilot）。
   * per-engine gate `bingCopilotEnabled` 連同 master `enabled` 皆開才啟用；預設關 → 短路全 `null`、不打供應商。
   */
  async fetchBingCopilot(keywords: string[]): Promise<SerpApiBingCopilotResult[]> {
    if (!this.config.enabled || !this.config.bingCopilotEnabled) {
      return keywords.map((query) => ({ query, copilot: null, creditsUsed: 0 }));
    }
    const rows = await this.runTopLevelEngine(keywords, 'bingCopilot', (params) =>
      this.client.searchBingCopilot(params),
    );
    return rows.map(({ query, capture, creditsUsed }) => ({
      query,
      copilot: capture,
      creditsUsed,
    }));
  }

  /**
   * 多 engine 共用批次執行器（AI Mode / Bing Copilot；single-call top-level `text_blocks` engine）——逐 query 於
   * `SERPAPI_AI_CREDITS_BUDGET` 內發送（1 credit/query，超出不發送 → degrade `null`、creditsUsed=0）；成功 → 共用
   * {@link mapEngineCapture} 收斂成中立 `AiSearchCapture`；**無回應 / 失敗 / malformed → `null`（degradation，非拋，
   * AC-38.2；已發送仍計 1 credit）**。`hl=zh-tw`/`gl=tw`（AC-38.5）。
   */
  private async runTopLevelEngine(
    keywords: string[],
    channel: CaptureChannel,
    call: (params: SerpApiAiSearchParams) => Promise<SerpApiTopLevelAiResponse>,
  ): Promise<TopLevelEngineRow[]> {
    const rows: TopLevelEngineRow[] = [];
    let spent = 0; // 全批已消耗 credit（per-job budget 治理，同 AIO）
    const budget = this.config.creditsBudget;

    for (const query of keywords) {
      if (spent + 1 > budget) {
        rows.push({ query, capture: null, creditsUsed: 0 });
        continue;
      }
      spent += 1;
      let capture: AiSearchCanonical | null = null;
      try {
        const response = await call({ q: query, hl: this.config.hl, gl: this.config.gl });
        // 防禦性：缺 top-level text_blocks（供應商 schema 漂移/未觸發）→ degrade null（不臆造，比照 AIO 無 ai_overview）。
        if (response && Array.isArray(response.text_blocks)) {
          capture = this.mapEngineCapture(channel, query, {
            textBlocks: response.text_blocks,
            references: response.references,
            reconstructedMarkdown: response.reconstructed_markdown,
          });
        }
      } catch (error) {
        // 祕密不入 log（NFR-5）：供應商錯誤可夾帶 api_key（URL query）。
        this.logger.warn(`${channel} fetch degraded to null: ${scrubSecrets(String(error))}`);
      }
      rows.push({ query, capture, creditsUsed: 1 });
    }
    return rows;
  }

  /**
   * 多 engine 共用 mapper（AIO / AI Mode / Bing Copilot → 單一中立 `AiSearchCapture`，T14.3 refactor）——`text_blocks`
   * / `references`(+`reconstructed_markdown` fallback) 經 T14.4 {@link mapAiCapture}（source=serpapi）收斂：`text_blocks`
   * 優先為 blocks、缺時退回 `reconstructed_markdown`；`references` 統一 `{title,link,snippet?,source?,index}`。query 恆
   * 存在 → 不會 `failed`；理論上 `canonical=null` 亦 degrade。
   */
  private mapEngineCapture(
    channel: CaptureChannel,
    query: string,
    parts: {
      readonly textBlocks?: readonly SerpApiAiTextBlock[];
      readonly references?: readonly SerpApiAiReference[];
      readonly reconstructedMarkdown?: string;
    },
  ): AiSearchCanonical | null {
    const { canonical } = mapAiCapture({
      source: 'serpapi',
      channel,
      schemaVersion: SERPAPI_AI_SCHEMA_VERSION,
      payload: {
        q: query,
        text_blocks: parts.textBlocks,
        references: parts.references,
        reconstructed_markdown: parts.reconstructedMarkdown,
      },
      capturedAt: new Date(),
    });
    return canonical;
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
}

/** 兩路判別：內嵌路帶 `text_blocks`、二次抓取路只帶 `page_token`（fixture baseline 同一判別）。 */
function isInline(aio: SerpApiAiOverview): aio is SerpApiAiOverviewInline {
  return 'text_blocks' in aio;
}
