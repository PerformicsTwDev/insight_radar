import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { serpAiConfig } from '../config/serp-ai.config';
import {
  SERPAPI_AI_CLIENT,
  type SerpAiProvider,
  type SerpApiAiClient,
  type SerpApiAiOverviewResult,
} from './serpapi-ai.types';

/**
 * SerpApi AI Overview adapter（T14.2，FR-38，reserved）——not-implemented 空殼（red）。
 */
@Injectable()
export class SerpApiAiProvider implements SerpAiProvider {
  constructor(
    @Inject(SERPAPI_AI_CLIENT) private readonly client: SerpApiAiClient,
    @Inject(serpAiConfig.KEY) private readonly config: ConfigType<typeof serpAiConfig>,
  ) {}

  fetchAiOverviews(_keywords: string[]): Promise<SerpApiAiOverviewResult[]> {
    void this.client;
    void this.config;
    throw new Error('not implemented');
  }
}
