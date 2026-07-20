// grounded in SerpApi docs + Design §18.3; real zh-TW smoke deferred (T14.1 conditional)
//
// SerpApi AI 回應 **wire 形狀**（供應商回傳的原始 JSON 子集）——T14.1 fixture-baseline 用。
// 這些 interface 描述 *SerpApi 官方 documented response schema*（AI Overview / AI Mode），是 T14.2/T14.3
// `SerpApiAiProvider` adapter 契約測試的 golden 對象；本檔 **不含 runtime 邏輯**（純 type，編譯後抹除）。
//
// ⚠ 權威 & 邊界：SerpApi 真實 API **不可呼叫**（reserved、`SERPAPI_AI_ENABLED=false`、無憑證）——形狀以
// SerpApi 官方文件（`/google-ai-overview-api`、`/google-ai-mode-api`）+ Design §18.3 為據；zh-TW 觸發率/欄位
// 穩定度之**真實 smoke 延後**（T14.1 條件式：僅未來確定啟用 SerpApi reserved 來源時手動量測、非 CI）。
// **本檔置於 `__fixtures__/`（覆蓋率分母已排除）**；T14.2 建 adapter 時再把定案 wire 型別提升進 `serp-api.types.ts`。

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

/** `engine=google_ai_mode` 回應（top-level `text_blocks` + `references` + `reconstructed_markdown`；Design §18.3）。 */
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
  /** markdown 重建（Design §18.3 `blocks + references + reconstructed_markdown`）。 */
  readonly reconstructed_markdown?: string;
  /** 可續問時的後續請求 token（documented，本案 AI Mode 一次性抓取不追）。 */
  readonly subsequent_request_token?: string;
}

// ⚠ 內嵌 vs page_token 兩路的**判別邏輯本體屬 T14.2 adapter**（`SerpApiAiProvider`），本 fixture task 不實作；
//   baseline 測試以 in-test 結構斷言（`'page_token' in ai_overview`）驗證兩路形狀，不外洩 production 判別碼。
