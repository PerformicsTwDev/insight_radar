// grounded in Design §18.3; pending extension type.ts reconciliation at T13.6
//
// AI 線 · extension · googleAiMode · v1 — FULL-MAP（T14.4 whitelist 已擴充）。
// Design §18.3：AI Mode ＝ `blocks + references + reconstructed_markdown`；此外 extension 頁面尚帶 per-channel 專屬區塊
// （如 follow-up「其他人也搜尋」`relatedQuestions`）。T14.4 把 `relatedQuestions` 納入 googleAiMode **per-channel 認得欄位**
// （auxiliary raw 欄位，保留於 raw〔INV-4〕、不投影進 `AiSearchCapture` 中立形狀——§18.3 model 無此欄）→ 不再判
// `unknown_field` → `mapStatus=ok`。core（query/blocks/references）完整收斂。此 golden 由 T13.5 的 skeleton-partial
// 於 T14.4 升 full-map（contract drift-guard 逼出的一次有意識對帳）。
import type { MapperGolden } from './golden.types';

export const aiGoogleAiModeV1Golden: MapperGolden = {
  id: 'extension|googleAiMode|v1',
  coverage: 'full-map',
  fixtureVersion: 1,
  input: {
    source: 'extension',
    channel: 'googleAiMode',
    schemaVersion: 'v1',
    capturedAt: '2025-11-21T00:00:00.000Z',
    payload: {
      query: 'is intermittent fasting effective for weight loss',
      blocks: [
        'Intermittent fasting can support weight loss primarily via reduced calorie intake.',
        'Evidence is mixed on advantages beyond overall caloric restriction.',
      ],
      reconstructed_markdown:
        '## Intermittent fasting\n\nIF can support weight loss primarily via reduced calorie intake.',
      references: [
        {
          title: 'NIH Intermittent Fasting Study',
          link: 'https://nih.gov/if',
          snippet: 'A 2024 randomized trial compared 16:8 fasting with standard dieting.',
        },
      ],
      relatedQuestions: ['Does IF slow metabolism?', 'What is the best IF schedule?'],
    },
  },
  expected: {
    mapStatus: 'ok',
    reasons: [],
    canonical: {
      source: 'extension',
      channel: 'googleAiMode',
      schemaVersion: 'v1',
      query: 'is intermittent fasting effective for weight loss',
      // alias 先取 `blocks`（`reconstructed_markdown` 為 recognized 別名、不判 unknown，但被 blocks 覆蓋、canonical 不重出）。
      blocks: [
        'Intermittent fasting can support weight loss primarily via reduced calorie intake.',
        'Evidence is mixed on advantages beyond overall caloric restriction.',
      ],
      references: [
        {
          title: 'NIH Intermittent Fasting Study',
          link: 'https://nih.gov/if',
          snippet: 'A 2024 randomized trial compared 16:8 fasting with standard dieting.',
          index: 0,
        },
      ],
      capturedAt: '2025-11-21T00:00:00.000Z',
    },
  },
};
