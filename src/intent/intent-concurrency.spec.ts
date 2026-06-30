import { IntentService } from './intent.service';
import type { IntentLabeler, ParseChatParams, ParseChatResult } from './intent-labeler.port';

/** 從 user message（JSON 陣列）取回關鍵字。 */
function extractKeywords(params: ParseChatParams): string[] {
  const userMsg = params.messages.find((m) => m.role === 'user');
  const match = userMsg?.content.match(/\[[\s\S]*\]/);
  return match ? (JSON.parse(match[0]) as string[]) : [];
}

/** flush microtasks + timers，讓 p-limit 把可並發的任務派出去。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('IntentService LLM concurrency (T3.7 / TC-33, AC-12.5)', () => {
  it('bounds concurrent LLM calls to llmConcurrency (p-limit 4–8)', async () => {
    let inFlight = 0;
    let peak = 0;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const labeler: IntentLabeler = {
      async parseChat<T>(params: ParseChatParams): Promise<ParseChatResult<T>> {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gate;
        inFlight -= 1;
        const results = extractKeywords(params).map((keyword) => ({
          keyword,
          labels: ['informational'],
        }));
        return { parsed: { results } as T, refusal: null };
      },
    };

    const service = new IntentService(labeler, { batchSize: 1, llmConcurrency: 3 });
    const keywords = Array.from({ length: 10 }, (_, i) => `kw-${i}`); // batchSize 1 → 10 prompts
    const pending = service.labelKeywords(keywords);

    await flush(); // 讓 p-limit 派出第一批並發
    expect(peak).toBe(3); // 上限 = llmConcurrency（其餘 7 排隊）

    openGate();
    const out = await pending;
    expect(out).toHaveLength(10); // 全部貼標
    expect(peak).toBe(3); // 全程未超過上限（且 >1 → 確有並發）
  });

  it('dispatches label chunks while still consuming later text batches (streaming overlap)', async () => {
    const events: string[] = [];
    let releaseBatch2!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseBatch2 = resolve;
    });
    async function* textBatches(): AsyncGenerator<string[]> {
      events.push('produce:batch1');
      yield ['a']; // batchSize 1 → 立即可派
      await gate; // 第二批等待第一批貼標
      events.push('produce:batch2');
      yield ['b'];
    }
    const labeler: IntentLabeler = {
      parseChat<T>(params: ParseChatParams): Promise<ParseChatResult<T>> {
        const keywords = extractKeywords(params);
        events.push(`label:${keywords.join(',')}`);
        if (keywords.includes('a')) {
          releaseBatch2(); // 貼標第一批即釋放第二批產出
        }
        return Promise.resolve({
          parsed: {
            results: keywords.map((k) => ({ keyword: k, labels: ['informational'] })),
          } as T,
          refusal: null,
        });
      },
    };

    const service = new IntentService(labeler, { batchSize: 1, llmConcurrency: 4 });
    const out = await service.labelStream(textBatches());

    expect(out.labeled.map((l) => l.keyword).sort()).toEqual(['a', 'b']);
    // 第一批貼標早於第二批產出 → labelStream 邊消費邊派批（非全收完才貼標）。
    expect(events.indexOf('label:a')).toBeLessThan(events.indexOf('produce:batch2'));
  });

  it('defaults to a sane concurrency when llmConcurrency is omitted', async () => {
    const calls: string[][] = [];
    const labeler: IntentLabeler = {
      parseChat<T>(params: ParseChatParams): Promise<ParseChatResult<T>> {
        const keywords = extractKeywords(params);
        calls.push(keywords);
        return Promise.resolve({
          parsed: {
            results: keywords.map((k) => ({ keyword: k, labels: ['informational'] })),
          } as T,
          refusal: null,
        });
      },
    };
    const service = new IntentService(labeler, { batchSize: 30 }); // 無 llmConcurrency
    const out = await service.labelKeywords(Array.from({ length: 65 }, (_, i) => `k-${i}`));
    expect(out).toHaveLength(65);
    expect(calls).toHaveLength(3); // 30 + 30 + 5（並發不改變呼叫數）
  });
});
