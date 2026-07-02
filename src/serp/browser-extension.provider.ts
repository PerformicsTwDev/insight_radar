import { Injectable } from '@nestjs/common';
import type { SerpProvider } from './serp-provider.port';
import type { SerpFetchResult, SerpQuery } from './serp.types';

/**
 * Phase 2 stub（T8.3，Design §16）：web-insight-capture-wxt 擴充功能來源——把 `GoogleSearchData` map 到中立
 * `SerpResult`，並把較豐富頁面內容（markdown / AI overview）落 `serp_fetches.captured`。本期**未實作**：保留
 * 介面與 DI 形狀，之後接 provider 選路（SERP_PROVIDER=extension）。呼叫即擲錯，避免靜默回空誤導。
 */
@Injectable()
export class BrowserExtensionProvider implements SerpProvider {
  fetch(_queries: SerpQuery[]): Promise<SerpFetchResult[]> {
    return Promise.reject(
      new Error('BrowserExtensionProvider is a Phase 2 stub (not implemented in the MVP)'),
    );
  }
}
