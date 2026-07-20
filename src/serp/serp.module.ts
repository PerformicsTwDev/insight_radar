import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { serpConfig } from '../config/serp.config';
import { serpAiConfig } from '../config/serp-ai.config';
import { BrowserExtensionProvider } from './browser-extension.provider';
import { HttpSerpApiClient } from './http-serp-api.client';
import { HttpSerpApiAiClient } from './http-serpapi-ai.client';
import { SerpApiProvider } from './serp-api.provider';
import { SERP_API_CLIENT } from './serp-api.types';
import { SerpApiAiProvider } from './serpapi-ai.provider';
import { SERP_AI_PROVIDER, SERPAPI_AI_CLIENT } from './serpapi-ai.types';
import { SERP_PROVIDER } from './serp-provider.port';
import { SerpRepository } from './serp.repository';
import { SerpService } from './serp.service';

/**
 * SERP 模組（T8.3，FR-15）。對外只露 {@link SERP_PROVIDER}（= {@link SerpService} freshness 編排）；
 * 內部 SerpApiProvider（raw serpapi adapter over HTTP client）+ durable {@link SerpRepository}。憑證從 config
 * 注入、不寫死；SERP_ENABLED=false 時 SerpService 短路（HTTP client 不被呼叫）。BrowserExtensionProvider 為
 * Phase 2 stub（保留 DI，未接選路）。
 *
 * **SerpApi AI adapters（T14.2，FR-38，reserved）**：{@link SerpApiAiProvider}（AI Overview 兩路 + degradation）
 * 經 {@link SERPAPI_AI_CLIENT} 抓取；憑證/端點沿用 SERP。**建置入 DI 但不接線到 live 抓取**（比照
 * BrowserExtensionProvider stub）——{@link SERP_AI_PROVIDER} 供 T14.6 AI Search job 消費，本期 SerpService 不經此路。
 */
@Module({
  imports: [ConfigModule.forFeature(serpConfig), ConfigModule.forFeature(serpAiConfig)],
  providers: [
    SerpRepository,
    SerpApiProvider,
    SerpService,
    BrowserExtensionProvider,
    {
      provide: SERP_API_CLIENT,
      useFactory: (config: ConfigType<typeof serpConfig>) =>
        new HttpSerpApiClient(config.apiUrl ?? '', config.apiKey ?? ''),
      inject: [serpConfig.KEY],
    },
    // SerpApi AI HTTP client（reserved）：engine=google / google_ai_overview；憑證沿用 SERP。
    {
      provide: SERPAPI_AI_CLIENT,
      useFactory: (config: ConfigType<typeof serpConfig>) =>
        new HttpSerpApiAiClient(config.apiUrl ?? '', config.apiKey ?? ''),
      inject: [serpConfig.KEY],
    },
    SerpApiAiProvider,
    { provide: SERP_AI_PROVIDER, useExisting: SerpApiAiProvider },
    { provide: SERP_PROVIDER, useExisting: SerpService },
  ],
  exports: [SERP_PROVIDER, SERP_AI_PROVIDER],
})
export class SerpModule {}
