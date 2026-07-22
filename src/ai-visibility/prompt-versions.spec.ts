import { aiVisibilitySchemaVersion } from './prompt-versions';

/**
 * TC-78 (部分) / §14 config — AI 可見度分析版本 namespace（落列 tag / idempotency；bump 整批失效）。預設 `v1`，
 * 可經 env 覆寫（`AI_VISIBILITY_SCHEMA_VERSION`）。入 Joi + `.env.example` 屬 T15.7。
 *
 * M15-R6/#688：三線 per-prompt 版本（brandExtract/sentiment/mediaClassify）production 零消費 → 已移除；
 * `aiVisibilitySchemaVersion()` 為唯一 invalidation lever。
 */
describe('TC-78: AI visibility schema version namespace', () => {
  const KEY = 'AI_VISIBILITY_SCHEMA_VERSION';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('defaults to v1 when the env var is unset', () => {
    expect(aiVisibilitySchemaVersion()).toBe('v1');
  });

  it('honours an env override (bump → 下游落列 tag / idempotency 整批失效)', () => {
    process.env.AI_VISIBILITY_SCHEMA_VERSION = 'v2';
    expect(aiVisibilitySchemaVersion()).toBe('v2');
  });
});
