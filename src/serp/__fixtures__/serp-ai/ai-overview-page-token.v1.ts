// grounded in SerpApi docs + Design §18.3; real zh-TW smoke deferred (T14.1 conditional)
//
// AI 線 · SerpApi（reserved，`SERPAPI_AI_ENABLED=false`）· AI Overview **二次抓取路**（AC-38.1 第二路）· v1。
// `engine=google` 回應只回 `ai_overview.page_token`（+ `serpapi_link`）、**無** `text_blocks` → adapter 須以
// `engine=google_ai_overview` + `page_token` **二次抓取**才拿到內容。Design §18.3 / FR-38 AC-38.1。
// ⚠ **`page_token` <1min 過期**〔SerpApi docs confirmed〕：產生後須立即使用、`SERPAPI_AIO_PAGE_TOKEN_TIMEOUT_MS`
//   內完成——此過期語意以 `AIO_PAGE_TOKEN_EXPIRY` 結構標記表達（**非** SerpApi wire 欄位，勿混入 payload）。
import type { SerpApiGoogleAiOverviewResponse, SerpApiGoogleSearchResponse } from './types';

/**
 * `page_token` 過期語意的**結構標記**（documented semantic，非 wire 欄位）。
 * SerpApi docs：`ai_overview.page_token` 產生後 <1 分鐘過期、須立即使用。
 * T14.2 adapter 以 `SERPAPI_AIO_PAGE_TOKEN_TIMEOUT_MS`（≤ `ttlMs`）強制二次抓取時限；此常數為契約基準。
 */
export const AIO_PAGE_TOKEN_EXPIRY = {
  ttlMs: 60_000,
  note: 'SerpApi ai_overview.page_token expires within 1 minute; must be used immediately (AC-38.1)',
} as const;

// 合成 opaque token 佔位——真實 SerpApi `page_token` 為不透明字串；此處刻意用**非 base64/JWT 形狀**的
// 明確假值（避免 secret-scan 誤判為祕密），並由 step1/step2 共用以坐實 token 連續性契約（baseline 斷言）。
const AIO_PAGE_TOKEN = 'FIXTURE-aio-page-token-ztw-camping-do-not-use';

/** 第一路回應：`engine=google` 只回 `ai_overview.page_token`（需二次抓取），無內嵌 `text_blocks`。 */
export const aiOverviewPageTokenStep1V1: SerpApiGoogleSearchResponse = {
  search_metadata: { status: 'Success', id: 'aio_page_token_v1_fixture' },
  search_parameters: {
    engine: 'google',
    q: '露營新手裝備推薦',
    hl: 'zh-tw',
    gl: 'tw',
    location: 'Taiwan',
  },
  ai_overview: {
    page_token: AIO_PAGE_TOKEN,
    serpapi_link: `https://serpapi.com/search.json?engine=google_ai_overview&page_token=${AIO_PAGE_TOKEN}`,
  },
};

/** 第二路回應：`engine=google_ai_overview` + `page_token` 二次抓取，回完整 `text_blocks` + `references`。 */
export const aiOverviewPageTokenStep2V1: SerpApiGoogleAiOverviewResponse = {
  search_metadata: { status: 'Success', id: 'aio_page_token_v1_step2_fixture' },
  search_parameters: {
    engine: 'google_ai_overview',
    // step2 重用 step1 的同一 opaque token → 坐實「以 step1 回傳的 page_token 二次抓取」連續性契約（baseline 斷言）。
    page_token: AIO_PAGE_TOKEN,
  },
  ai_overview: {
    text_blocks: [
      {
        type: 'paragraph',
        snippet: '露營新手建議先備齊帳篷、睡袋、睡墊與照明，再依季節與營地條件添購保暖與炊事裝備。',
        snippet_highlighted_words: ['帳篷', '睡袋', '睡墊'],
        reference_indexes: [0],
      },
      {
        type: 'list',
        list: [
          {
            title: '帳篷',
            snippet: '依人數選擇，新手可從三至四人帳入門較有餘裕。',
            reference_indexes: [0],
          },
          {
            title: '睡袋與睡墊',
            snippet: '睡袋看適用溫標、睡墊提供離地保暖與緩衝。',
            reference_indexes: [1],
          },
        ],
        reference_indexes: [0, 1],
      },
    ],
    references: [
      {
        index: 0,
        title: '露營新手裝備清單',
        link: 'https://outdoor.example.tw/camping-starter',
        snippet: '整理入門露營必備的帳篷、睡眠系統與照明。',
        source: 'outdoor.example.tw',
      },
      {
        index: 1,
        title: '睡袋溫標怎麼看',
        link: 'https://gear.example.tw/sleeping-bag-rating',
        snippet: '解釋睡袋適用溫度標示與挑選原則。',
        source: 'gear.example.tw',
      },
    ],
  },
};
