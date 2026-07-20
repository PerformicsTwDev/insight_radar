// grounded in Design §18.5; pending extension type.ts reconciliation at T13.6
//
// Social 線 · threadsApi（reserved，`THREADS_API_ENABLED=false`）· threads · v1 — SKELETON-PARTIAL（pending T16.5 whitelist 擴充）。
// Design §18.5：Threads 官方 API `keyword_search` **互動數硬缺口 → metrics=null 不補 0**（S14；他人貼文 insights 拿不到）；
// reserved API 僅補全文。Graph API 回傳 `{id,username,text,permalink,timestamp}`——`id` 為 per-platform 專屬欄位、骨架白名單
// 暫未涵蓋 → `unknown_field:id` → `mapStatus=partial`（AC-37.4 漂移預警，**非 bug**）。core（content/postKey）仍完整收斂、
// metrics 全 null（S14）。timestamp 已是 ISO-8601 → 原樣（不重解讀既有位移）。per-platform 實欄位收斂屬 M16 T16.5（屆時 partial→ok）。
import type { MapperGolden } from './golden.types';

export const socialThreadsApiV1Golden: MapperGolden = {
  id: 'threadsApi|threads|v1',
  coverage: 'skeleton-partial',
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
      // 尾斜線去除、host 收斂、**保留 shortcode `DAbCdEf` 大小寫**（path 大小寫敏感，S13）。
      permalink: 'https://www.threads.net/@gadget_reviews/post/DAbCdEf/',
      timestamp: '2025-11-20T14:30:00+00:00',
    },
  },
  expected: {
    mapStatus: 'partial',
    reasons: ['unknown_field:id'],
    canonical: {
      source: 'threadsApi',
      platform: 'threads',
      schemaVersion: 'v1',
      postKey: 'https://www.threads.net/@gadget_reviews/post/DAbCdEf',
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
