import {
  BadRequestError,
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from 'openai/core/error';
import type { ParseChatResult } from './intent-labeler.port';
import { resilientChunk } from './resilient-batch';

/** 單筆結果型別（本測試用任意 R；helper 不關心其形狀）。 */
interface R {
  id: string;
}

/** 依 chunk 內容驅動行為的可程式化 callBatch（記錄每次批次）。 */
function scripted(behave: (chunk: string[]) => ParseChatResult<{ results: R[] }>): {
  callBatch: (chunk: string[]) => Promise<ParseChatResult<{ results: R[] }>>;
  calls: string[][];
} {
  const calls: string[][] = [];
  const callBatch = (chunk: string[]): Promise<ParseChatResult<{ results: R[] }>> => {
    calls.push([...chunk]);
    return Promise.resolve(behave(chunk));
  };
  return { callBatch, calls };
}

const ok = (chunk: string[]): ParseChatResult<{ results: R[] }> => ({
  parsed: { results: chunk.map((id) => ({ id })) },
  refusal: null,
});

describe('resilientChunk (T12.5 shared skeleton / FR-4·FR-33 共用)', () => {
  it('splits a batch in half and retries on a length error, then succeeds', async () => {
    const { callBatch, calls } = scripted((chunk) => {
      if (chunk.length > 2) throw new LengthFinishReasonError();
      return ok(chunk);
    });
    const out = await resilientChunk(['a', 'b', 'c', 'd'], callBatch);

    expect(out.collected.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(out.needsReview).toEqual([]);
    expect(calls[0]).toHaveLength(4); // full batch first (throws)
    expect(calls.slice(1).map((c) => c.length)).toEqual([2, 2]); // then two halves
  });

  it('drops a single keyword (empty collected, no needsReview) when length persists at size 1', async () => {
    const { callBatch } = scripted((chunk) => {
      if (chunk.includes('huge')) throw new LengthFinishReasonError();
      return ok(chunk);
    });
    const out = await resilientChunk(['huge', 'small'], callBatch);

    expect(out.collected.map((r) => r.id)).toEqual(['small']); // 'huge' split to 1, still length → dropped
    expect(out.needsReview).toEqual([]); // length is not a review reason
  });

  it('sends the whole chunk to needsReview on a completion-side content_filter', async () => {
    const { callBatch } = scripted(() => {
      throw new ContentFilterFinishReasonError();
    });
    const out = await resilientChunk(['x', 'y'], callBatch);
    expect(out.collected).toEqual([]);
    expect(out.needsReview).toEqual(['x', 'y']);
  });

  it('sends the whole chunk to needsReview on a prompt-side content_filter 400 (BadRequestError)', async () => {
    const { callBatch } = scripted(() => {
      throw new BadRequestError(
        400,
        { code: 'content_filter', message: 'blocked' },
        'content filter',
        new Headers(),
      );
    });
    const out = await resilientChunk(['x', 'y'], callBatch);
    expect(out.collected).toEqual([]);
    expect(out.needsReview).toEqual(['x', 'y']);
  });

  it('sends the whole chunk to needsReview on a model refusal (parsed null + refusal text)', async () => {
    const { callBatch } = scripted(() => ({ parsed: null, refusal: 'no' }));
    const out = await resilientChunk(['x'], callBatch);
    expect(out.collected).toEqual([]);
    expect(out.needsReview).toEqual(['x']);
  });

  it('treats malformed output (missing/non-array results) as needsReview, no crash', async () => {
    const missing = scripted(() => ({ parsed: {} as { results: R[] }, refusal: null }));
    const out1 = await resilientChunk(['a', 'b'], missing.callBatch);
    expect(out1.needsReview).toEqual(['a', 'b']);

    const nullResults = scripted(() => ({
      parsed: { results: null } as unknown as { results: R[] },
      refusal: null,
    }));
    const out2 = await resilientChunk(['a'], nullResults.callBatch);
    expect(out2.needsReview).toEqual(['a']);
  });

  it('passes a valid empty results array through as collected (not needsReview)', async () => {
    const { callBatch } = scripted(() => ({ parsed: { results: [] }, refusal: null }));
    const out = await resilientChunk(['a'], callBatch);
    expect(out.collected).toEqual([]);
    expect(out.needsReview).toEqual([]); // valid array → not malformed
  });

  it('re-throws an unexpected (non finish-reason, non content_filter) error', async () => {
    const { callBatch } = scripted(() => {
      throw new Error('network exploded');
    });
    await expect(resilientChunk(['x'], callBatch)).rejects.toThrow('network exploded');
  });

  it('re-throws a non-content_filter BadRequestError', async () => {
    const { callBatch } = scripted(() => {
      throw new BadRequestError(
        400,
        { code: 'unsupported_value', param: 'temperature' },
        'bad request',
        new Headers(),
      );
    });
    await expect(resilientChunk(['x'], callBatch)).rejects.toBeInstanceOf(BadRequestError);
  });
});
