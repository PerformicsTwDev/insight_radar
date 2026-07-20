// grounded in SerpApi docs + Design §18.3; real zh-TW smoke deferred (T14.1 conditional)
//
// AI 線 · SerpApi（reserved，`SERPAPI_AI_ENABLED=false`）· AI Mode（`engine=google_ai_mode`）· v1。
// Design §18.3 / FR-38 AC-38.3：AI Mode ＝ **top-level** `text_blocks(blocks) + references + reconstructed_markdown`。
// ⚠ SerpApi 對 **zh-TW AI Mode 支援度 uncertain**〔research〕——本 fixture 為 schema-grounded 合成樣本；zh-TW 真實
//   觸發率/欄位穩定度延後至確定啟用 SerpApi reserved 來源時手動 smoke（非 CI，T14.1 條件式）；若不穩維持 could。
// hl=zh-tw / gl=tw（AC-38.5）；`search_metadata.status` documented 流：Processing → Success | Error。
import type { SerpApiGoogleAiModeResponse } from './types';

/** `engine=google_ai_mode` + zh-TW 回應（top-level `text_blocks` + `references` + `reconstructed_markdown`）。 */
export const aiModeV1: SerpApiGoogleAiModeResponse = {
  search_metadata: { status: 'Success', id: 'ai_mode_v1_fixture' },
  search_parameters: {
    engine: 'google_ai_mode',
    q: '電動牙刷推薦 2026',
    hl: 'zh-tw',
    gl: 'tw',
    location: 'Taiwan',
  },
  text_blocks: [
    {
      type: 'paragraph',
      snippet:
        '挑選電動牙刷可從清潔模式、刷頭相容性、續航與價格四面向評估，聲波式在日常清潔上較常被推薦。',
      snippet_highlighted_words: ['清潔模式', '聲波式'],
      reference_indexes: [0, 1],
    },
    {
      type: 'heading',
      snippet: '2026 熱門機型比較',
    },
    {
      type: 'list',
      list: [
        {
          title: '入門聲波款',
          snippet: '提供基本清潔與計時，適合首次使用電動牙刷者。',
          reference_indexes: [1],
        },
        {
          title: '進階多模式款',
          snippet: '含美白、敏感與牙齦護理模式，並支援壓力偵測。',
          reference_indexes: [2],
        },
      ],
      reference_indexes: [1, 2],
    },
  ],
  references: [
    {
      index: 0,
      title: '電動牙刷選購指南',
      link: 'https://review.example.tw/electric-toothbrush-guide',
      snippet: '整理清潔模式、刷頭與續航等挑選重點。',
      source: 'review.example.tw',
    },
    {
      index: 1,
      title: '2026 入門電動牙刷評測',
      link: 'https://gadget.example.tw/entry-sonic-2026',
      snippet: '比較數款入門聲波電動牙刷的清潔力與噪音。',
      source: 'gadget.example.tw',
    },
    {
      index: 2,
      title: '多模式電動牙刷推薦',
      link: 'https://dental.example.tw/multi-mode-picks',
      snippet: '介紹具美白與牙齦護理模式的進階機型。',
      source: 'dental.example.tw',
    },
  ],
  reconstructed_markdown:
    '## 電動牙刷推薦 2026\n\n挑選時可從清潔模式、刷頭相容性、續航與價格評估。\n\n- **入門聲波款**：基本清潔與計時。\n- **進階多模式款**：美白、敏感、牙齦護理與壓力偵測。',
};
