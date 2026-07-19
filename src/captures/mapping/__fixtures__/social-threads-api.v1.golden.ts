// grounded in Design §18.5; pending extension type.ts reconciliation at T13.6
//
// Social 線 · threadsApi（reserved，`THREADS_API_ENABLED=false`）· threads · v1.
// Design §18.5：Threads 官方 API `keyword_search` **互動數硬缺口 → metrics=null 不補 0**（S14；他人貼文 insights 拿不到）；
// reserved API 僅補全文。Graph API 回傳 `{id,username,text,permalink,timestamp}`——`id` 為 per-platform 專屬欄位、
// 骨架白名單暫未涵蓋（per-platform 實欄位屬 M16 T16.5）。timestamp 已是 ISO-8601 → 原樣（不重解讀既有位移）。
// 初始假設：骨架應能完整收斂本平台 → full-map。（RED：由 contract test 對現行骨架驗證後對帳。）
import type { MapperGolden } from './golden.types';

export const socialThreadsApiV1Golden: MapperGolden = {
  id: 'threadsApi|threads|v1',
  coverage: 'full-map',
  fixtureVersion: 1,
  input: {
    source: 'threadsApi',
    platform: 'threads',
    schemaVersion: 'v1',
    capturedAt: '2025-11-21T00:00:00.000Z',
    payload: {
      id: '17901234567890123',
      username: 'gadget_reviews',
      text: 'New foldable phone hands-on. Hinge feels sturdy, screen crease barely visible.',
      permalink: 'https://www.threads.net/@gadget_reviews/post/DAbCdEf/',
      timestamp: '2025-11-20T14:30:00+00:00',
    },
  },
  expected: {
    mapStatus: 'ok',
    reasons: [],
    canonical: {
      source: 'threadsApi',
      platform: 'threads',
      schemaVersion: 'v1',
      postKey: 'https://www.threads.net/@gadget_reviews/post/dabcdef',
      author: 'gadget_reviews',
      profileLink: null,
      content: 'New foldable phone hands-on. Hinge feels sturdy, screen crease barely visible.',
      publishedAt: '2025-11-20T14:30:00+00:00',
      // reserved API 互動數硬缺口 → null（S14 不補 0）。
      likes: null,
      comments: null,
      reposts: null,
      shares: null,
      capturedAt: '2025-11-21T00:00:00.000Z',
    },
  },
};
