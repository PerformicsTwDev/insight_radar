import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { googleAdsConfig } from '../config/google-ads.config';
import { JobMetricsContext } from '../observability/job-metrics.context';
import { isRetryableAdsError } from './ads-error';
import { ADS_RATE_LIMITER_REDIS } from './ads-rate-limiter.constants';

/**
 * 限流器需要的最小 Redis 介面（避開 ioredis 版本間 `Redis` 型別不相容 / ioredis-mock 無型別）。
 * 正式為 IORedis、測試為 ioredis-mock，皆結構相容。
 */
export interface AdsLimiterRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  disconnect(): void;
}

/** Ads 集中式節流 Port（ADR-0001）：每個 Ads client 呼叫經此排程。 */
export interface AdsThrottle {
  schedule<T>(cid: string, fn: () => Promise<T>): Promise<T>;
}

/** 退避指數封頂的「翻倍次數」：base*2^min(attempt,2) → 5s→10s→20s→20s…（Design §11 圖示上限 20s）。 */
const MAX_BACKOFF_DOUBLINGS = 2;
/** 時槽 key TTL 的安全緩衝（ms）：覆蓋 worker 間時鐘偏移，key 必活過其保護的時槽 + minTime。 */
const SLOT_TTL_BUFFER_MS = 1000;

/**
 * 原子的「下一個可用時槽」預約（跨 worker 序列化 per-CID）。
 * slot = max(now, last + minTime)；寫回 last=slot，回傳需等待的毫秒（slot - now）。
 * 以 Lua 保證多 worker 並發下的原子性（OSS Redis 即可，不需 BullMQ Pro groups）。
 *
 * TTL **必大於它所存的未來時槽**：`(slot-now) + minTime + buffer`。否則 burst 尾段暫停 > TTL 時
 * key 提早過期，後到呼叫讀 last=0 立即取槽、與仍未消化的預約間隔 < minTime（反 1 QPS 突發）。
 */
const RESERVE_SLOT = `
local last = tonumber(redis.call('get', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
local minTime = tonumber(ARGV[2])
local buffer = tonumber(ARGV[3])
local slot = now
if last + minTime > now then
  slot = last + minTime
end
redis.call('set', KEYS[1], slot, 'PX', (slot - now) + minTime + buffer)
return slot - now
`;

/**
 * 集中式、Redis-backed、以 CID 為 key 的 Ads 限流器（T3.6、NFR-2/FR-12、TC-16、ADR-0001）。
 *
 * - **節流**：每次 `schedule(cid, fn)` 先向 Redis 預約 per-CID 時槽（`minTime = ceil(1000/qps)`），
 *   確保**單一 job 內連續 Ads 呼叫**與**多 job 並發對同一 CID** 的請求間隔皆 ≥ minTime（跨 worker 共享）。
 * - **退避**：`fn` 拋暫時性 Ads 錯誤（RESOURCE_EXHAUSTED / RESOURCE_TEMPORARILY_EXHAUSTED）時，
 *   指數退避 `base*2^min(attempt,2)`（5s→10s→20s 封頂，Design §11）+ jitter，最多 `adsMaxRetries`
 *   次；每次重試前**仍**重新預約時槽。
 * - **不可重試**（InvalidArgument / 未知）直接拋；達退避上限亦拋（交由 processor 標 partial/failed）。
 *
 * **不**用 BullMQ worker `limiter`（只控 job 入列、OSS 不可 per-CID key）、**不**用純 in-process `p-limit`
 * （無法跨 worker 共享）。多 CID 各自一桶並行。
 *
 * `now`/`sleep`/`random` 為可覆寫測試縫（預設真實時鐘/計時器/亂數），讓時序測試確定且不 flaky。
 */
@Injectable()
export class AdsRateLimiter implements AdsThrottle, OnModuleDestroy {
  /** 目前時間（ms）；測試可覆寫成可控時鐘。 */
  now: () => number = () => Date.now();
  /** 等待（ms）；測試可覆寫成推進虛擬時鐘。 */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** [0,1) 亂數（jitter 用）；測試可覆寫成確定值。 */
  random: () => number = Math.random;

  constructor(
    @Inject(ADS_RATE_LIMITER_REDIS) private readonly redis: AdsLimiterRedis,
    @Inject(googleAdsConfig.KEY) private readonly config: ConfigType<typeof googleAdsConfig>,
    // 可觀測指標（T7.2）：每次 Ads 呼叫 +1 external call、每次退避重試 +1 retry；無 job 上下文時 no-op。
    @Optional() private readonly metrics?: JobMetricsContext,
  ) {}

  async schedule<T>(cid: string, fn: () => Promise<T>): Promise<T> {
    const minTime = this.minTimeMs();
    const jobMetrics = this.metrics?.current();
    for (let attempt = 0; ; attempt += 1) {
      await this.acquireSlot(cid, minTime);
      jobMetrics?.addExternalCalls(); // 每次 fn() 為一次 Ads API 呼叫（含退避後的重打）
      try {
        return await fn();
      } catch (err) {
        if (!isRetryableAdsError(err) || attempt >= this.config.adsMaxRetries) {
          throw err;
        }
        jobMetrics?.addRetries(); // 即將退避重試
        await this.sleep(this.backoffMs(attempt));
      }
    }
  }

  onModuleDestroy(): void {
    // 注入的連線由本限流器擁有；同步 disconnect 釋放 socket（NFR-8、防 Jest hang）。
    this.redis.disconnect();
  }

  /** per-CID 間隔（ms）；qps≤0/NaN 退回 1 QPS。 */
  private minTimeMs(): number {
    const qps = this.config.qps > 0 ? this.config.qps : 1;
    return Math.max(1, Math.ceil(1000 / qps));
  }

  /**
   * 向 Redis 原子預約時槽並等待到該時槽（跨 worker 序列化）。
   * `now` 採各 worker 本地時鐘（`Date.now`）——跨 worker 間隔精度取決於 NTP 同步；單一 Redis +
   * 合理同步下足夠（Design §10.1 允許共享計數器方案）。TTL 由 Lua 依時槽推導，永遠活過其時槽。
   */
  private async acquireSlot(cid: string, minTime: number): Promise<void> {
    const key = `ads:ratelimit:${cid}`;
    const waitRaw = await this.redis.eval(
      RESERVE_SLOT,
      1,
      key,
      String(this.now()),
      String(minTime),
      String(SLOT_TTL_BUFFER_MS),
    );
    const wait = Number(waitRaw);
    if (wait > 0) {
      await this.sleep(wait);
    }
  }

  /** 指數退避 + 正向 jitter：base*2^min(attempt,2)（封頂 20s）+ [0, base*0.2)。 */
  private backoffMs(attempt: number): number {
    const base = this.config.adsBackoffBaseMs * 2 ** Math.min(attempt, MAX_BACKOFF_DOUBLINGS);
    return base + Math.floor(base * 0.2 * this.random());
  }
}
