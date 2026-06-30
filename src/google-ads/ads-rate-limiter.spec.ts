import RedisMockUntyped from 'ioredis-mock';
import type { ConfigType } from '@nestjs/config';
import type { googleAdsConfig } from '../config/google-ads.config';
import { AdsRateLimiter } from './ads-rate-limiter';
import type { AdsLimiterRedis } from './ads-rate-limiter';

const RedisMock = RedisMockUntyped as unknown as new () => AdsLimiterRedis & {
  flushall(): Promise<unknown>;
};

type AdsCfg = ConfigType<typeof googleAdsConfig>;
/** 只填限流器用到的欄位（qps/adsMaxRetries/adsBackoffBaseMs）。 */
function cfg(over: Partial<AdsCfg> = {}): AdsCfg {
  return { qps: 1, adsMaxRetries: 5, adsBackoffBaseMs: 5000, ...over } as AdsCfg;
}

/** GoogleAdsFailure 形狀工廠（以 Error 承載 errors，貼近 SDK 拋出物且為合法 reject 理由）。 */
function adsFailure(category: string, code: string): Error {
  return Object.assign(new Error(code), {
    errors: [{ error_code: { [category]: code } }],
  });
}

/** 建限流器並裝上可控時鐘：sleep 推進虛擬時鐘、random 預設 0（jitter=0，退避值確定）。 */
function makeLimiter(over: Partial<AdsCfg> = {}) {
  const redis = new RedisMock();
  const limiter = new AdsRateLimiter(redis, cfg(over));
  const state = { clock: 1_000_000, sleeps: [] as number[] };
  limiter.now = () => state.clock;
  limiter.sleep = (ms: number) => {
    state.sleeps.push(ms);
    state.clock += ms;
    return Promise.resolve();
  };
  limiter.random = () => 0;
  return { limiter, state, redis };
}

