// grounded in Design §18.3; pending extension type.ts reconciliation at T13.6
//
// AI 線 · extension · googleSearch · v1（FR-31 SERP-grounded 的輸入渠道）— SKELETON-PARTIAL（pending T14.4 whitelist 擴充）。
// Design §18.3/§17.4：`googleSearch` `AiSearchCapture` 為 Google SERP grounding；核心 query（此例走 `q` 別名）+ blocks + references。
// extension SERP 抓取尚帶 per-channel 原始清單（`organicResults`）——骨架白名單暫未涵蓋 → `unknown_field:organicResults` →
// `mapStatus=partial`（AC-37.4 漂移預警，**非 bug**）。core 仍完整收斂。per-channel 實欄位收斂屬 M14 T14.4（屆時 partial→ok）。
import type { MapperGolden } from './golden.types';

export const aiGoogleSearchV1Golden: MapperGolden = {
  id: 'extension|googleSearch|v1',
  coverage: 'skeleton-partial',
  fixtureVersion: 1,
  input: {
    source: 'extension',
    channel: 'googleSearch',
    schemaVersion: 'v1',
    capturedAt: '2025-11-21T00:00:00.000Z',
    payload: {
      // query 走 `q` 別名（SERP 慣用），驗證跨渠道 query 收斂。
      q: 'espresso machine under 500',
      blocks: ['Top espresso machines under $500 balance temperature stability and value.'],
      references: [
        {
          title: 'Breville Bambino Plus',
          link: 'https://example.com/bambino',
          source: 'example.com',
        },
        { title: 'Gaggia Classic Pro', link: 'https://example.com/gaggia', source: 'example.com' },
      ],
      organicResults: [
        { position: 1, title: 'Best Espresso Machines 2025', link: 'https://example.com/best' },
      ],
    },
  },
  expected: {
    mapStatus: 'partial',
    reasons: ['unknown_field:organicResults'],
    canonical: {
      source: 'extension',
      channel: 'googleSearch',
      schemaVersion: 'v1',
      query: 'espresso machine under 500',
      blocks: ['Top espresso machines under $500 balance temperature stability and value.'],
      references: [
        {
          title: 'Breville Bambino Plus',
          link: 'https://example.com/bambino',
          source: 'example.com',
          index: 0,
        },
        {
          title: 'Gaggia Classic Pro',
          link: 'https://example.com/gaggia',
          source: 'example.com',
          index: 1,
        },
      ],
      capturedAt: '2025-11-21T00:00:00.000Z',
    },
  },
};
