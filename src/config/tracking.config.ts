import { registerAs } from '@nestjs/config';

/**
 * 追蹤清單設定（M11，FR-28/29；Design §14/§17.3）。值已由 env.validation Joi schema 驗證/補預設。
 *
 * T11.3 需 `maxMembersPerList`（加成員上限守門，AC-28.7）＋ `maxItemsPerRequest`（加成員請求形狀守門，
 * NFR-16 DoS）；其餘 `TRACKING_*`（refresh cron / backfill months / keep-series-on-delete 等）由 T11.8
 * 一併補齊，故此處**只**登記本任務所需項。
 */
export interface TrackingConfig {
  /** 每清單成員數上限（AC-28.7；達上限再加入 → 409，保護每月 Ads 配額，NFR-16）。 */
  maxMembersPerList: number;
  /**
   * `POST /:listId/members` 單批 `items` 上限（NFR-16 DoS 前置守門；超過 → 400）。因主題列展開為「每 item
   * 沿序 ≥1 次 DB round-trip」，無上限則單一已認證請求可挾超大批次放大成應用層 DoS（連線池耗竭）——故
   * 於 `addMembers` **第一步**、先於任何 DB 存取即以此上限拒絕（比照 `INGEST_BATCH_MAX`）。
   */
  maxItemsPerRequest: number;
}

export const trackingConfig = registerAs('tracking', (): TrackingConfig => ({
  maxMembersPerList: Number(process.env.TRACKING_MAX_MEMBERS_PER_LIST),
  maxItemsPerRequest: Number(process.env.TRACKING_MAX_ITEMS_PER_REQUEST),
}));
