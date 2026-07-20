// grounded in SerpApi docs + Design §18.3; real zh-TW smoke deferred (T14.1 conditional)
//
// SerpApi AI 回應 wire 形狀 fixture barrel（T14.1 fixture-baseline；FR-38 / TC-74 baseline）。
// AIO 兩路（內嵌 / page_token 二次抓取）+ AI Mode 的**結構斷言基準**——供 T14.2/T14.3 `SerpApiAiProvider`
// adapter 契約測試作 golden。SerpApi 真實 API 不可呼叫（reserved、無憑證）；形狀 grounded in SerpApi
// 官方文件 + Design §18.3。zh-TW 內容為 schema-grounded 合成樣本、真實 smoke 延後（T14.1 條件式）。
export type {
  SerpApiAiListItem,
  SerpApiAiOverview,
  SerpApiAiOverviewInline,
  SerpApiAiOverviewPageToken,
  SerpApiAiReference,
  SerpApiAiTextBlock,
  SerpApiGoogleAiModeResponse,
  SerpApiGoogleAiOverviewResponse,
  SerpApiGoogleSearchResponse,
  SerpApiSearchMetadata,
} from './types';

export { aiOverviewInlineV1 } from './ai-overview-inline.v1';
export {
  AIO_PAGE_TOKEN_EXPIRY,
  aiOverviewPageTokenStep1V1,
  aiOverviewPageTokenStep2V1,
} from './ai-overview-page-token.v1';
export { aiModeV1 } from './ai-mode.v1';
