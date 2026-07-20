import type { AiSearchCanonical } from '../captures/mapping/canonical.types';

/**
 * SerpApi AI adapters（reserved，FR-38，`SERPAPI_AI_ENABLED=false` 預設關）的**生產 wire 型別 + Port 契約**。
 *
 * 分兩層：
 * 1. **wire 型別**（`SerpApiAi*` / `SerpApiGoogle*Response`）＝SerpApi 官方 documented response schema 子集
 *    （AI Overview 內嵌 / `page_token` 二次抓取 / AI Mode）——由 T14.1 `__fixtures__/serp-ai/types.ts` **提升**至此
 *    （fixture 檔改為 re-export 本檔，SSOT 單點；T14.1 note「T14.2 建 adapter 時提升進生產型別」）。真實 API 不可呼叫
 *    （reserved、無憑證），形狀 grounded in SerpApi 官方文件 + Design §18.3。
 * 2. **Port 契約**（`SerpApiAiClient` / `SerpAiProvider`）＝DI 可 mock 的外部 HTTP client 與 provider 介面
 *    （CI 不需真憑證，契約測試以 T14.1 fixture 為 golden）。
 */

// ─────────────────────────────────────────────────────────────────────────────
// wire 型別（SerpApi documented response schema 子集；SSOT，fixture 由此 re-export）
// ─────────────────────────────────────────────────────────────────────────────

/** references 單筆——Google 引用來源（AIO 與 AI Mode 同形狀）。`index` 供 `reference_indexes` 反查。 */
export interface SerpApiAiReference {
  readonly index: number;
  readonly title?: string;
  readonly link?: string;
  readonly snippet?: string;
  readonly source?: string;
  readonly thumbnail?: string;
}

/** list 型 text_block 的單一項目（可帶自己的 reference_indexes）。 */
export interface SerpApiAiListItem {
  readonly title?: string;
  readonly snippet?: string;
  readonly reference_indexes?: readonly number[];
}

/**
 * text_block——「依序渲染的 typed 區塊」。SerpApi 以 typed blocks 讓回應對 Google 版面變動更有韌性。
 * `type` documented 值：paragraph | heading | list | table | code_block | expandable | comparison。
 */
export interface SerpApiAiTextBlock {
  readonly type:
    'paragraph' | 'heading' | 'list' | 'table' | 'code_block' | 'expandable' | 'comparison';
  readonly snippet?: string;
  readonly snippet_highlighted_words?: readonly string[];
  readonly reference_indexes?: readonly number[];
  readonly list?: readonly SerpApiAiListItem[];
}

/** 內嵌形狀（`engine=google` 回應直接帶完整 AIO），或 `engine=google_ai_overview` 二次抓取的回應主體。 */
export interface SerpApiAiOverviewInline {
  readonly text_blocks: readonly SerpApiAiTextBlock[];
  readonly references: readonly SerpApiAiReference[];
  readonly thumbnail?: string;
}

/** page_token 形狀（`engine=google` 只回 token，需 `engine=google_ai_overview` 二次抓取；**token <1min 過期**）。 */
export interface SerpApiAiOverviewPageToken {
  readonly page_token: string;
  readonly serpapi_link: string;
  /** AIO 抓取失敗時 SerpApi 回的錯誤字串（degradation：無 AIO 非錯誤，AC-38.2）。 */
  readonly error?: string;
}

export type SerpApiAiOverview = SerpApiAiOverviewInline | SerpApiAiOverviewPageToken;

export interface SerpApiSearchMetadata {
  readonly status?: 'Processing' | 'Success' | 'Error';
  readonly id?: string;
  readonly [key: string]: unknown;
}

/** `engine=google` 搜尋回應（只取本案 AIO 兩路解析欄位；`organic_results` 等主結果以 unknown 佔位）。 */
export interface SerpApiGoogleSearchResponse {
  readonly search_metadata?: SerpApiSearchMetadata;
  readonly search_parameters?: {
    readonly engine: 'google';
    readonly q?: string;
    readonly hl?: string;
    readonly gl?: string;
    readonly location?: string;
  };
  /** 無 `ai_overview` 欄 = 該 query 未觸發 AIO（AC-38.2 graceful degradation）。 */
  readonly ai_overview?: SerpApiAiOverview;
  readonly organic_results?: readonly unknown[];
}

/** `engine=google_ai_overview` 二次抓取回應（以 `page_token` 而非 `q` 請求）。 */
export interface SerpApiGoogleAiOverviewResponse {
  readonly search_metadata?: SerpApiSearchMetadata;
  readonly search_parameters?: {
    readonly engine: 'google_ai_overview';
    readonly page_token?: string;
  };
  readonly ai_overview: SerpApiAiOverviewInline;
}

