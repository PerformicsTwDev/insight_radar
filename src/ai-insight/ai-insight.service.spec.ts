import { NotFoundException } from '@nestjs/common';
import type { CacheService } from '../cache/cache.service';
import { canonicalStringify } from '../common/canonical-json';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { sha256Hex } from '../common/sha256';
import type {
  IntentLabeler,
  ParseChatParams,
  ParseChatResult,
} from '../intent/intent-labeler.port';
import type { SnapshotQueryService } from '../keywords/snapshot-query.service';
import type { ViewResult } from '../keywords/views';
import { AiInsightGenerationError } from './ai-insight-generation.error';
import { AiInsightService, type AiInsightConfig } from './ai-insight.service';
import type { AiInsightPayload } from './ai-insight.schema';

const ACTOR: AuthenticatedUser = { kind: 'apiKey' };
const CONFIG: AiInsightConfig = {
  schemaVersion: 'v1',
  deployment: 'gpt-4o-mini',
  cacheTtlMs: 5184000000,
  maxRows: 200,
  queryMaxPageSize: 200,
};
const AGGREGATE = {
  view: 'keywords',
  columns: [{ key: 'text', label: 'kw', type: 'text' }],
  rows: [{ text: 'brand shoes' }],
  pagination: { total: 1, page: 1, pageSize: 200, cursor: null },
} as unknown as ViewResult;

function ok(insight = 'Brand terms dominate this view.'): ParseChatResult<AiInsightPayload> {
  return { parsed: { insight }, refusal: null };
}

function build(configOverride: Partial<AiInsightConfig> = {}): {
  service: AiInsightService;
  parseChat: jest.Mock<Promise<ParseChatResult<AiInsightPayload>>, [ParseChatParams]>;
  resolveReadySnapshotId: jest.Mock;
  query: jest.Mock;
  resolveViewDataVersion: jest.Mock<Promise<string>, [string, string]>;
  get: jest.Mock<Promise<unknown>, [string]>;
  set: jest.Mock;
} {
  const parseChat = jest.fn<Promise<ParseChatResult<AiInsightPayload>>, [ParseChatParams]>();
  const labeler = { parseChat } as unknown as IntentLabeler;

  const resolveReadySnapshotId = jest.fn().mockResolvedValue('snap-1');
  const query = jest.fn().mockResolvedValue(AGGREGATE);
  const resolveViewDataVersion = jest.fn<Promise<string>, [string, string]>().mockResolvedValue('');
  const snapshotQuery = {
    resolveReadySnapshotId,
    query,
    resolveViewDataVersion,
  } as unknown as SnapshotQueryService;

  const store = new Map<string, unknown>();
  const get = jest.fn((key: string) =>
    Promise.resolve(store.has(key) ? store.get(key) : undefined),
  );
  const set = jest.fn((key: string, value: unknown) => {
    store.set(key, value);
    return Promise.resolve();
  });
  const cache = {
    get,
    set,
    buildKey: (ns: string, ...parts: (string | number)[]) => [ns, ...parts].join(':'),
  } as unknown as CacheService;

  const service = new AiInsightService(labeler, snapshotQuery, cache, {
    ...CONFIG,
    ...configOverride,
  });
  return { service, parseChat, resolveReadySnapshotId, query, resolveViewDataVersion, get, set };
}

function userContent(params: ParseChatParams): string {
  return params.messages.find((m) => m.role === 'user')?.content ?? '';
}

