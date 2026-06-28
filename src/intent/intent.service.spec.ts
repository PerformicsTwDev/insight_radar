import { IntentService } from './intent.service';
import type { IntentLabeler, ParseChatParams, ParseChatResult } from './intent-labeler.port';
import { INTENT_LABELS } from './intent.schema';

/** Fake labeler: records every parseChat call, echoes each keyword with a default label. */
class FakeLabeler implements IntentLabeler {
  public readonly calls: ParseChatParams[] = [];
  parseChat<T>(params: ParseChatParams): Promise<ParseChatResult<T>> {
    this.calls.push(params);
    const keywords = extractKeywords(params);
    const results = keywords.map((keyword) => ({ keyword, labels: ['informational'] }));
    return Promise.resolve({ parsed: { results } as T, refusal: null });
  }
}

/** Pull the keyword array out of the user message (JSON-encoded). */
function extractKeywords(params: ParseChatParams): string[] {
  const userMsg = params.messages.find((m) => m.role === 'user');
  const match = userMsg?.content.match(/\[[\s\S]*\]/);
  return match ? (JSON.parse(match[0]) as string[]) : [];
}

const config = (batchSize: number) => ({ batchSize });

describe('IntentService.labelBatch (T2.3)', () => {
  it('chunks keywords at the configured batch size (default 30)', async () => {
    const fake = new FakeLabeler();
    const service = new IntentService(fake, config(30));
    const keywords = Array.from({ length: 65 }, (_, i) => `kw-${i}`);
    await service.labelBatch(keywords);
    expect(fake.calls).toHaveLength(3); // 30 + 30 + 5
  });

  it('sends temperature=0 and a ~4000 max_completion_tokens cap', async () => {
    const fake = new FakeLabeler();
    const service = new IntentService(fake, config(30));
    await service.labelBatch(['coffee']);
    expect(fake.calls[0].temperature).toBe(0);
    expect(fake.calls[0].maxCompletionTokens).toBe(4000);
  });

  it('uses the fixed intent json_schema (strict, named intent_labeling)', async () => {
    const fake = new FakeLabeler();
    const service = new IntentService(fake, config(30));
    await service.labelBatch(['coffee']);
    expect(fake.calls[0].jsonSchema.name).toBe('intent_labeling');
  });

  it('builds a prompt defining all four intents and the per-keyword rules', async () => {
    const fake = new FakeLabeler();
    const service = new IntentService(fake, config(30));
    await service.labelBatch(['coffee']);
    const system = fake.calls[0].messages.find((m) => m.role === 'system')?.content ?? '';
    for (const label of INTENT_LABELS) {
      expect(system).toContain(label);
    }
    // 規則指示（≥1 label / 去重 / results 數=輸入數）
    expect(system.toLowerCase()).toMatch(/at least one|至少/);
  });

  it('passes the batch keywords as a JSON array in the user message', async () => {
    const fake = new FakeLabeler();
    const service = new IntentService(fake, config(30));
    await service.labelBatch(['coffee', 'tea']);
    expect(extractKeywords(fake.calls[0])).toEqual(['coffee', 'tea']);
  });

  it('returns one raw batch result per chunk (post-processing handled in T2.4)', async () => {
    const fake = new FakeLabeler();
    const service = new IntentService(fake, config(2));
    const out = await service.labelBatch(['a', 'b', 'c']);
    expect(out).toHaveLength(2); // 2 chunks
    expect(out[0].parsed?.results.map((r) => r.keyword)).toEqual(['a', 'b']);
  });

  it('honours a configurable batch size', async () => {
    const fake = new FakeLabeler();
    const service = new IntentService(fake, config(40));
    await service.labelBatch(Array.from({ length: 41 }, (_, i) => `k${i}`));
    expect(fake.calls.map((c) => extractKeywords(c).length)).toEqual([40, 1]);
  });

  it('falls back to the default batch size (30) when config batchSize is invalid', async () => {
    const fake = new FakeLabeler();
    const service = new IntentService(fake, config(0)); // 0 → default 30
    await service.labelBatch(Array.from({ length: 31 }, (_, i) => `k${i}`));
    expect(fake.calls.map((c) => extractKeywords(c).length)).toEqual([30, 1]);
  });

  it('returns an empty array for no keywords (no LLM call)', async () => {
    const fake = new FakeLabeler();
    const service = new IntentService(fake, config(30));
    expect(await service.labelBatch([])).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });
});
