// grounded in Design §18.3; pending extension type.ts reconciliation at T13.6
//
// AI 線 · extension · googleSearch · v1（FR-31 SERP-grounded 的輸入渠道）— FULL-MAP（T14.4 whitelist 已擴充）。
// Design §18.3/§17.4：`googleSearch` `AiSearchCapture` 為 Google SERP grounding；核心 query（此例走 `q` 別名）+ blocks + references。
// extension SERP 抓取尚帶 per-channel 原始清單（`organicResults`）。T14.4 把 `organicResults` 納入 googleSearch **per-channel
// 認得欄位**（auxiliary raw 清單，保留於 raw〔INV-4〕、不投影進 `AiSearchCapture`——§18.3 model 只有 `references` 中立欄，
// 不重複投影 organic 清單以免臆造 merge 語意〔S17〕）→ 不再判 `unknown_field` → `mapStatus=ok`。core 完整收斂。
// 此 golden 由 T13.5 的 skeleton-partial 於 T14.4 升 full-map（contract drift-guard 逼出的一次有意識對帳）。
import type { MapperGolden } from './golden.types';

export const aiGoogleSearchV1Golden: MapperGolden = {
  id: 'extension|googleSearch|v1',
  coverage: 'full-map',
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
    mapStatus: 'ok',
    reasons: [],
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