describe('AiInsightService (T12.3 / FR-32 / TC-68 部分)', () => {
  it('AC-32.1: input = the view /query aggregate; one synchronous LLM completion; returns {view,insight,generatedAt}', async () => {
    const { service, parseChat, resolveReadySnapshotId, query } = build();
    parseChat.mockResolvedValue(ok('Big volume on brand terms.'));

    // #476: even if a caller supplies `select`, it MUST NOT reach /query — the aggregate is
    // filters-determined only (matching the filters-only cache key AC-32.2). So /query is called
    // with just { view, filters }, never the column subset.
    const request = { view: 'keywords', filters: { volumeMin: 10 }, select: ['text'] };
    const out = await service.generate('an-1', request, ACTOR);

    // owner-scoped snapshot resolution (single point) + the /query aggregate is the LLM input.
    expect(resolveReadySnapshotId).toHaveBeenCalledWith('an-1', ACTOR);
    // M12-R2: a fixed pageSize=maxRows is passed so the aggregate is the top-N by volume, not the default
    // 50-row page. The select is still NOT forwarded (#476: aggregate stays filters-determined).
    expect(query).toHaveBeenCalledWith(
      'an-1',
      { view: 'keywords', filters: { volumeMin: 10 }, pagination: { pageSize: 200 } },
      ACTOR,
    );
    expect(parseChat).toHaveBeenCalledTimes(1);

    const params = parseChat.mock.calls[0][0];
    expect(params.jsonSchema.name).toBe('ai_insight');
    expect(params.temperature).toBe(0);
    expect(userContent(params)).toContain(JSON.stringify(AGGREGATE)); // aggregate, not raw table

    expect(out.view).toBe('keywords');
    expect(out.insight).toBe('Big volume on brand terms.');
    expect(Number.isNaN(Date.parse(out.generatedAt))).toBe(false);
  });

  it('M12-R2: a truncated table view passes the top-N/M coverage disclosure to the LLM', async () => {
    const { service, parseChat, query } = build();
    query.mockResolvedValue({
      view: 'keywords',
      columns: [],
      rows: [{ text: 'a' }, { text: 'b' }], // shown subset
      pagination: { total: 1200, page: 1, pageSize: 200, cursor: null },
    });
    parseChat.mockResolvedValue(ok());

    await service.generate('an-1', { view: 'keywords' }, ACTOR);

    const user = parseChat.mock.calls[0][0].messages.find((m) => m.role === 'user');
    expect(user?.content).toContain('Coverage:'); // honest bound disclosed, not presented as whole-view
    expect(user?.content).toContain('1200'); // total M
  });

  it('#516: clamps pageSize to QUERY_MAX_PAGE_SIZE when AI_INSIGHT_MAX_ROWS is larger (avoids a 400)', async () => {
    // /query rejects pageSize > maxPageSize with a 400; passing an over-large maxRows would break every
    // table-grain /ai-insight. Clamp to min(maxRows, queryMaxPageSize).
    const { service, query, parseChat } = build({ maxRows: 500, queryMaxPageSize: 100 });
    parseChat.mockResolvedValue(ok());
    await service.generate('an-1', { view: 'keywords', filters: { volumeMin: 1 } }, ACTOR);
    expect(query).toHaveBeenCalledWith(
      'an-1',
      { view: 'keywords', filters: { volumeMin: 1 }, pagination: { pageSize: 100 } },
      ACTOR,
    );
  });

  it('#516: uses AI_INSIGHT_MAX_ROWS when it is <= QUERY_MAX_PAGE_SIZE (no clamp)', async () => {
    const { service, query, parseChat } = build({ maxRows: 50, queryMaxPageSize: 200 });
    parseChat.mockResolvedValue(ok());
    await service.generate('an-1', { view: 'keywords', filters: { volumeMin: 1 } }, ACTOR);
    expect(query).toHaveBeenCalledWith(
      'an-1',
      { view: 'keywords', filters: { volumeMin: 1 }, pagination: { pageSize: 50 } },
      ACTOR,
    );
  });

  it('AC-32.2: builds the exact cache key ai_insight:v{ver}:{dep}:{snapshotId}:{view}:sha256(canonical(filters))', async () => {
    const { service, parseChat, get, set } = build();
    parseChat.mockResolvedValue(ok());

    await service.generate('an-1', { view: 'keywords', filters: { volumeMin: 10 } }, ACTOR);

    const expectedHash = sha256Hex(canonicalStringify({ volumeMin: 10 }));
    const expectedKey = `ai_insight:v1:gpt-4o-mini:snap-1:keywords:${expectedHash}`;
    expect(get).toHaveBeenCalledWith(expectedKey);
    expect(set).toHaveBeenCalledWith(
      expectedKey,
      expect.objectContaining({ view: 'keywords' }),
      5184000000,
    );
  });

  it('AC-32.2: a cache hit returns the cached insight WITHOUT calling the LLM or re-running the aggregate', async () => {
    const { service, parseChat, query } = build();
    parseChat.mockResolvedValue(ok('cached-me'));
    const request = { view: 'keywords', filters: { volumeMin: 10 } };

    const first = await service.generate('an-1', request, ACTOR);
    expect(parseChat).toHaveBeenCalledTimes(1);

    query.mockClear();
    const second = await service.generate('an-1', request, ACTOR);

    expect(second).toEqual(first); // same cached object (incl. original generatedAt)
    expect(parseChat).toHaveBeenCalledTimes(1); // no second LLM call
    expect(query).not.toHaveBeenCalled(); // hit → no aggregate recompute
  });

  it('AC-32.2/S9: semantically-equivalent filters (different key order) produce the SAME key → second is a cache hit', async () => {
    const { service, parseChat, get } = build();
    parseChat.mockResolvedValue(ok());

    await service.generate('an-1', { view: 'keywords', filters: { volumeMin: 1, q: 'x' } }, ACTOR);
    await service.generate('an-1', { view: 'keywords', filters: { q: 'x', volumeMin: 1 } }, ACTOR);

    expect(get.mock.calls[0][0]).toBe(get.mock.calls[1][0]); // identical key
    expect(parseChat).toHaveBeenCalledTimes(1); // second reused the cache, no extra LLM call
  });

  it('hashes canonical({}) when filters are omitted', async () => {
    const { service, parseChat, get } = build();
    parseChat.mockResolvedValue(ok());

    await service.generate('an-1', { view: 'keywords' }, ACTOR);

    expect(get.mock.calls[0][0]).toContain(sha256Hex(canonicalStringify({})));
  });

  it('M12-R3: a static view (dataVersion="") keeps the key shape (no trailing version segment)', async () => {
    const { service, parseChat, get, resolveViewDataVersion } = build();
    parseChat.mockResolvedValue(ok());

    await service.generate('an-1', { view: 'keywords', filters: { volumeMin: 10 } }, ACTOR);

    expect(resolveViewDataVersion).toHaveBeenCalledWith('an-1', 'keywords');
    const hash = sha256Hex(canonicalStringify({ volumeMin: 10 }));
    expect(get.mock.calls[0][0]).toBe(`ai_insight:v1:gpt-4o-mini:snap-1:keywords:${hash}`);
  });

  it('M12-R3: a dynamic view folds the data version (latest completed run id) into the key', async () => {
    const { service, parseChat, get, set, resolveViewDataVersion } = build();
    resolveViewDataVersion.mockResolvedValue('run-abc');
    parseChat.mockResolvedValue(ok());

    await service.generate('an-1', { view: 'custom:cid-1', filters: { volumeMin: 10 } }, ACTOR);

    expect(resolveViewDataVersion).toHaveBeenCalledWith('an-1', 'custom:cid-1');
    const hash = sha256Hex(canonicalStringify({ volumeMin: 10 }));
    const expectedKey = `ai_insight:v1:gpt-4o-mini:snap-1:custom:cid-1:${hash}:run-abc`;
    expect(get).toHaveBeenCalledWith(expectedKey);
    expect(set).toHaveBeenCalledWith(
      expectedKey,
      expect.objectContaining({ view: 'custom:cid-1' }),
      5184000000,
    );
  });

  it('M12-R3: a re-run (new data version) misses the cache → fresh insight, not the stale one', async () => {
    const { service, parseChat, resolveViewDataVersion } = build();
    const request = { view: 'custom:cid-1', filters: { volumeMin: 10 } };

    resolveViewDataVersion.mockResolvedValue('run-old');
    parseChat.mockResolvedValue(ok('OLD taxonomy insight'));
    const first = await service.generate('an-1', request, ACTOR);
    expect(first.insight).toBe('OLD taxonomy insight');

    // labels edited → new completed run → new data version → different key → cache MISS.
    resolveViewDataVersion.mockResolvedValue('run-new');
    parseChat.mockResolvedValue(ok('NEW taxonomy insight'));
    const second = await service.generate('an-1', request, ACTOR);

    expect(second.insight).toBe('NEW taxonomy insight'); // not the stale cached one
    expect(parseChat).toHaveBeenCalledTimes(2); // re-summarized on the new version
  });

  it('AC-32.4: an LLM refusal throws AiInsightGenerationError and does NOT cache a half-finished summary', async () => {
    const { service, parseChat, set } = build();
    parseChat.mockResolvedValue({ parsed: null, refusal: 'blocked' });

    await expect(service.generate('an-1', { view: 'keywords' }, ACTOR)).rejects.toBeInstanceOf(
      AiInsightGenerationError,
    );
    expect(set).not.toHaveBeenCalled();
  });

  it('AC-32.4: a malformed (missing/empty insight) response throws, does not cache', async () => {
    const { service, parseChat, set } = build();
    parseChat.mockResolvedValueOnce({ parsed: {} as AiInsightPayload, refusal: null });
    await expect(service.generate('an-1', { view: 'keywords' }, ACTOR)).rejects.toBeInstanceOf(
      AiInsightGenerationError,
    );

    parseChat.mockResolvedValueOnce({ parsed: { insight: '   ' }, refusal: null });
    await expect(
      service.generate('an-1', { view: 'keywords', filters: { q: 'z' } }, ACTOR),
    ).rejects.toBeInstanceOf(AiInsightGenerationError);

    expect(set).not.toHaveBeenCalled();
  });

  it('AC-32.4: a thrown LLM/transport error is mapped to AiInsightGenerationError (cause preserved), not cached', async () => {
    const { service, parseChat, set } = build();
    const boom = new Error('network exploded');
    parseChat.mockRejectedValue(boom);

    const err = await service
      .generate('an-1', { view: 'keywords' }, ACTOR)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiInsightGenerationError);
    expect((err as AiInsightGenerationError).cause).toBe(boom);
    expect(set).not.toHaveBeenCalled();
  });

  it('a failed generation does not poison the cache: a retry with the same key still hits the LLM and succeeds', async () => {
    const { service, parseChat } = build();
    const request = { view: 'keywords', filters: { volumeMin: 10 } };

    parseChat.mockResolvedValueOnce({ parsed: null, refusal: 'blocked' });
    await expect(service.generate('an-1', request, ACTOR)).rejects.toBeInstanceOf(
      AiInsightGenerationError,
    );

    parseChat.mockResolvedValue(ok('recovered'));
    const out = await service.generate('an-1', request, ACTOR);

    expect(out.insight).toBe('recovered');
    expect(parseChat).toHaveBeenCalledTimes(2); // no negative cache; retried
  });

  it('AC-32.3 (endpoint concern) owner-scope/readiness is enforced at the reused single point: errors propagate, no LLM/cache', async () => {
    const { service, parseChat, resolveReadySnapshotId, get } = build();
    resolveReadySnapshotId.mockRejectedValue(new NotFoundException());

    await expect(service.generate('missing', { view: 'keywords' }, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(get).not.toHaveBeenCalled();
    expect(parseChat).not.toHaveBeenCalled();
  });
});
