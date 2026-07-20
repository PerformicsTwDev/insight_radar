// grounded in SerpApi docs + Design §18.3; real zh-TW smoke deferred (T14.1 conditional)
//
// SerpApi AI 回應 **wire 形狀**（供應商回傳的原始 JSON 子集）——T14.1 fixture-baseline 用。
//
// ⚠ **型別已提升至生產 SSOT**（T14.1 note：「T14.2 建 adapter 時把定案 wire 型別提升進生產型別」）：
//   本檔改為 **re-export `src/serp/serpapi-ai.types.ts`**（T14.2 `SerpApiAiProvider` adapter 的契約來源），
//   單一定義點、避免 fixture 與生產型別漂移。fixture data 檔與 baseline 結構斷言仍 import 本檔（形狀不變）。
//
// 真實 API 不可呼叫（reserved、`SERPAPI_AI_ENABLED=false`、無憑證）——形狀 grounded in SerpApi 官方文件
// （`/google-ai-overview-api`、`/google-ai-mode-api`）+ Design §18.3；zh-TW 真實 smoke 延後（T14.1 條件式）。
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
} from '../../serpapi-ai.types';