/** `engine=google_ai_mode` 回應（top-level `text_blocks` + `references` + `reconstructed_markdown`；Design §18.3，T14.3 用）。 */
export interface SerpApiGoogleAiModeResponse {
  readonly search_metadata?: SerpApiSearchMetadata;
  readonly search_parameters?: {
    readonly engine: 'google_ai_mode';
    readonly q?: string;
    readonly hl?: string;
    readonly gl?: string;
    readonly location?: string;
  };
  readonly text_blocks: readonly SerpApiAiTextBlock[];
  readonly references: readonly SerpApiAiReference[];
  readonly reconstructed_markdown?: string;
  readonly subsequent_request_token?: string;
}

/**
 * `engine=bing_copilot`（2026-06）回應（AC-38.4，**could**，`SERPAPI_BING_COPILOT_ENABLED` 預設關）——top-level
 * `header?` + `text_blocks` + `references`（Design §18.3「Bing Copilot（`engine=bing_copilot`）＝could，預設關」）。
 * `header` = Copilot 摘要標題（非中立欄，不投影 canonical，比照 AIO `thumbnail` recognize-and-drop）。
 */
export interface SerpApiBingCopilotResponse {
  readonly search_metadata?: SerpApiSearchMetadata;
  readonly search_parameters?: {
    readonly engine: 'bing_copilot';
    readonly q?: string;
    readonly hl?: string;
    readonly gl?: string;
    readonly location?: string;
  };
  readonly header?: string;
  readonly text_blocks: readonly SerpApiAiTextBlock[];
  readonly references: readonly SerpApiAiReference[];
}

/**
 * 多 engine 共用的 **top-level `text_blocks`/`references` 形狀**（AI Mode / Bing Copilot；T14.3 refactor：單一中立解析
 * 路徑）。AIO 走 `ai_overview.text_blocks` 內嵌形狀故不套此（另有 page_token 兩路）；AI Mode/Copilot 皆直接 top-level
 * blocks → 共用 {@link SerpApiAiProvider} 的 `runTopLevelEngine`。`reconstructed_markdown` 供 blocks 缺時 fallback。
 */
