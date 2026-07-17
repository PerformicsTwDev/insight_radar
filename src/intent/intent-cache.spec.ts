import { createHash } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import type { CacheService } from '../cache/cache.service';
import type { cacheConfig } from '../config/cache.config';
import type { PrismaService } from '../prisma';
import { IntentCache } from './intent-cache';

const TTL_MS = 5_184_000_000; // 60 天
const DEPLOYMENT = 'gpt-4o-mini';
const MODEL_VERSION = `v1:${DEPLOYMENT}`;

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

interface SetCall {
  key: string;
  value: unknown;
  ttlMs?: number;
}

interface DbRow {
  normalizedText: string;
  modelVersion: string;
  labels: string[];
}

function buildCache(
  intentSchemaVersion = 'v1',
  store = new Map<string, unknown>(),
  dbRows: DbRow[] = [],
) {
  const setCalls: SetCall[] = [];
  const set = jest.fn(<T>(key: string, value: T, ttlMs?: number): Promise<void> => {
    store.set(key, value);
    setCalls.push({ key, value, ttlMs });
    return Promise.resolve();
  });
  const mget = jest.fn(<T>(keys: string[]): Promise<(T | undefined)[]> =>
    Promise.resolve(keys.map((k) => (store.has(k) ? (store.get(k) as T) : undefined))),
  );
  const cache = {
    buildKey: (namespace: string, ...parts: (string | number)[]) => [namespace, ...parts].join(':'),
    mget,
    set,
  } as unknown as CacheService;
  const config: ConfigType<typeof cacheConfig> = {
    metricsTtlMs: 1,
    intentTtlMs: TTL_MS,
    intentSchemaVersion,
    aiInsightSchemaVersion: 'v1',
    aiInsightTtlMs: 1,
    aiInsightMaxRows: 200,
    journeySchemaVersion: 'v1',
    journeyTtlMs: 1,
    customClassifySchemaVersion: 'v1',
    customClassifyTtlMs: 1,
  };
  // DB canonical 替身（keyword_intents）：findMany 依 modelVersion + normalizedText∈ 過濾；記錄 upsert。
  const upsert = jest.fn().mockResolvedValue({});
  const findMany = jest.fn(
    (args: { where: { modelVersion: string; normalizedText: { in: string[] } } }) =>
      Promise.resolve(
        dbRows.filter(
          (r) =>
            r.modelVersion === args.where.modelVersion &&
            args.where.normalizedText.in.includes(r.normalizedText),
        ),
      ),
  );
  const prisma = { keywordIntent: { findMany, upsert } } as unknown as PrismaService;
  return {
    service: new IntentCache(cache, config, DEPLOYMENT, prisma),
    store,
    setCalls,
    findMany,
    upsert,
    set,
    mget,
  };
}

