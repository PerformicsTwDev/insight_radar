// grounded in Design §18.3; pending extension type.ts reconciliation at T13.6
//
// AI 線 · extension · geminiApp · v1 — FULL-MAP。
// Design §18.3：Gemini `sources` **僅 grounded 有**（grounding 缺失 → `references=[]`，不編造）；grounded 引用形狀 `{name,url}`
// → 跨渠道收斂為統一 `{title,link,index}`（AC-37.3/39.3）。此 golden 為 grounding 命中案（sources 有）→ `mapStatus=ok`。
import type { MapperGolden } from './golden.types';

export const aiGeminiAppV1Golden: MapperGolden = {
  id: 'extension|geminiApp|v1',
  coverage: 'full-map',
  fixtureVersion: 1,
  input: {
    source: 'extension',
    channel: 'geminiApp',
    schemaVersion: 'v1',
    capturedAt: '2025-11-21T00:00:00.000Z',
    payload: {
      query: 'how does creatine improve strength',
      blocks: [
        'Creatine increases phosphocreatine stores, boosting short-burst power output.',
        'Meta-analyses report consistent strength gains with 3-5 g/day supplementation.',
      ],
      sources: [
        { name: 'Examine.com — Creatine', url: 'https://examine.com/creatine' },
        { name: 'PubMed 12345', url: 'https://pubmed.ncbi.nlm.nih.gov/12345' },
      ],
    },
  },
  expected: {
    mapStatus: 'ok',
    reasons: [],
    canonical: {
      source: 'extension',
      channel: 'geminiApp',
      schemaVersion: 'v1',
      query: 'how does creatine improve strength',
      blocks: [
        'Creatine increases phosphocreatine stores, boosting short-burst power output.',
        'Meta-analyses report consistent strength gains with 3-5 g/day supplementation.',
      ],
      // Gemini `{name,url}` → 收斂 `{title,link,index}`（跨渠道統一）。
      references: [
        { title: 'Examine.com — Creatine', link: 'https://examine.com/creatine', index: 0 },
        { title: 'PubMed 12345', link: 'https://pubmed.ncbi.nlm.nih.gov/12345', index: 1 },
      ],
      capturedAt: '2025-11-21T00:00:00.000Z',
    },
  },
};
