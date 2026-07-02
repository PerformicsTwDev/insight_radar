import type { SerpFetchResult, SerpQuery } from './serp.types';

/**
 * SERP 抓取的 Port（T8.3，FR-15，NFR-3 可測 / DI 可替換）。上層依賴此介面，不綁特定供應商 SDK。
 * 本期 adapter = `SerpApiProvider`；Phase 2 = `BrowserExtensionProvider`。`fetch` 語意含 durable
 * `serp_fetches` 的 freshness 窗重用（窗內回既有、超窗才打供應商並 append-only 寫入）。
 */
export const SERP_PROVIDER = Symbol('SERP_PROVIDER');

export interface SerpProvider {
  /** 抓一批關鍵字的 SERP（freshness 窗內重用既有、否則抓取 + append-only 保留歷史）。回與輸入對齊。 */
  fetch(queries: SerpQuery[]): Promise<SerpFetchResult[]>;
}
