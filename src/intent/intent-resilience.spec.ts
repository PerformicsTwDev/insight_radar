import {
  BadRequestError,
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from 'openai/core/error';
import { IntentService } from './intent.service';
import type { IntentLabeler, ParseChatParams, ParseChatResult } from './intent-labeler.port';
import type { IntentBatch } from './intent.schema';

/** Pull the keyword array out of the user message (JSON-encoded). */
function keywordsOf(params: ParseChatParams): string[] {
  const userMsg = params.messages.find((m) => m.role === 'user');
  const match = userMsg?.content.match(/\[[\s\S]*\]/);
  return match ? (JSON.parse(match[0]) as string[]) : [];
}

/** Programmable labeler driven by a per-call behaviour function over the batch keywords. */
class ScriptedLabeler implements IntentLabeler {
  public readonly batches: string[][] = [];
  constructor(private readonly behave: (keywords: string[]) => ParseChatResult<IntentBatch>) {}
  parseChat<T>(params: ParseChatParams): Promise<ParseChatResult<T>> {
    const keywords = keywordsOf(params);
    this.batches.push(keywords);
    return Promise.resolve(this.behave(keywords) as unknown as ParseChatResult<T>);
  }
}

const PARAMS_CONFIG = { batchSize: 4 };
const ok = (keywords: string[]): ParseChatResult<IntentBatch> => ({
  parsed: { results: keywords.map((k) => ({ keyword: k, labels: ['commercial'] })) },
  refusal: null,
});

describe('IntentService.labelKeywords resilience (T2.5 / TC-8)', () => {
  it('splits a batch in half and retries on a length error, then succeeds', async () => {
    const labeler = new ScriptedLabeler((keywords) => {
      if (keywords.length > 2) throw new LengthFinishReasonError();
      return ok(keywords);
    });
    const service = new IntentService(labeler, PARAMS_CONFIG);
    const out = await service.labelKeywords(['a', 'b', 'c', 'd']);

    expect(out).toHaveLength(4);
    // first the full batch of 4 (throws), then two halves of 2
    expect(labeler.batches[0]).toHaveLength(4);
    expect(labeler.batches.slice(1).map((b) => b.length)).toEqual([2, 2]);
    for (const r of out) expect(r.labels).toEqual(['commercial']);
  });

  it('falls back to informational for the single keyword when length persists at size 1', async () => {
    const labeler = new ScriptedLabeler((keywords) => {
      if (keywords.includes('huge')) throw new LengthFinishReasonError();
      return ok(keywords);
    });
    const service = new IntentService(labeler, { batchSize: 2 });
    const out = await service.labelKeywords(['huge', 'small']);

    expect(out.find((r) => r.keyword === 'huge')?.labels).toEqual(['informational']); // fallback
    expect(out.find((r) => r.keyword === 'small')?.labels).toEqual(['commercial']);
  });

  it('falls back the whole batch on a content-filter error', async () => {
    const labeler = new ScriptedLabeler(() => {
      throw new ContentFilterFinishReasonError();
    });
    const service = new IntentService(labeler, { batchSize: 4 });
    const out = await service.labelKeywords(['x', 'y']);

    expect(out.map((r) => r.labels)).toEqual([['informational'], ['informational']]);
  });

  it('falls back the batch on a model refusal (parsed null + refusal text)', async () => {
    const labeler = new ScriptedLabeler(() => ({ parsed: null, refusal: 'no' }));
    const service = new IntentService(labeler, { batchSize: 4 });
    const out = await service.labelKeywords(['x']);
    expect(out[0].labels).toEqual(['informational']);
  });

  it('records keywords needing manual review (filter/refusal fallbacks)', async () => {
    const labeler = new ScriptedLabeler((keywords) => {
      if (keywords.includes('bad')) throw new ContentFilterFinishReasonError();
      return ok(keywords);
    });
    const service = new IntentService(labeler, { batchSize: 1 });
    const result = await service.labelKeywordsWithReview(['good', 'bad']);

    expect(result.needsReview).toEqual(['bad']);
    expect(result.labeled.find((r) => r.keyword === 'good')?.labels).toEqual(['commercial']);
  });

  it('does not flag length-split keywords as needs-review (only filter/refusal)', async () => {
    const labeler = new ScriptedLabeler((keywords) => {
      if (keywords.length > 1) throw new LengthFinishReasonError();
      return ok(keywords);
    });
    const service = new IntentService(labeler, { batchSize: 2 });
    const result = await service.labelKeywordsWithReview(['a', 'b']);
    expect(result.needsReview).toEqual([]);
  });

  it('returns empty (no LLM call) for no keywords', async () => {
    const labeler = new ScriptedLabeler(ok);
    const service = new IntentService(labeler, { batchSize: 4 });
    const out = await service.labelKeywords([]);
    expect(out).toEqual([]);
    expect(labeler.batches).toHaveLength(0);
  });

  it('re-throws an unexpected (non finish-reason) error', async () => {
    const labeler = new ScriptedLabeler(() => {
      throw new Error('network exploded');
    });
    const service = new IntentService(labeler, { batchSize: 4 });
    await expect(service.labelKeywords(['x'])).rejects.toThrow('network exploded');
  });

  // —— M2-R1：prompt-side content_filter（HTTP 400 BadRequestError）——
  it('falls back the batch on a prompt-side content_filter 400 (BadRequestError)', async () => {
    const labeler = new ScriptedLabeler(() => {
      // SDK stores the unwrapped error body; .code reads error.code (flat).
      throw new BadRequestError(
        400,
        { code: 'content_filter', message: 'blocked' },
        'content filter',
        new Headers(),
      );
    });
    const service = new IntentService(labeler, { batchSize: 4 });
    const result = await service.labelKeywordsWithReview(['x', 'y']);

    expect(result.labeled.map((r) => r.labels)).toEqual([['informational'], ['informational']]);
    expect(result.needsReview).toEqual(['x', 'y']); // flagged for manual review
  });

  it('re-throws a non-content_filter BadRequestError (e.g. unsupported temperature)', async () => {
    const labeler = new ScriptedLabeler(() => {
      throw new BadRequestError(
        400,
        { code: 'unsupported_value', param: 'temperature' },
        'bad request',
        new Headers(),
      );
    });
    const service = new IntentService(labeler, { batchSize: 4 });
    await expect(service.labelKeywords(['x'])).rejects.toBeInstanceOf(BadRequestError);
  });

  // —— M2-R2：malformed 模型輸出（缺 results）不得使整批崩潰 ——
  it('does not crash when parsed is non-null but results is missing/not an array', async () => {
    const labeler = new ScriptedLabeler(
      () => ({ parsed: {} as IntentBatch, refusal: null }), // finish_reason=stop but malformed
    );
    const service = new IntentService(labeler, { batchSize: 4 });
    const out = await service.labelKeywords(['a', 'b']);
    expect(out.map((r) => r.keyword)).toEqual(['a', 'b']);
    for (const r of out) expect(r.labels).toEqual(['informational']); // safe fallback, no throw
  });
});
