import { LengthFinishReasonError } from 'openai/core/error';
import { normalizeText } from '../google-ads/normalize';
import type {
  IntentLabeler,
  ParseChatParams,
  ParseChatResult,
} from '../intent/intent-labeler.port';
import type { JourneyCache } from './journey-cache';
import type { StagedKeyword } from './journey-postprocess';
import type { JourneyBatch, JourneyStage } from './journey.schema';
import { JourneyService, type JourneyServiceConfig } from './journey.service';

/** Pull the keyword array out of the user message (JSON-encoded). */
function keywordsOf(params: ParseChatParams): string[] {
  const userMsg = params.messages.find((m) => m.role === 'user');
  const match = userMsg?.content.match(/\[[\s\S]*\]/);
  return match ? (JSON.parse(match[0]) as string[]) : [];
}

/** LLM ok-response: assign every keyword the given stage. */
const okStage =
  (stage: JourneyStage) =>
  (keywords: string[]): ParseChatResult<JourneyBatch> => ({
    parsed: { results: keywords.map((keyword) => ({ keyword, stage })) },
    refusal: null,
  });

interface BuildOpts {
  batchSize?: number;
  llmConcurrency?: number;
  withCache?: boolean;
  behave?: (keywords: string[]) => ParseChatResult<JourneyBatch>;
  seed?: Record<string, JourneyStage>;
}

function build(opts: BuildOpts = {}): {
  service: JourneyService;
  batches: string[][];
  mget: jest.Mock<Promise<(JourneyStage | undefined)[]>, [string[]]>;
  mset: jest.Mock<Promise<void>, [StagedKeyword[]]>;
} {
  const behave = opts.behave ?? okStage('need_definition');
  const batches: string[][] = [];
  const parseChat = jest.fn((params: ParseChatParams) => {
    const keywords = keywordsOf(params);
    batches.push(keywords);
    return Promise.resolve(behave(keywords));
  });
  const labeler = { parseChat } as unknown as IntentLabeler;

  const store = new Map<string, JourneyStage>();
  for (const [k, v] of Object.entries(opts.seed ?? {})) store.set(normalizeText(k), v);
  const mget = jest.fn((nts: string[]) =>
    Promise.resolve(nts.map((nt) => store.get(normalizeText(nt)))),
  );
  const mset = jest.fn((entries: StagedKeyword[]) => {
    for (const e of entries) store.set(normalizeText(e.keyword), e.stage);
    return Promise.resolve();
  });
  const cache = { mget, mset } as unknown as JourneyCache;

  const config: JourneyServiceConfig = {
    batchSize: opts.batchSize ?? 30,
    llmConcurrency: opts.llmConcurrency,
  };
  const service = new JourneyService(labeler, config, opts.withCache === false ? undefined : cache);
  return { service, batches, mget, mset };
}

