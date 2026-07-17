import { Inject, Injectable } from '@nestjs/common';
import { normalizeText } from '../google-ads/normalize';
import { AzureOpenAiService } from '../intent/azure-openai.service';
import type { IntentLabeler, ParseChatResult } from '../intent/intent-labeler.port';
import { scrubSecrets } from '../logger/redaction';
import { IdeationGenerationError } from './ideation-generation.error';
import { buildIdeationMessages } from './ideation.prompt';
import { type IdeationPayload, ideationResponseFormat } from './ideation.schema';
import { IDEATION_TEMPLATES } from './ideation.templates';
import type { IdeationRequest, IdeationResult } from './ideation.types';

/** 上限 completion tokens（一批候選關鍵字；避免 `finish_reason=length` 截斷）。 */
const MAX_COMPLETION_TOKENS = 1500;
/** 發想略帶變化（generative）——非快取、非確定性讀取，故用中等溫度。 */
const IDEATION_TEMPERATURE = 0.7;

/** DI token：`{ maxKeywords }`（自 azure config 的 `ideationMaxKeywords` 組裝）。 */
export const IDEATION_CONFIG = Symbol('IDEATION_CONFIG');

export interface IdeationConfig {
  /** 去重後截斷的關鍵字數上限（`IDEATION_MAX_KEYWORDS`）。 */
  maxKeywords: number;
}

/**
 * AI 輔助發想服務（T12.10，FR-35 / AC-35.1/35.3/35.4）。**同步小端點**（單次 LLM，不打 Ads、不拓展、不快取——
 * 與 ai-insight/label-gen 同構的無狀態生成）。`template`（allowlist key）→ server-controlled directive + 種子詞
 * → strict `json_schema` `{ keywords:[string] }` → **去重（normalizedText 語意）+ 截斷至 `maxKeywords`**。**LLM 失敗**
 * （拋錯/refusal/malformed）→ {@link IdeationGenerationError}（不回半成品、訊息經 `scrubSecrets`，AC-35.1），非吞錯。
 */
@Injectable()
export class IdeationService {
  constructor(
    @Inject(AzureOpenAiService) private readonly labeler: IntentLabeler,
    @Inject(IDEATION_CONFIG) private readonly config: IdeationConfig,
  ) {}

  async generate(request: IdeationRequest): Promise<IdeationResult> {
    const directive = IDEATION_TEMPLATES[request.template]; // template 已由 DTO `@IsIn` 保證合法
    const responseFormat = ideationResponseFormat();
    let result: ParseChatResult<IdeationPayload>;
    try {
      result = await this.labeler.parseChat<IdeationPayload>({
        messages: buildIdeationMessages(directive, request.seeds),
        jsonSchema: {
          name: responseFormat.json_schema.name,
          schema: responseFormat.json_schema.schema as Record<string, unknown>,
        },
        temperature: IDEATION_TEMPERATURE,
        maxCompletionTokens: MAX_COMPLETION_TOKENS,
      });
    } catch (error) {
      throw new IdeationGenerationError(
        `AI ideation generation failed: ${scrubSecrets(String(error))}`,
        { cause: error },
      );
    }

    if (result.refusal !== null || !Array.isArray(result.parsed?.keywords)) {
      throw new IdeationGenerationError('AI ideation generation returned no usable keywords');
    }

    const keywords = dedupeKeywords(result.parsed.keywords).slice(0, this.config.maxKeywords);
    if (keywords.length === 0) {
      throw new IdeationGenerationError('AI ideation generation returned no usable keywords');
    }
    return { keywords };
  }
}

/** 去重（key = `normalizeText`，與去重/快取同一套語意）＋濾空白，保留首見的原字。 */
function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const keyword of keywords) {
    const key = normalizeText(keyword);
    if (key === '' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(keyword);
  }
  return out;
}
