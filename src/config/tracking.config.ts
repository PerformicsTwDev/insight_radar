import { registerAs } from '@nestjs/config';

/**
 * 追蹤清單設定（M11，FR-28/29；Design §14/§17.3）。值已由 env.validation Joi schema 驗證/補預設。
 *
 * T11.3 需 `maxMembersPerList`（加成員上限守門，AC-28.7）＋ `maxItemsPerRequest`（加成員請求形狀守門，
 * NFR-16 DoS）；T11.4 加 `maxLists`（每 owner 清單數上限，AC-28.7）；T11.5 加 `backfillMonths`（搜量刷新
 * 回填月數，AC-29.1）；其餘 `TRACKING_*`（refresh cron / keep-series-on-delete 等）由 T11.8 一併補齊。
 */
export interface TrackingConfig {
  /** 每 owner 清單數上限（AC-28.7；建立時達上限 → 409，保護每月 Ads 配額，NFR-16）。 */
  maxLists: number;
  /** 每清單成員數上限（AC-28.7；達上限再加入 → 409，保護每月 Ads 配額，NFR-16）。 */
  maxMembersPerList: number;
  /**
   * `POST /:listId/members` 單批 `items` 上限（NFR-16 DoS 前置守門；超過 → 400）。因主題列展開為「每 item
   * 沿序 ≥1 次 DB round-trip」，無上限則單一已認證請求可挾超大批次放大成應用層 DoS（連線池耗竭）——故
   * 於 `addMembers` **第一步**、先於任何 DB 存取即以此上限拒絕（比照 `INGEST_BATCH_MAX`）。
   */
  maxItemsPerRequest: number;
  /**
   * 搜量刷新時 `VolumeSnapshot.monthlyVolumes` 保留的最近月數（AC-29.1；預設 12＝Ads 原生窗）。
   * 每次刷新把觀測 `monthlyVolumes` 裁切至最近 N 個月作為時序起點（`null` 缺月不補 0）。
   */
  backfillMonths: number;
}

export const trackingConfig = registerAs('tracking', (): TrackingConfig => ({
  maxLists: Number(process.env.TRACKING_MAX_LISTS),
  maxMembersPerList: Number(process.env.TRACKING_MAX_MEMBERS_PER_LIST),
  maxItemsPerRequest: Number(process.env.TRACKING_MAX_ITEMS_PER_REQUEST),
  backfillMonths: Number(process.env.TRACKING_BACKFILL_MONTHS),
}));