export interface SerpApiTopLevelAiResponse {
  readonly text_blocks: readonly SerpApiAiTextBlock[];
  readonly references: readonly SerpApiAiReference[];
  readonly reconstructed_markdown?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Port 契約（DI 可 mock；契約測試以 T14.1 fixture 為 golden，CI 不需真憑證）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * canonical `AiSearchCapture`（§18.3）的 `schemaVersion`——SerpApi AI Overview 拉取來源固定版本（非 ingest 客戶端傳入，
 * 而是我方對 SerpApi 回應 schema 編碼的版本；schema 變動即 bump）。與 extension push 的 `v1` 分表互補、來源不同。
 */
export const SERPAPI_AI_SCHEMA_VERSION = 'serpapi-v1';

/** `engine=google` 搜尋參數（AC-38.5：hl=zh-tw/gl=tw）。 */
export interface SerpApiAiSearchParams {
  readonly q: string;
  readonly hl: string;
  readonly gl: string;
}

/** `engine=google_ai_overview` 二次抓取參數（by `page_token`；`signal` 供逾時取消，AC-38.1 <1min 過期）。 */
export interface SerpApiAiOverviewFetchParams {
  readonly pageToken: string;
  readonly signal?: AbortSignal;
}

/** SerpApi AI HTTP client 的 Port（DI 可換、測試可 mock；正式為 {@link HttpSerpApiAiClient}）。 */
export const SERPAPI_AI_CLIENT = Symbol('SERPAPI_AI_CLIENT');

export interface SerpApiAiClient {
  /** `engine=google` 搜尋（回應含 `ai_overview` 內嵌 / `page_token` 兩路）。 */
  searchGoogle(params: SerpApiAiSearchParams): Promise<SerpApiGoogleSearchResponse>;
  /** `engine=google_ai_overview` 以 `page_token` 二次抓取（回完整 `ai_overview.text_blocks`）。 */
  fetchAiOverview(params: SerpApiAiOverviewFetchParams): Promise<SerpApiGoogleAiOverviewResponse>;
  /** `engine=google_ai_mode` 搜尋（回 top-level `text_blocks`/`references`(+`reconstructed_markdown`)，AC-38.3，T14.3）。 */
  searchAiMode(params: SerpApiAiSearchParams): Promise<SerpApiGoogleAiModeResponse>;
  /** `engine=bing_copilot` 搜尋（回 top-level `header?`/`text_blocks`/`references`，AC-38.4 **could**，T14.3）。 */
  searchBingCopilot(params: SerpApiAiSearchParams): Promise<SerpApiBingCopilotResponse>;
}

/**
 * 單一 query 的 AI Overview 抓取結果。
 * - `aiOverview`：成功解析 → `AiSearchCanonical`（§18.3 中立形狀，與 extension 同一 canonical）；無 AIO / 二次抓取
 *   失敗 / 逾時 / credit 不足 → **`null`（graceful degradation，AC-38.2，非錯誤）**。
 * - `creditsUsed`：本 query 消耗的 SerpApi credit（AC-38.5：內嵌=1、`page_token` 二次抓取=2；credit 不足未發送=0）。
 *   一發送即計費（不論結果），故 `page_token` 路即使失敗/逾時仍計 2（保守計費、與 budget 治理一致）。
 */
export interface SerpApiAiOverviewResult {
  readonly query: string;
  readonly aiOverview: AiSearchCanonical | null;
  readonly creditsUsed: number;
}

/**
 * 單一 query 的 AI Mode（`engine=google_ai_mode`）抓取結果（AC-38.3）。`aiMode`＝成功解析的 `AiSearchCanonical`
 * （channel=aiMode，與 AIO 同一中立形狀）；無回應 / 失敗 / 逾時 / credit 不足 → `null`（graceful degradation，非錯誤）。
 * AI Mode 單次呼叫（無 page_token 兩路）→ `creditsUsed` = 1（已發送）或 0（budget 不足未發送）。
 */
export interface SerpApiAiModeResult {
  readonly query: string;
  readonly aiMode: AiSearchCanonical | null;
  readonly creditsUsed: number;
}

/**
 * 單一 query 的 Bing Copilot（`engine=bing_copilot`）抓取結果（AC-38.4，**could**）。`copilot`＝`AiSearchCanonical`
 * （channel=bingCopilot，同一中立形狀）或 degradation `null`。`SERPAPI_BING_COPILOT_ENABLED` 關（預設）→ 全 `null`、
 * `creditsUsed=0`、不打供應商。
 */
export interface SerpApiBingCopilotResult {
  readonly query: string;
  readonly copilot: AiSearchCanonical | null;
  readonly creditsUsed: number;
}

/** SerpApi AI 拉取 provider 的 Port（reserved；本期建置不接線，T14.6 job 才接）。DI token 供 T14.6 消費。 */
export const SERP_AI_PROVIDER = Symbol('SERP_AI_PROVIDER');

/**
 * 單一 job 的 SerpApi credit ledger（NFR-18 / #581，M14-R5）——`SERPAPI_AI_CREDITS_BUDGET` 是 **per-job** 上限
 * （Design §14「每 job」），須以**單一** ledger 跨 `fetchAiOverviews`/`fetchAiModes`/`fetchBingCopilot` 三個渠道 method
 * 共享（by-ref 累計 `spent`），否則各 method 各起一份 accumulator against 同預算 → 單 job 總花費達 N× per-job budget。
 * 由 caller（AiSearchProcessor）**每 job 建一次**、傳給三個 method 共用；未傳入時 method 自建一份（standalone/契約測試
 * ＝該 method 獨立一份預算，向後相容）。budget 上限由 provider 的 serpAi config 治理（同一 job 用同一 provider 實例
 * ＝同一 `creditsBudget`），故 ledger 只需承載跨渠道共享的可變 `spent`。
 */
export interface SerpCreditLedger {
  /** 本 job 至今跨渠道累計已消耗的 SerpApi credit（by-ref 共享）。 */
  spent: number;
}

export interface SerpAiProvider {
  /**
   * 批次抓取多個關鍵字的 Google AI Overview（AC-38.1 兩路 + AC-38.2 degradation）。回與輸入對齊、逐筆帶 credit；
   * 受 per-job `SERPAPI_AI_CREDITS_BUDGET` 治理（超出預算的請求不發送 → 該 query degrade `aiOverview=null`）。傳入
   * `ledger` 則與其它 serpapi 渠道 method **共用** per-job 預算（NFR-18 / #581）；省略則自建一份（standalone）。
   */
  fetchAiOverviews(
    keywords: string[],
    ledger?: SerpCreditLedger,
  ): Promise<SerpApiAiOverviewResult[]>;
  /**
   * 批次抓取多個關鍵字的 Google AI Mode（AC-38.3；`engine=google_ai_mode`）→ `AiSearchCapture`（channel=aiMode）。
   * `SERPAPI_AI_MODE_ENABLED`（＋master `SERPAPI_AI_ENABLED`）皆開時才啟用；否則全 `null`、`creditsUsed=0`、不打供應商。
   * degradation（無回應/失敗/逾時→`null` 非拋）+ per-job credit budget 治理沿用 AIO（共用 `ledger`，NFR-18 / #581）。
   */
  fetchAiModes(keywords: string[], ledger?: SerpCreditLedger): Promise<SerpApiAiModeResult[]>;
  /**
   * 批次抓取多個關鍵字的 Bing Copilot（AC-38.4，**could**；`engine=bing_copilot`）→ `AiSearchCapture`
   * （channel=bingCopilot）。`SERPAPI_BING_COPILOT_ENABLED`（＋master）皆開時才啟用；預設關 → 全 `null`、不打供應商。
   * 共用 per-job `ledger`（NFR-18 / #581）。
   */
  fetchBingCopilot(
    keywords: string[],
    ledger?: SerpCreditLedger,
  ): Promise<SerpApiBingCopilotResult[]>;
}
