import { Inject, Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { AzureOpenAiService } from '../intent/azure-openai.service';
import type { IntentLabeler } from '../intent/intent-labeler.port';
import type { AiIntentSummary, SerpCapture } from './ai-intent-summary.types';

/** DI token：`{ schemaVersion, deployment, cacheTtlMs, maxCompletionTokens }`（由 cache + azure config 組裝）。 */
export const AI_INTENT_SUMMARY_CONFIG = Symbol('AI_INTENT_SUMMARY_CONFIG');

export interface AiIntentSummaryConfig {
  /** 快取 namespace 版本（`ai_intent_summary:v{ver}:...`；bump 整批失效，AC-31.3）。 */
  schemaVersion: string;
  /** Azure 部署名（cache namespace 的 `{deployment}` 段；換部署自然失效）。 */
  deployment: string;
  /** 快取 TTL（毫秒）。 */
  cacheTtlMs: number;
  /** 長文摘要 `max_completion_tokens`（避免 `finish_reason=length` 截斷；env `AI_SUMMARY_MAX_TOKENS`）。 */
  maxCompletionTokens: number;
}

/**
 * per-keyword AI 意圖摘要服務（T12.1，FR-31 / AC-31.2/31.3/31.4/31.6；Design §17.4）——SERP-grounded。
 * 本 task 僅實作「service + 快取」；HTTP 端點（scope keyword/snapshot、409 映射）為 T12.2。
 */
@Injectable()
export class AiIntentSummaryService {
  constructor(
    @Inject(AzureOpenAiService) private readonly labeler: IntentLabeler,
    private readonly cache: CacheService,
    @Inject(AI_INTENT_SUMMARY_CONFIG) private readonly config: AiIntentSummaryConfig,
  ) {}

  async summarize(
    nt: string,
    serpCapture: SerpCapture | null | undefined,
  ): Promise<AiIntentSummary> {
    await Promise.resolve();
    void nt;
    void serpCapture;
    throw new Error('AiIntentSummaryService.summarize not implemented');
  }
}
