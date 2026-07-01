import { IntentService } from './intent.service';
import type { IntentLabeler, ParseChatParams, ParseChatResult } from './intent-labeler.port';
import { INTENT_LABELS } from './intent.schema';
import { JobMetrics } from '../observability/job-metrics';
import { JobMetricsContext } from '../observability/job-metrics.context';

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

  it('falls back to the default when batchSize floors below 1 (no infinite loop)', async () => {
    const fake = new FakeLabeler();
    const service = new IntentService(fake, config(0.5)); // floor 0 → default 30, must not hang
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

describe('IntentService shared-limiter metrics attribution (M7-R7 / TC-30 / NFR-6)', () => {
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  }
  const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

  it('attributes each job LLM call to its own JobMetrics even when the shared limiter dequeues a task in another job context', async () => {
    const ctx = new JobMetricsContext();
    const gate = deferred();
    let firstReleased = false;
    const attributed = new Map<string, JobMetrics | undefined>();

    // 模擬 AzureOpenAiService.parseChat（azure-openai.service.ts:56）於「當前 async 上下文」歸屬計數。
    const labeler: IntentLabeler = {
      async parseChat<T>(params: ParseChatParams): Promise<ParseChatResult<T>> {
        const keyword = extractKeywords(params)[0];
        attributed.set(keyword, ctx.current());
        if (keyword === 'a-kw' && !firstReleased) {
          firstReleased = true;
          await gate.promise; // A 占住唯一 slot，逼 B 的 task 進 limiter 佇列
        }
        return {
          parsed: { results: [{ keyword, labels: ['informational'] }] } as T,
          refusal: null,
        };
      },
    };

    const service = new IntentService(labeler, { batchSize: 1, llmConcurrency: 1 });
    const metricsA = new JobMetrics('job-A');
    const metricsB = new JobMetrics('job-B');

    const pA = ctx.run(metricsA, () => service.labelStream([['a-kw']]));
    await flush(); // A 的 task 入 limiter、跑到 gate
    const pB = ctx.run(metricsB, () => service.labelStream([['b-kw']]));
    await flush(); // B 的 task 排進佇列（slot 滿）
    gate.resolve(); // 放行 A → A 完成 → limiter 於 A 的 continuation 內 dequeue B 的 task
    await Promise.all([pA, pB]);

    // 各 job 正確歸屬；未綁 ALS context → B 的 parseChat 取到 metricsA（misattribution）。
    expect(attributed.get('a-kw')).toBe(metricsA);
    expect(attributed.get('b-kw')).toBe(metricsB);
  });
});