describe('JourneyService.classify (T12.5 / FR-33 / AC-33.1~33.3/33.5 / TC-69 部分)', () => {
  it('AC-33.1/33.2: one synchronous batch → exactly one stage per input, strict schema, temperature 0', async () => {
    const params: ParseChatParams[] = [];
    const parseChat = jest.fn((p: ParseChatParams) => {
      params.push(p);
      return Promise.resolve(okStage('final_decision')(keywordsOf(p)));
    });
    const service = new JourneyService(
      { parseChat } as unknown as IntentLabeler,
      { batchSize: 30 },
      undefined,
    );

    const out = await service.classify(['buy nespresso pods', 'iphone 16 vs 15']);

    expect(out).toEqual([
      { keyword: 'buy nespresso pods', stage: 'final_decision' },
      { keyword: 'iphone 16 vs 15', stage: 'final_decision' },
    ]);
    expect(parseChat).toHaveBeenCalledTimes(1);
    expect(params[0].jsonSchema.name).toBe('journey_classification');
    expect(params[0].temperature).toBe(0);
    expect(params[0].maxCompletionTokens).toBeGreaterThan(0);
  });

  it('AC-33.2: missing / invalid stage falls back to need_definition', async () => {
    const { service } = build({
      withCache: false,
      behave: (keywords) => ({
        // only the first keyword classified; second omitted; a third invalid stage
        parsed: {
          results: [
            { keyword: keywords[0], stage: 'spec_comparison' },
            { keyword: 'ghost', stage: 'final_decision' },
          ],
        },
        refusal: null,
      }),
    });
    const out = await service.classify(['a', 'b']);
    expect(out).toEqual([
      { keyword: 'a', stage: 'spec_comparison' },
      { keyword: 'b', stage: 'need_definition' }, // missing → fallback
    ]);
  });

  it('AC-33.3: a full cache hit returns cached stages WITHOUT calling the LLM or writing back', async () => {
    const { service, batches, mset } = build({
      seed: { a: 'final_decision', b: 'pain_awareness' },
    });
    const out = await service.classify(['A', ' b ']); // case/space-insensitive key

    expect(out).toEqual([
      { keyword: 'A', stage: 'final_decision' },
      { keyword: ' b ', stage: 'pain_awareness' },
    ]);
    expect(batches).toHaveLength(0); // no LLM call
    expect(mset).not.toHaveBeenCalled(); // nothing new to cache
  });

  it('AC-33.3: only cache-misses go to the LLM; result merges cached + freshly-classified', async () => {
    const { service, batches, mset } = build({
      seed: { cached: 'reputation_validation' },
      behave: okStage('solution_exploration'),
    });
    const out = await service.classify(['cached', 'fresh']);

    expect(out).toEqual([
      { keyword: 'cached', stage: 'reputation_validation' },
      { keyword: 'fresh', stage: 'solution_exploration' },
    ]);
    expect(batches).toEqual([['fresh']]); // only the miss was sent
    expect(mset).toHaveBeenCalledWith([{ keyword: 'fresh', stage: 'solution_exploration' }]);
  });

  it('AC-33.3: does NOT write back a fallback (refusal → no cached poison, retry stays possible)', async () => {
    const { service, mset } = build({
      withCache: true,
      behave: () => ({ parsed: null, refusal: 'blocked' }),
    });
    const out = await service.classify(['x']);
    expect(out).toEqual([{ keyword: 'x', stage: 'need_definition' }]); // fallback
    expect(mset).not.toHaveBeenCalled(); // refusal → nothing collected → no writeback
  });

  it('delegates batch resilience: a length error splits the batch (shared resilientChunk wiring)', async () => {
    const { service, batches } = build({
      withCache: false,
      batchSize: 4,
      behave: (keywords) => {
        if (keywords.length > 2) throw new LengthFinishReasonError();
        return okStage('spec_comparison')(keywords);
      },
    });
    const out = await service.classify(['a', 'b', 'c', 'd']);

    expect(out).toHaveLength(4);
    for (const r of out) expect(r.stage).toBe('spec_comparison');
    expect(batches[0]).toHaveLength(4);
    expect(batches.slice(1).map((b) => b.length)).toEqual([2, 2]);
  });

  it('splits misses into batches of batchSize', async () => {
    const { service, batches } = build({ withCache: false, batchSize: 2 });
    await service.classify(['a', 'b', 'c', 'd', 'e']);
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it('with no cache provided, always calls the LLM (behaviour unchanged)', async () => {
    const { service, batches } = build({ withCache: false, behave: okStage('final_decision') });
    const out = await service.classify(['a']);
    expect(out).toEqual([{ keyword: 'a', stage: 'final_decision' }]);
    expect(batches).toEqual([['a']]);
  });

  it('returns empty (no LLM call) for no keywords', async () => {
    const { service, batches, mget } = build({ withCache: false });
    const out = await service.classify([]);
    expect(out).toEqual([]);
    expect(batches).toHaveLength(0);
    expect(mget).not.toHaveBeenCalled();
  });

  it('clamps an invalid (0) batchSize to the default so batching never stalls', async () => {
    // sanitizePositiveInt(0, 30) → 30；否則 i += 0 會無限迴圈。三字一批（≤30）。
    const { service, batches } = build({ withCache: false, batchSize: 0 });
    const out = await service.classify(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    expect(batches).toEqual([['a', 'b', 'c']]); // single batch → batchSize became 30, not 0
  });

  it('honours an explicit llmConcurrency (defined-value path)', async () => {
    const { service, batches } = build({ withCache: false, batchSize: 2, llmConcurrency: 1 });
    const out = await service.classify(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    expect(batches.map((b) => b.length)).toEqual([2, 1]);
  });
});
