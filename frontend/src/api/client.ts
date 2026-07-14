import createClient from 'openapi-fetch';
import { config } from '../config/env';
import type { paths } from './schema';

/**
 * 型別安全 API client（openapi-fetch；型別 `paths` 由 `pnpm openapi:gen` 自後端 `openapi.json` 產出）。
 * 業務元件**只**經此 client 打後端（Design §3：`api/` 為唯一對後端出口，禁繞過 `fetch`）。
 *
 * 同源部署（Design §1）：openapi path 已含 `/api/v1` 前綴 → `baseUrl` = 當前 origin（`window.location.origin`；
 * 開發期 Vite dev proxy 轉 `/api` 到後端）。**用絕對 origin 而非相對 `''`**：Node/undici `fetch`（Vitest+MSW）
 * 無法 parse 相對 URL，jsdom origin（`http://localhost:3000`）則 MSW 依 pathname 攔截。base URL 之後由
 * T0.6 config（`VITE_*`）視需覆寫（跨 host 部署時）。
 */
export const api = createClient<paths>({
  // `config.apiBaseUrl`（`VITE_API_BASE_URL`）覆寫；預設 `''` → 同源（`window.location.origin`）。
  baseUrl: config.apiBaseUrl || window.location.origin,
  // openapi-fetch 於 createClient 時**捕獲** `globalThis.fetch`（模組載入時）。MSW（Vitest）於
  // `beforeAll` 才 patch `globalThis.fetch`——若捕獲舊參照則 test 會打到真網路（ECONNREFUSED）。
  // 用 wrapper 於**呼叫時**動態解析 `globalThis.fetch` → 拿到 MSW patched 版（prod 無害、就是瀏覽器 fetch）。
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});
