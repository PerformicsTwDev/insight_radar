// grounded in SerpApi docs + Design §18.3; real zh-TW smoke deferred (T14.1 conditional)
//
// AI 線 · SerpApi（reserved，`SERPAPI_AI_ENABLED=false`）· AI Overview **內嵌路**（AC-38.1 第一路）· v1。
// `engine=google` 搜尋回應直接內嵌 `ai_overview.text_blocks` → adapter 直接解析（無需二次抓取）。
// Design §18.3 / FR-38 AC-38.1：「內嵌 `ai_overview` 有 `text_blocks` → 直接解析」。
// zh-TW query 內容為 **schema-grounded 合成樣本**（非真實 capture）；hl=zh-tw / gl=tw（AC-38.5）。
import type { SerpApiGoogleSearchResponse } from './types';

/** `engine=google` + zh-TW 回應，`ai_overview` 內嵌完整 `text_blocks` + `references`（AIO 第一路）。 */
export const aiOverviewInlineV1: SerpApiGoogleSearchResponse = {
  search_metadata: { status: 'Success', id: 'aio_inline_v1_fixture' },
  search_parameters: {
    engine: 'google',
    q: '間歇性斷食 減肥有效嗎',
    hl: 'zh-tw',
    gl: 'tw',
    location: 'Taiwan',
  },
  ai_overview: {
    text_blocks: [
      {
        type: 'paragraph',
        snippet:
          '間歇性斷食主要透過限制進食時間、降低整體熱量攝取來協助減重，常見做法包含 16:8 與 5:2。',
        snippet_highlighted_words: ['間歇性斷食', '16:8', '5:2'],
        reference_indexes: [0, 1],
      },
      {
        type: 'heading',
        snippet: '常見的斷食方式',
      },
      {
        type: 'list',
        list: [
          {
            title: '16:8 限時進食',
            snippet: '每日將進食集中於 8 小時視窗，其餘 16 小時只喝水或無熱量飲品。',
            reference_indexes: [1],
          },
          {
            title: '5:2 輕斷食',
            snippet: '一週正常飲食 5 天、另 2 天將攝取降至約 500–600 大卡。',
            reference_indexes: [2],
          },
        ],
        reference_indexes: [1, 2],
      },
    ],
    references: [
      {
        index: 0,
        title: '間歇性斷食與體重管理的臨床證據',
        link: 'https://www.nih.gov.example/intermittent-fasting',
        snippet: '2024 年一項隨機試驗比較 16:8 斷食與標準飲食控制的減重成效。',
        source: 'NIH',
      },
      {
        index: 1,
        title: '16:8 斷食法完整指南',
        link: 'https://health.example.tw/16-8-fasting',
        snippet: '說明限時進食的執行方式、適合對象與注意事項。',
        source: 'health.example.tw',
      },
      {
        index: 2,
        title: '5:2 輕斷食的科學回顧',
        link: 'https://nutrition.example.tw/5-2-diet',
        snippet: '整理 5:2 斷食對代謝與體重的影響研究。',
        source: 'nutrition.example.tw',
        thumbnail: 'https://serpapi.com/searches/example/thumb.jpg',
      },
    ],
  },
};