describe('IntentCache (T4.2 / FR-10 / NFR-4 / TC-13)', () => {
  it('writes back labels under intent:v{ver}:{deployment}:sha256(nt) with the intent TTL (ms)', async () => {
    const { service, setCalls } = buildCache();
    await service.mset([{ keyword: 'running shoes', labels: ['informational'] }]);

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].key).toBe(`intent:v1:${DEPLOYMENT}:${sha('running shoes')}`);
    expect(setCalls[0].ttlMs).toBe(TTL_MS);
    expect(setCalls[0].value).toEqual(['informational']);
  });

  it('mget returns cached labels aligned to input order, miss = undefined', async () => {
    const { service } = buildCache();
    await service.mset([{ keyword: 'running shoes', labels: ['informational'] }]);

    const got = await service.mget(['running shoes', 'unseen']);

    expect(got[0]).toEqual(['informational']);
    expect(got[1]).toBeUndefined();
  });

  it('keys by sha256(normalizedText) so the dedupe key and the cache key share normalizedText', async () => {
    const { service, store } = buildCache();
    await service.mset([{ keyword: 'running shoes', labels: ['informational'] }]);
    expect([...store.keys()]).toEqual([`intent:v1:${DEPLOYMENT}:${sha('running shoes')}`]);
  });

  it('separates by deployment (namespace isolation: another deployment is a miss)', async () => {
    const { service, store } = buildCache(); // deployment = DEPLOYMENT
    await service.mset([{ keyword: 'running shoes', labels: ['informational'] }]);
    // 同 nt、不同 deployment → 不同 key（schemaVer/deployment namespace 隔離 → bump 整批失效）。
    expect(store.has(`intent:v1:${DEPLOYMENT}:${sha('running shoes')}`)).toBe(true);
    expect(store.has(`intent:v1:other-deploy:${sha('running shoes')}`)).toBe(false);
  });

  it('keys by normalizeText(keyword) on writeback so a non-normalized LLM echo still hits later', async () => {
    const { service } = buildCache();
    // LLM 回 echo 帶大小寫差異 'Running Shoes'；查正規化字 'running shoes' 仍須命中（key 經 normalizeText）。
    await service.mset([{ keyword: 'Running Shoes', labels: ['informational'] }]);
    expect((await service.mget(['running shoes']))[0]).toEqual(['informational']);
  });

  it('does not cache empty labels (would otherwise become a permanent fallback hit)', async () => {
    const { service, setCalls } = buildCache();
    await service.mset([
      { keyword: 'x', labels: [] },
      { keyword: 'y', labels: ['informational'] },
    ]);
    // 只快取非空標籤的 'y'。
    expect(setCalls.map((c) => c.key)).toEqual([`intent:v1:${DEPLOYMENT}:${sha('y')}`]);
  });

  it('does not cache out-of-enum labels; keeps only valid ones (validates before caching, M4-R4)', async () => {
    const { service, setCalls, upsert } = buildCache();
    await service.mset([
      { keyword: 'a', labels: ['shopping'] }, // 全非法（不在 INTENT_LABELS）→ 不快取（清洗後 []）
      { keyword: 'b', labels: ['commercial', 'shopping'] }, // 混合 → 只留合法 'commercial'
    ]);

    // 'a' 全非法 → 不寫 Redis/DB；'b' 只快取已驗證的 ['commercial']。
    expect(setCalls.map((c) => c.key)).toEqual([`intent:v1:${DEPLOYMENT}:${sha('b')}`]);
    expect(setCalls[0].value).toEqual(['commercial']);
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = (upsert.mock.calls[0] as unknown[])[0] as {
      create: { normalizedText: string; labels: string[] };
    };
    expect(arg.create.normalizedText).toBe('b');
    expect(arg.create.labels).toEqual(['commercial']);
  });

  it('mget on an empty list returns [] without touching the cache', async () => {
    const { service } = buildCache();
    expect(await service.mget([])).toEqual([]);
  });

  it('upserts labels to the DB canonical keyword_intents by [normalizedText, modelVersion] (T4.6)', async () => {
    const { service, upsert } = buildCache();
    await service.mset([{ keyword: 'Running Shoes', labels: ['informational'] }]);

    const arg = (upsert.mock.calls[0] as unknown[])[0] as {
      where: { normalizedText_modelVersion: { normalizedText: string; modelVersion: string } };
      create: { normalizedText: string; modelVersion: string; labels: string[] };
    };
    expect(arg.where.normalizedText_modelVersion).toEqual({
      normalizedText: 'running shoes', // LLM echo 'Running Shoes' → normalizeText
      modelVersion: MODEL_VERSION,
    });
    expect(arg.create).toMatchObject({
      normalizedText: 'running shoes',
      modelVersion: MODEL_VERSION,
      labels: ['informational'],
    });
  });

  it('falls back to the DB canonical on a Redis miss and warms Redis (T4.6)', async () => {
    const store = new Map<string, unknown>();
    const { service, findMany } = buildCache('v1', store, [
      { normalizedText: 'running shoes', modelVersion: MODEL_VERSION, labels: ['commercial'] },
    ]);
    // Redis 空 → DB 後備命中（Redis 失效不重打 LLM）。
    expect((await service.mget(['running shoes']))[0]).toEqual(['commercial']);
    expect(findMany).toHaveBeenCalled();
    // warm Redis：回填後同字 Redis 命中。
    expect(store.has(`intent:v1:${DEPLOYMENT}:${sha('running shoes')}`)).toBe(true);
  });

  it('returns undefined when both Redis and DB miss', async () => {
    const { service } = buildCache('v1', new Map(), []);
    expect((await service.mget(['unseen']))[0]).toBeUndefined();
  });

  it('bumping intentSchemaVersion isolates the namespace: old keys miss, old results not polluted (T4.3)', async () => {
    const store = new Map<string, unknown>();
    const { service: v1 } = buildCache('v1', store);
    await v1.mset([{ keyword: 'running shoes', labels: ['informational'] }]);

    // bump v1 → v2：新版本查不到舊 key（整批失效）。
    const { service: v2 } = buildCache('v2', store);
    expect((await v2.mget(['running shoes']))[0]).toBeUndefined();
    expect(store.has(`intent:v2:${DEPLOYMENT}:${sha('running shoes')}`)).toBe(false);

    // 舊版本仍命中（舊結果隔離、不被污染）。
    expect((await v1.mget(['running shoes']))[0]).toEqual(['informational']);
  });

  it('mset does not reject when the DB upsert fails (best-effort writeback; the paid LLM job still completes, T4.6)', async () => {
    const { service, upsert } = buildCache();
    upsert.mockRejectedValueOnce(new Error('db down'));
    // 回寫純屬快取暖機：DB upsert 失敗不可拖垮已付費（LLM）的 job——降級為下次重打。
    await expect(
      service.mset([{ keyword: 'running shoes', labels: ['informational'] }]),
    ).resolves.toBeUndefined();
  });

  it('mget returns the DB hit even when warming Redis fails (best-effort; a successful read never fails, T4.6)', async () => {
    const store = new Map<string, unknown>();
    const { service, set } = buildCache('v1', store, [
      { normalizedText: 'running shoes', modelVersion: MODEL_VERSION, labels: ['commercial'] },
    ]);
    set.mockRejectedValueOnce(new Error('redis down')); // warm Redis 失敗

    expect((await service.mget(['running shoes']))[0]).toEqual(['commercial']);
  });

  // ── M4-R2：快取讀取 best-effort（cache-aside：讀取錯誤 = miss，降級落 LLM，不拖垮 job）──
  it('mget treats a Redis read error as a miss and still falls back to the DB canonical (M4-R2)', async () => {
    const store = new Map<string, unknown>();
    const { service, mget } = buildCache('v1', store, [
      { normalizedText: 'running shoes', modelVersion: MODEL_VERSION, labels: ['commercial'] },
    ]);
    mget.mockRejectedValueOnce(new Error('redis read down')); // Redis 讀取錯誤

    // Redis 讀取錯誤視為 miss → 仍落 DB 後備命中（不 throw）。
    expect((await service.mget(['running shoes']))[0]).toEqual(['commercial']);
  });

  it('mget treats a DB read error as a miss (returns undefined, does not throw, falls to LLM) (M4-R2)', async () => {
    const { service, findMany } = buildCache('v1', new Map(), []);
    findMany.mockRejectedValueOnce(new Error('db read down')); // Redis miss → DB 也錯

    expect(await service.mget(['unseen'])).toEqual([undefined]); // 皆 miss → caller 落 LLM，不 throw
  });

  // ── M4-R3：寫入時 Redis 與 DB 各自獨立 best-effort（Redis reject 不可短路丟棄 in-flight DB upsert）──
  it('awaits the DB upsert even when a Redis set rejects (durable backstop not abandoned, M4-R3)', async () => {
    const { service, set, upsert } = buildCache();
    set.mockRejectedValueOnce(new Error('redis down')); // Redis 先 reject
    let upsertSettled = false;
    upsert.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setImmediate(() => {
            upsertSettled = true;
            resolve({});
          });
        }),
    );

    await service.mset([{ keyword: 'running shoes', labels: ['informational'] }]);
    // 修正前：單一 Promise.all 因 Redis reject 短路 → mset 在 upsert 完成前就 resolve（upsertSettled=false）。
    expect(upsertSettled).toBe(true);
  });
});
