// grounded in Design §18.5; pending extension type.ts reconciliation at T13.6
//
// Social 線 · extension · threads（extension `threadsSearch`）· v1 — FULL-MAP。
// Design §18.5：extension 從頁面讀互動數（`8K→8000` 正規化，S14 缺→null）；中文在地化時間 → ISO；`postKey=normalize(permalink)`
// ＝唯一去重鍵（S13，去 query/尾斜線/大小寫收斂）。骨架白名單全涵蓋 → `mapStatus=ok`（一次驗證 S13/S14/S20 三單點）。
import type { MapperGolden } from './golden.types';

export const socialThreadsSearchV1Golden: MapperGolden = {
  id: 'extension|threads|v1',
  coverage: 'full-map',
  fixtureVersion: 1,
  input: {
    source: 'extension',
    platform: 'threads',
    schemaVersion: 'v1',
    capturedAt: '2025-11-21T00:00:00.000Z',
    payload: {
      author: 'coffee_lover_tw',
      profileUrl: 'https://www.threads.net/@coffee_lover_tw',
      content: '剛入手 Breville 870，拉花超順手！大家有推薦的豆子嗎？',
      // permalink 帶 query string（`?igshid=...`）+ 大小寫 → postKey 收斂後去 query、轉小寫。
      permalink: 'https://www.threads.net/@coffee_lover_tw/post/C1a2b3c4?igshid=abc123',
      publishedAt: '2025年11月21日 星期五 上午2:01',
      likesCount: '8K',
      commentsCount: 128,
      repostsCount: '1.2K',
      sharesCount: 34,
    },
  },
  expected: {
    mapStatus: 'ok',
    reasons: [],
    canonical: {
      source: 'extension',
      platform: 'threads',
      schemaVersion: 'v1',
      postKey: 'https://www.threads.net/@coffee_lover_tw/post/c1a2b3c4',
      author: 'coffee_lover_tw',
      profileLink: 'https://www.threads.net/@coffee_lover_tw',
      content: '剛入手 Breville 870，拉花超順手！大家有推薦的豆子嗎？',
      publishedAt: '2025-11-21T02:01:00+08:00',
      likes: 8000,
      comments: 128,
      reposts: 1200,
      shares: 34,
      capturedAt: '2025-11-21T00:00:00.000Z',
    },
  },
};
