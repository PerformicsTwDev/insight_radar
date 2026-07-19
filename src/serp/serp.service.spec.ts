import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { serpConfig } from '../config/serp.config';
import type { SerpApiProvider } from './serp-api.provider';
import type { SerpRepository } from './serp.repository';
import { SerpService } from './serp.service';
import type { SerpFetchResult, SerpQuery } from './serp.types';

const CONFIG: ConfigType<typeof serpConfig> = {
  enabled: true,
  provider: 'serpapi',
  apiKey: 'k',
  apiUrl: 'https://serpapi.com/search',
  topN: 5,
  freshnessDays: 30,
  retentionDays: undefined,
  maxRetries: 3,
  backoffBaseMs: 500,
};

function query(normalizedText: string): SerpQuery {
  return { normalizedText, keyword: normalizedText, geo: 'US', language: 'en' };
}

function fetchResult(normalizedText: string): SerpFetchResult {
  return {
    ...query(normalizedText),
    provider: 'serpapi',
    results: {
      organic: [{ position: 1, title: 't', url: 'https://a.com', snippet: 's', domain: 'a.com' }],
    },
    fetchedAt: new Date('2026-07-02T00:00:00Z'),
  };
}

interface Harness {
  service: SerpService;
  fetcher: { fetch: jest.Mock };
  repository: { findLatestWithin: jest.Mock; append: jest.Mock };
}

function buildHarness(
  config: ConfigType<typeof serpConfig>,
  reused: (SerpFetchResult | null)[],
): Harness {
  const fetcher = {
    fetch: jest.fn((qs: SerpQuery[]) =>
      Promise.resolve(qs.map((q) => fetchResult(q.normalizedText))),
    ),
  };
  let call = 0;
  const repository = {
    findLatestWithin: jest.fn(() => Promise.resolve(reused[call++] ?? null)),
    append: jest.fn().mockResolvedValue(undefined),
  };
  const service = new SerpService(
    fetcher as unknown as SerpApiProvider,
    repository as unknown as SerpRepository,
    config,
  );
  return { service, fetcher, repository };
}

describe('SerpService freshness orchestration (T8.3 / TC-47)', () => {
  it('degrades to [] when SERP_ENABLED=false (no provider/repo calls)', async () => {
    const { service, fetcher, repository } = buildHarness({ ...CONFIG, enabled: false }, []);
    const out = await service.fetch([query('coffee')]);
    expect(out).toEqual([]);
    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(repository.findLatestWithin).not.toHaveBeenCalled();
  });

  it('reuses a within-freshness row without calling the provider', async () => {
    const cached = fetchResult('coffee');
    const { service, fetcher, repository } = buildHarness(CONFIG, [cached]);

    const out = await service.fetch([query('coffee')]);

    expect(repository.findLatestWithin).toHaveBeenCalledWith(query('coffee'), 30);
    expect(fetcher.fetch).not.toHaveBeenCalled(); // 窗內重用
    expect(repository.append).not.toHaveBeenCalled();
    expect(out).toEqual([cached]);
  });

  it('fetches + appends (append-only) on a freshness miss', async () => {
    const { service, fetcher, repository } = buildHarness(CONFIG, [null]);

    const out = await service.fetch([query('coffee')]);

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(fetcher.fetch).toHaveBeenCalledWith([query('coffee')]); // 只送 miss 的 query
    expect(repository.append).toHaveBeenCalledTimes(1);
    expect(out[0].normalizedText).toBe('coffee');
  });

  it('mixes reuse and fetch across queries, aligned to input order', async () => {
    const cached = fetchResult('coffee');
    const { service, fetcher, repository } = buildHarness(CONFIG, [cached, null]); // coffee hit, latte miss

    const out = await service.fetch([query('coffee'), query('latte')]);

    expect(fetcher.fetch).toHaveBeenCalledTimes(1); // 只 latte 打供應商
    expect(repository.append).toHaveBeenCalledTimes(1); // 只 latte append
    expect(out.map((r) => r.normalizedText)).toEqual(['coffee', 'latte']);
  });

  it('returns [] for no queries', async () => {
    const { service, fetcher } = buildHarness(CONFIG, []);
    expect(await service.fetch([])).toEqual([]);
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });
});

describe('SerpService per-query resilience (M8-R10 / NFR-12 partial)', () => {
  /** 逐 query 送 fetcher；`failFor` 命中的 query 令供應商拋 `error`（模擬達重試上限後拋出）。 */
  function resilientHarness(
    reused: (SerpFetchResult | null)[],
    failFor: (q: SerpQuery) => Error | null,
  ): Harness {
    const fetcher = {
      fetch: jest.fn((qs: SerpQuery[]) => {
        const q = qs[0];
        const err = failFor(q);
        if (err) return Promise.reject(err);
        return Promise.resolve(qs.map((x) => fetchResult(x.normalizedText)));
      }),
    };
    let call = 0;
    const repository = {
      findLatestWithin: jest.fn(() => Promise.resolve(reused[call++] ?? null)),
      append: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SerpService(
      fetcher as unknown as SerpApiProvider,
      repository as unknown as SerpRepository,
      CONFIG,
    );
    return { service, fetcher, repository };
  }

  const transient = (status: number) => Object.assign(new Error(`SERP HTTP ${status}`), { status });

  it('drops only the failing query on a transient error; other queries keep SERP + run does not throw', async () => {
    const { service, fetcher, repository } = resilientHarness([null, null, null], (q) =>
      q.normalizedText === 'latte' ? transient(503) : null,
    );

    const out = await service.fetch([query('coffee'), query('latte'), query('mocha')]);

    // 失敗的 latte 從結果中剔除，其餘保留（不整批 throw）
    expect(out.map((r) => r.normalizedText)).toEqual(['coffee', 'mocha']);
    expect(fetcher.fetch).toHaveBeenCalledTimes(3); // 三個都嘗試
    expect(repository.append).toHaveBeenCalledTimes(2); // 只成功的兩個 append
  });

  it('logs a structured warning for the dropped query (not a silent swallow)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { service } = resilientHarness([null, null], (q) =>
        q.normalizedText === 'latte' ? transient(429) : null,
      );

      await service.fetch([query('coffee'), query('latte')]);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('latte'); // 可觀測：哪個 query 被降級
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('preserves reused (cached) results when a later query fails transiently', async () => {
    const cached = fetchResult('coffee');
    const { service, repository } = resilientHarness([cached, null], (q) =>
      q.normalizedText === 'latte' ? transient(500) : null,
    );

    const out = await service.fetch([query('coffee'), query('latte')]);

    expect(out).toEqual([cached]); // 已重用的 coffee 不因 latte 失敗被丟棄
    expect(repository.append).not.toHaveBeenCalled();
  });

  it('rethrows a non-transient (contract/config) error to surface it — does not mask as per-query drop', async () => {
    const { service } = resilientHarness([null, null], (q) =>
      q.normalizedText === 'latte'
        ? Object.assign(new Error('SERP HTTP 400'), { status: 400 })
        : null,
    );

    // 契約/設定錯（4xx 不可重試、系統性）應浮現，比照 ClusteringContractError 精神（#530）
    await expect(service.fetch([query('coffee'), query('latte')])).rejects.toThrow(/400/);
  });
});
