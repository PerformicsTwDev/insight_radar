import { Inject, Injectable } from '@nestjs/common';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import { canonicalStringify } from '../common/canonical-json';
import { sha256Hex } from '../common/sha256';
import { AzureOpenAiService } from '../intent/azure-openai.service';
import type { IntentLabeler, ParseChatResult } from '../intent/intent-labeler.port';
import { buildAiIntentSummaryMessages } from './ai-intent-summary.prompt';
import {
  type AiIntentSummaryPayload,
  aiIntentSummaryResponseFormat,
} from './ai-intent-summary.schema';
import type { AiIntentSummary, SerpCapture } from './ai-intent-summary.types';
import { SerpNotCapturedError } from './serp-not-captured.error';

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
 * per-keyword AI 意圖摘要服務（T12.1，FR-31 / AC-31.2/31.3/31.4/31.6；Design §17.4）——**SERP-grounded**。
 * 本 task 僅實作「service + 快取」；HTTP 端點（scope keyword/snapshot、409 映射、owner/readiness）為 T12.2。
 *
 * **複用既有元件**：
 * - `AzureOpenAiService`（T2.1）：單次同步小完成（strict `json_schema`、temperature 0、`maxRetries=5`）。
 * - `CacheService`（cache-manager v6）：key `ai_intent_summary:v{ver}:{dep}:sha256(nt + serpHash)`；命中不重打 LLM。
 * - `buildIsolatedMessages`（S19，經 `ai-intent-summary.prompt`）：SERP＝第三方不可信內容 → 指令/資料分離。
 *
 * 流程：**grounding-first gate**（無 SERP 捕獲→{@link SerpNotCapturedError}=`serp_not_captured`，AC-31.6）→
 * 以 SERP 內容算 `serpHash` → cache 命中即回（免 LLM，AC-31.3）→ miss 單次 LLM → 快取。**LLM 失敗**
 * （拋錯/refusal/malformed/空）→ 該字 `summary=null`、**不快取**、**不污染他字**（批次 partial，AC-31.4）。
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
    // grounding-first gate（AC-31.6）：無 SERP 捕獲（或空捕獲＝零內容）→ 不臆造、拋 gate error（T12.2→409）。
    // 早於任何 cache/LLM：無 grounding 不得產出、不得寫負快取。
    if (!hasSerpContent(serpCapture)) {
      throw new SerpNotCapturedError(nt);
    }

    // serpHash = 內容定址（同 SERP→同 hash→命中；重抓後內容變→新 hash→失效，AC-31.3）。references 缺→[]。
    const serpHash = sha256Hex(
      canonicalStringify({ blocks: serpCapture.blocks, references: serpCapture.references ?? [] }),
    );
    const key = this.cacheKey(nt, serpHash);

    const cached = await this.cache.get<AiIntentSummary>(key);
    if (cached !== undefined) {
      return cached; // 命中：不重打 LLM（AC-31.3）
    }

    const summary = await this.generateSummary(nt, serpCapture);
    const result: AiIntentSummary = { normalizedText: nt, summary };

    // 只快取成功結果——失敗（summary=null）不寫負快取，讓後續重送可重試（AC-31.4）。
    if (summary !== null) {
      await this.cache.set(key, result, this.config.cacheTtlMs);
    }
    return result;
  }

  /** 快取 key：`ai_intent_summary:v{ver}:{dep}:sha256(nt + serpHash)`（AC-31.3；nt 為去重/快取同一 key）。 */
  private cacheKey(nt: string, serpHash: string): string {
    const digest = sha256Hex(`${nt}${serpHash}`);
    return this.cache.buildKey(
      CacheNamespace.AI_INTENT_SUMMARY,
      this.config.schemaVersion,
      this.config.deployment,
      digest,
    );
  }

  /**
   * 單次同步小完成（strict schema、temperature 0）。**任何**失敗（拋錯/refusal/malformed/空摘要）→ `null`
   * （批次 partial：該字 summary=null、不污染他字，AC-31.4）——非拋錯（gate 才拋）。SERP 經 `buildIsolatedMessages`
   * 隔離（S19），關鍵字（第一方）於 system 指令。
   */
  private async generateSummary(nt: string, serpCapture: SerpCapture): Promise<string | null> {
    const responseFormat = aiIntentSummaryResponseFormat();
    let result: ParseChatResult<AiIntentSummaryPayload>;
    try {
      result = await this.labeler.parseChat<AiIntentSummaryPayload>({
        messages: buildAiIntentSummaryMessages(nt, serpCapture),
        jsonSchema: {
          name: responseFormat.json_schema.name,
          schema: responseFormat.json_schema.schema as Record<string, unknown>,
        },
        temperature: 0,
        maxCompletionTokens: this.config.maxCompletionTokens,
      });
    } catch {
      return null; // 傳輸/SDK 失敗（含 maxRetries 用盡）→ partial null
    }

    const summary = result.parsed?.summary;
    if (result.refusal !== null || typeof summary !== 'string' || summary.trim() === '') {
      return null; // refusal/malformed/空 → partial null
    }
    return summary;
  }
}

/**
 * grounding-first 判定：有無可歸納的 SERP grounding。null/undefined，或 blocks 與 references 皆空 → 無 grounding
 * （不得臆造，AC-31.6）。
 */
function hasSerpContent(serpCapture: SerpCapture | null | undefined): serpCapture is SerpCapture {
  if (serpCapture == null) {
    return false;
  }
  const blocks = Array.isArray(serpCapture.blocks) ? serpCapture.blocks : [];
  const references = Array.isArray(serpCapture.references) ? serpCapture.references : [];
  return blocks.length > 0 || references.length > 0;
}
