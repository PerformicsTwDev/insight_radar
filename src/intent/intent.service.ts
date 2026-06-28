import { Inject, Injectable } from '@nestjs/common';
import { INTENT_LABELER, type IntentLabeler, type ParseChatResult } from './intent-labeler.port';
import { type IntentBatch, intentResponseFormat } from './intent.schema';
import { buildIntentMessages } from './intent.prompt';

/** 上限 completion tokens（避免 `finish_reason=length` 截斷；Design §4.2 ~4000）。 */
const MAX_COMPLETION_TOKENS = 4000;
/** 預設每批關鍵字數（25–40，預設 30；Design §4.2 / config LLM_BATCH_SIZE）。 */
const DEFAULT_BATCH_SIZE = 30;

export interface IntentServiceConfig {
  batchSize: number;
}

/**
 * Intent 批次貼標（T2.3，FR-4/NFR-4）。把關鍵字切批（預設 30），每批以固定 strict json_schema
 * + `temperature=0` + `max_completion_tokens≈4000` 呼叫 LLM。**回傳各批原始結果**；
 * 去重/對回輸入/fallback/補齊由後處理（T2.4）負責。
 */
@Injectable()
export class IntentService {
  private readonly batchSize: number;

  constructor(
    @Inject(INTENT_LABELER) private readonly labeler: IntentLabeler,
    @Inject('INTENT_SERVICE_CONFIG') config: IntentServiceConfig,
  ) {
    this.batchSize = config.batchSize > 0 ? Math.floor(config.batchSize) : DEFAULT_BATCH_SIZE;
  }

  async labelBatch(keywords: string[]): Promise<ParseChatResult<IntentBatch>[]> {
    const responseFormat = intentResponseFormat();
    const results: ParseChatResult<IntentBatch>[] = [];
    for (let i = 0; i < keywords.length; i += this.batchSize) {
      const chunk = keywords.slice(i, i + this.batchSize);
      const result = await this.labeler.parseChat<IntentBatch>({
        messages: buildIntentMessages(chunk),
        jsonSchema: {
          name: responseFormat.json_schema.name,
          schema: responseFormat.json_schema.schema as Record<string, unknown>,
        },
        temperature: 0,
        maxCompletionTokens: MAX_COMPLETION_TOKENS,
      });
      results.push(result);
    }
    return results;
  }
}
