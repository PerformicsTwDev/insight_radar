import {
  brandExtractPromptVersion,
  mediaClassifyPromptVersion,
  sentimentPromptVersion,
} from './prompt-versions';

/**
 * TC-78 (部分) / §14 config — prompt 版本化 namespace（快取用；S17/S19）。預設 `v1`，可經 env 覆寫
 * （`BRAND_EXTRACT_PROMPT_VERSION`/`SENTIMENT_PROMPT_VERSION`/`MEDIA_CLASSIFY_PROMPT_VERSION`）。
 * 入 Joi + `.env.example` 屬 T15.7。
 */
describe('TC-78: prompt version namespaces', () => {
  const ENV_KEYS = [
    'BRAND_EXTRACT_PROMPT_VERSION',
    'SENTIMENT_PROMPT_VERSION',
    'MEDIA_CLASSIFY_PROMPT_VERSION',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('defaults to v1 when the env var is unset', () => {
    expect(brandExtractPromptVersion()).toBe('v1');
    expect(sentimentPromptVersion()).toBe('v1');
    expect(mediaClassifyPromptVersion()).toBe('v1');
  });

  it('honours an env override', () => {
    process.env.BRAND_EXTRACT_PROMPT_VERSION = 'v3';
    process.env.SENTIMENT_PROMPT_VERSION = 'v2';
    process.env.MEDIA_CLASSIFY_PROMPT_VERSION = 'v5';
    expect(brandExtractPromptVersion()).toBe('v3');
    expect(sentimentPromptVersion()).toBe('v2');
    expect(mediaClassifyPromptVersion()).toBe('v5');
  });
});
