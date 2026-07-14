import { http, HttpResponse } from 'msw';
import type { paths } from '../schema';

/** `/health` 200 response 型別——由 openapi `paths` 契約約束 mock 形狀（不手寫、隨 codegen 漂移即編譯紅）。 */
type HealthOk = paths['/health']['get']['responses']['200']['content']['application/json'];

/**
 * MSW handlers——response 形狀由 openapi `paths` **型別約束**（對齊後端契約；Design §2 mock 政策：
 * 元件/契約測試在此攔截、不打真後端）。M1+ 各 view 依需擴充；per-test 覆寫用 `server.use(...)`。
 */
export const handlers = [
  http.get('/health', () =>
    HttpResponse.json<HealthOk>({
      status: 'ok',
      info: { database: { status: 'up' }, cache: { status: 'up' } },
      error: {},
      details: { database: { status: 'up' }, cache: { status: 'up' } },
    }),
  ),
];