describe('AdsRateLimiter (T3.6 / TC-16)', () => {
  // ioredis-mock 預設跨實例共用同一記憶體 store → 每測前清空，隔離 per-CID 預約時槽。
  beforeEach(async () => {
    await new RedisMock().flushall();
  });

  describe('per-CID ~1 QPS spacing（集中式、Redis-backed）', () => {
    it('serializes consecutive calls on the same CID ≥ 1000ms apart (qps=1)', async () => {
      const { limiter, state } = makeLimiter();
      const runAt: number[] = [];
      const fn = () => {
        runAt.push(state.clock);
        return Promise.resolve('ok');
      };
      await limiter.schedule('cid-1', fn);
      await limiter.schedule('cid-1', fn);
      await limiter.schedule('cid-1', fn);
      expect(runAt[1] - runAt[0]).toBeGreaterThanOrEqual(1000);
      expect(runAt[2] - runAt[1]).toBeGreaterThanOrEqual(1000);
    });

    it('serializes CONCURRENT calls on the same CID (≥1000ms reservations, cross-worker)', async () => {
      const { limiter, state } = makeLimiter();
      // sleep 不推進時鐘 → 所有 reservation 在同一 now 競價，暴露 Lua 原子序列化的等待值。
      limiter.sleep = (ms: number) => {
        state.sleeps.push(ms);
        return Promise.resolve();
      };
      const fn = () => Promise.resolve();
      await Promise.all([
        limiter.schedule('cid-1', fn),
        limiter.schedule('cid-1', fn),
        limiter.schedule('cid-1', fn),
      ]);
      // 三個並發呼叫被序列化：第 2、3 個各等 1000、2000ms（wait=0 不 sleep）。
      expect(state.sleeps.slice().sort((a, b) => a - b)).toEqual([1000, 2000]);
    });

    it('runs different CIDs in parallel (separate buckets, no wait)', async () => {
      const { limiter, state } = makeLimiter();
      limiter.sleep = (ms: number) => {
        state.sleeps.push(ms);
        return Promise.resolve();
      };
      const fn = () => Promise.resolve();
      await Promise.all([limiter.schedule('cid-A', fn), limiter.schedule('cid-B', fn)]);
      expect(state.sleeps).toEqual([]);
    });

    it('honours qps to derive minTime = ceil(1000/qps)', async () => {
      const { limiter, state } = makeLimiter({ qps: 2 });
      limiter.sleep = (ms: number) => {
        state.sleeps.push(ms);
        return Promise.resolve();
      };
      const fn = () => Promise.resolve();
      await limiter.schedule('cid-1', fn);
      await limiter.schedule('cid-1', fn);
      expect(state.sleeps).toEqual([500]); // qps=2 → 500ms spacing
    });
  });

  describe('exponential backoff on transient Ads errors', () => {
    it('retries RESOURCE_EXHAUSTED with 5s→10s→20s backoff then succeeds', async () => {
      // qps 高 → throttle 等待 ≤1ms，與退避值（≥5000）清楚區分。
      const { limiter, state } = makeLimiter({ qps: 1000 });
      let calls = 0;
      const fn = () => {
        calls += 1;
        if (calls <= 2) return Promise.reject(adsFailure('quota_error', 'RESOURCE_EXHAUSTED'));
        return Promise.resolve('done');
      };
      const out = await limiter.schedule('cid-1', fn);
      expect(out).toBe('done');
      expect(calls).toBe(3);
      // random=0 → jitter=0；退避序列確定為 5000、10000。
      expect(state.sleeps.filter((ms) => ms >= 1000)).toEqual([5000, 10000]);
    });

    it('also retries RESOURCE_TEMPORARILY_EXHAUSTED', async () => {
      const { limiter } = makeLimiter({ qps: 1000 });
      let calls = 0;
      const fn = () => {
        calls += 1;
        if (calls === 1)
          return Promise.reject(adsFailure('quota_error', 'RESOURCE_TEMPORARILY_EXHAUSTED'));
        return Promise.resolve('ok');
      };
      await expect(limiter.schedule('cid-1', fn)).resolves.toBe('ok');
      expect(calls).toBe(2);
    });

    it('adds positive jitter on top of the base backoff (random>0)', async () => {
      const { limiter, state } = makeLimiter({ qps: 1000 });
      limiter.random = () => 1; // 最大 jitter
      let calls = 0;
      const fn = () => {
        calls += 1;
        if (calls === 1) return Promise.reject(adsFailure('quota_error', 'RESOURCE_EXHAUSTED'));
        return Promise.resolve('ok');
      };
      await limiter.schedule('cid-1', fn);
      const backoff = state.sleeps.filter((ms) => ms >= 1000)[0];
      expect(backoff).toBeGreaterThan(5000); // base 5000 + jitter
      expect(backoff).toBeLessThanOrEqual(6000); // ≤ base * 1.2 上限
    });

    it('stops after adsMaxRetries and rethrows the last transient error', async () => {
      const { limiter, state } = makeLimiter({ qps: 1000, adsMaxRetries: 2 });
      let calls = 0;
      const err = adsFailure('quota_error', 'RESOURCE_EXHAUSTED');
      const fn = () => {
        calls += 1;
        return Promise.reject(err);
      };
      await expect(limiter.schedule('cid-1', fn)).rejects.toBe(err);
      expect(calls).toBe(3); // attempt 0,1,2 → max 2 retries
      expect(state.sleeps.filter((ms) => ms >= 1000)).toEqual([5000, 10000]); // 2 backoffs only
    });
  });

  describe('non-retryable errors throw immediately', () => {
    it('InvalidArgument (request_error) is NOT retried', async () => {
      const { limiter, state } = makeLimiter({ qps: 1000 });
      let calls = 0;
      const err = adsFailure('request_error', 'RESOURCE_NAME_MALFORMED');
      const fn = () => {
        calls += 1;
        return Promise.reject(err);
      };
      await expect(limiter.schedule('cid-1', fn)).rejects.toBe(err);
      expect(calls).toBe(1);
      expect(state.sleeps.filter((ms) => ms >= 1000)).toEqual([]); // no backoff
    });
  });

  describe('lifecycle', () => {
    it('disconnects its Redis on module destroy (no Jest hang)', () => {
      const { limiter, redis } = makeLimiter();
      const spy = jest.spyOn(redis, 'disconnect');
      limiter.onModuleDestroy();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('default timing seams (production)', () => {
    it('now() reads the wall clock and sleep() waits via setTimeout', async () => {
      const limiter = new AdsRateLimiter(new RedisMock(), cfg()); // 不覆寫縫
      const before = Date.now();
      expect(limiter.now()).toBeGreaterThanOrEqual(before);
      await limiter.sleep(1); // 真實 setTimeout（~1ms）
      expect(Date.now()).toBeGreaterThanOrEqual(before);
    });
  });
});
