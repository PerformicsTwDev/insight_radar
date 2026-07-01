import { registerAs } from '@nestjs/config';

export interface QueryConfig {
  /** `/query` 與 `/keywords` 單頁上限（`pageSize`>此值 → 400；Design §6.5，預設 200）。 */
  maxPageSize: number;
  /** chart 內部分桶引擎最大桶數（超出即 400；Design §9.3，預設 200）。 */
  aggMaxBuckets: number;
  /** chart 內部群組上限（top-N；超出 → `meta.truncated`；Design §9.3，預設 1000、硬上限 5000）。 */
  aggMaxGroups: number;
}

/** 讀取層/彙整設定（值已由 env.validation Joi schema 驗證/補預設；FR-14/NFR-10）。 */
export const queryConfig = registerAs('query', (): QueryConfig => ({
  maxPageSize: Number(process.env.QUERY_MAX_PAGE_SIZE),
  aggMaxBuckets: Number(process.env.AGG_MAX_BUCKETS),
  aggMaxGroups: Number(process.env.AGG_MAX_GROUPS),
}));
