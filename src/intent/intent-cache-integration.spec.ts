import type { IntentCache } from './intent-cache';
import type { IntentLabeler, ParseChatParams, ParseChatResult } from './intent-labeler.port';
import { IntentService } from './intent.service';

/** 從 user message（JSON 陣列）取回關鍵字。 */
function extractKeywords(params: ParseChatParams): string[] {
  const userMsg = params.messages.find((m) => m.role === 'user');
  const match = userMsg?.content.match(/\[[\s\S]*\]/);
  return match ? (JSON.parse(match[0]) as string[]) : [];
}

/** 記錄送進 LLM 的關鍵字；一律回 transactional。 */
function recordingLabeler(sent: string[][]): IntentLabeler {
  return {
    parseChat<T>(params: ParseChatParams): Promise<ParseChatResult<T>> {
      const keywords = extractKeywords(params);
      sent.push(keywords);
      return Promise.resolve({
        parsed: { results: keywords.map((k) => ({ keyword: k, labels: ['transactional'] })) } as T,
        refusal: null,
      });
    },
  };
}

/** intent 快取替身：store 預填 = 命中；記錄 mset 回寫。 */
function fakeCache(store: Map<string, string[]>, mset: jest.Mock): IntentCache {
  return {
    mget: (nts: string[]) => Promise.resolve(nts.map((nt) => store.get(nt))),
    mset,
  } as unknown as IntentCache;
}

describe('IntentService intent cache-first (T4.2 / TC-13)', () => {
  it('skips the LLM for cache hits, sends only misses, and writes misses back', async () => {
    const sent: string[][] = [];
    const mset = jest.fn().mockResolvedValue(undefined);
    const cache = fakeCache(new Map([['a', ['informational']]]), mset); // 'a' 命中
    const service = new IntentService(recordingLabeler(sent), { batchSize: 30 }, cache);

    const out = await service.labelKeywords(['a', 'b']);

    // 命中 'a' 不送 LLM；只送 miss 'b'。
    expect(sent.flat()).toEqual(['b']);
    // 結果合併命中（cached）+ 新貼標（LLM）。
    expect(out).toEqual([
      { keyword: 'a', labels: ['informational'] },
      { keyword: 'b', labels: ['transactional'] },
    ]);
    // 回寫新貼標的 miss（之後命中省 LLM）。
    expect(mset).toHaveBeenCalledWith([{ keyword: 'b', labels: ['transactional'] }]);
  });

  it('does not call the LLM at all when every keyword hits the cache', async () => {
    const sent: string[][] = [];
    const mset = jest.fn().mockResolvedValue(undefined);
    const cache = fakeCache(
      new Map([
        ['a', ['informational']],
        ['b', ['commercial']],
      ]),
      mset,
    );
    const service = new IntentService(recordingLabeler(sent), { batchSize: 30 }, cache);

    const out = await service.labelKeywords(['a', 'b']);

    expect(sent).toEqual([]); // 全命中 → 完全不打 LLM
    expect(out).toEqual([
      { keyword: 'a', labels: ['informational'] },
      { keyword: 'b', labels: ['commercial'] },
    ]);
    expect(mset).not.toHaveBeenCalled(); // 無 miss → 無回寫
  });

  it('does not write back content_filter / refusal fallbacks (only confident labels are cached)', async () => {
    const mset = jest.fn().mockResolvedValue(undefined);
    // refusal → labelChunkResilient 回 collected:[] → labelChunkAndCache 守門不回寫。
    const labeler: IntentLabeler = {
      parseChat: () => Promise.resolve({ parsed: null, refusal: 'refused' }),
    };
    const cache = fakeCache(new Map(), mset);
    const service = new IntentService(labeler, { batchSize: 30 }, cache);

    const out = await service.labelKeywords(['a']);

    expect(mset).not.toHaveBeenCalled(); // 不確定結果不入快取
    expect(out).toEqual([{ keyword: 'a', labels: ['informational'] }]); // postProcess fallback
  });
});
