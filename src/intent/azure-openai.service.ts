import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ResponseFormatJSONSchema } from 'openai/resources/shared';
import { JobMetricsContext } from '../observability/job-metrics.context';
import {
  AZURE_OPENAI_CLIENT,
  AZURE_OPENAI_DEPLOYMENT,
  type IntentLabeler,
  type OpenAiChatClient,
  type ParseChatParams,
  type ParseChatResult,
} from './intent-labeler.port';

/** openai `chat.completions.parse` 回應的最小形狀（只取本案需要的欄位）。 */
interface ParsedCompletion<T> {
  choices?: Array<{ message?: { parsed?: T | null; refusal?: string | null } }>;
}

/**
 * Azure OpenAI 低階呼叫（T2.1，FR-4/NFR-3）。包 `chat.completions.parse`，固定送出
 * structured-outputs `response_format: { type:'json_schema', json_schema:{ strict:true } }`。
 *
 * - client（`AzureOpenAI`，含 `maxRetries=5`/Retry-After，見 T2.6）經 DI 注入、可被 fake 替換。
 * - 對外只露 `IntentLabeler` 介面；上層不依賴 openai SDK 型別。
 */
@Injectable()
export class AzureOpenAiService implements IntentLabeler {
  constructor(
    @Inject(AZURE_OPENAI_CLIENT) private readonly client: OpenAiChatClient,
    @Inject(AZURE_OPENAI_DEPLOYMENT) private readonly deployment: string,
    // 可觀測（T7.2）：每次 LLM 呼叫 +1 external call（SDK 內部 429/5xx 重試不可見，見 note）；無 job 上下文 no-op。
    @Optional() private readonly metrics?: JobMetricsContext,
  ) {}

  async parseChat<T>(params: ParseChatParams): Promise<ParseChatResult<T>> {
    // 以 SDK 型別約束 response_format，使 camelCase 之類的 typo 在編譯期即被擋（避免 M1 類 wire-shape bug）。
    const responseFormat: ResponseFormatJSONSchema = {
      type: 'json_schema',
      json_schema: {
        name: params.jsonSchema.name,
        strict: true, // structured outputs 一律 strict（Design §4.2）
        schema: params.jsonSchema.schema,
      },
    };
    const request: Record<string, unknown> = {
      model: this.deployment,
      messages: params.messages,
      response_format: responseFormat,
    };
    if (params.temperature !== undefined) {
      request.temperature = params.temperature;
    }
    if (params.maxCompletionTokens !== undefined) {
      request.max_completion_tokens = params.maxCompletionTokens;
    }

    this.metrics?.current()?.addExternalCalls(); // 一次 LLM 呼叫（外部 API）
    const completion = (await this.client.chat.completions.parse(request)) as ParsedCompletion<T>;
    const message = completion.choices?.[0]?.message;
    return {
      parsed: message?.parsed ?? null,
      refusal: message?.refusal ?? null,
    };
  }
}
