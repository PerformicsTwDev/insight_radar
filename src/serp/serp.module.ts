import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { serpConfig } from '../config/serp.config';
import { BrowserExtensionProvider } from './browser-extension.provider';
import { HttpSerpApiClient } from './http-serp-api.client';
import { SerpApiProvider } from './serp-api.provider';
import { SERP_API_CLIENT } from './serp-api.types';
import { SERP_PROVIDER } from './serp-provider.port';
import { SerpRepository } from './serp.repository';
import { SerpService } from './serp.service';

/**
 * SERP 模組（T8.3，FR-15）。對外只露 {@link SERP_PROVIDER}（= {@link SerpService} freshness 編排）；
 * 內部 SerpApiProvider（raw serpapi adapter over HTTP client）+ durable {@link SerpRepository}。憑證從 config
 * 注入、不寫死；SERP_ENABLED=false 時 SerpService 短路（HTTP client 不被呼叫）。BrowserExtensionProvider 為
 * Phase 2 stub（保留 DI，未接選路）。
 */
@Module({
  imports: [ConfigModule.forFeature(serpConfig)],
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
    { provide: SERP_PROVIDER, useExisting: SerpService },
  ],
  exports: [SERP_PROVIDER],
})
export class SerpModule {}
