// grounded in Design §18.3; pending extension type.ts reconciliation at T13.6
//
// AI 線 · extension · chatGpt · v1 — FULL-MAP。
// Design §18.3：ChatGPT 外部橋接**僅單輪**（`ChatGptResponseFormat` 凍結為最後一輪）→ query + 單輪 answer + references。
// references 跨渠道統一 `{title,link,snippet?,source?,index}`（AC-37.3/39.3）。骨架白名單全涵蓋此形狀 → `mapStatus=ok`。
import type { MapperGolden } from './golden.types';

export const aiChatGptV1Golden: MapperGolden = {
  id: 'extension|chatGpt|v1',
  coverage: 'full-map',
  fixtureVersion: 1,
  input: {
    source: 'extension',
    channel: 'chatGpt',
    schemaVersion: 'v1',
    capturedAt: '2025-11-21T00:00:00.000Z',
    payload: {
      query: 'best ergonomic office chair 2025',
      answer:
        'For 2025, the most recommended ergonomic chairs are the Herman Miller Aeron and the Steelcase Leap.',
      references: [
        {
          title: 'Herman Miller Aeron Review',
          link: 'https://example.com/aeron',
          snippet: 'The Aeron remains the benchmark for ergonomic support.',
        },
        { title: 'Steelcase Leap Guide', link: 'https://example.com/leap' },
      ],
    },
  },
  expected: {
    mapStatus: 'ok',
    reasons: [],
    canonical: {
      source: 'extension',
      channel: 'chatGpt',
      schemaVersion: 'v1',
      query: 'best ergonomic office chair 2025',
      // 單輪 answer 字串 → 收斂為單元素 blocks 陣列（骨架保證陣列，per-channel 內部結構於 M14 填充）。
      blocks: [
        'For 2025, the most recommended ergonomic chairs are the Herman Miller Aeron and the Steelcase Leap.',
      ],
      references: [
        {
          title: 'Herman Miller Aeron Review',
          link: 'https://example.com/aeron',
          snippet: 'The Aeron remains the benchmark for ergonomic support.',
          index: 0,
        },
        { title: 'Steelcase Leap Guide', link: 'https://example.com/leap', index: 1 },
      ],
      capturedAt: '2025-11-21T00:00:00.000Z',
    },
  },
};
