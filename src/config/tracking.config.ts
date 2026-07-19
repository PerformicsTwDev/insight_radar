import { registerAs } from '@nestjs/config';

/**
 * 追蹤清單設定（M11，FR-28/29；Design §14/§17.3）。值已由 env.validation Joi schema 驗證/補預設。
 *
 * T11.3 需 `maxMembersPerList`（加成員上限守門，AC-28.7）＋ `maxItemsPerRequest`（加成員請求形狀守門，
 * NFR-16 DoS）；T11.4 加 `maxLists`（每 owner 清單數上限，AC-28.7）；T11.5 加 `backfillMonths`（搜量刷新
 * 回填月數，AC-29.1）；T11.6 加 `refreshCron`；T11.8 加 `keepSeriesOnDelete`（刪清單時序保留旗標，AC-28.2）。
 * （`HISTORY_RETENTION_DAYS`＝reserved 未接線，無 pruning 消費者故不入此 config，見 Design §14。）
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
  /**
   * 排程刷新的 BullMQ repeatable job cron（AC-29.2；預設每日一次 `0 3 * * *`，Design §14）。月粒度指標
   * 日間多半不變、store-on-change dedup 避免冗餘落列，故無需高頻。以 job scheduler 註冊、cron pattern 觸發。
   */
  refreshCron: string;
  /**
   * 刪清單時是否**保留**時序快照（AC-28.2；預設 `false`＝連帶刪除）。`VolumeSnapshot` 無 FK cascade（僅
   * `listId` 欄）→ `remove()` 於 `false` 時**顯式** `deleteMany({listId})`；`true` 則跳過、保留孤立快照。
   */
  keepSeriesOnDelete: boolean;
  /**
   * 排程刷新 sweep 的 DB 租約鎖 TTL（毫秒；single-flight，#470/NFR-16；預設 3600000＝1h）。scheduled job 進場
   * 原子搶 `tracking_sweep_leases` 租約（搶到才 sweep、否則跳過），`finally` 釋放；此 TTL 為 **crash 復原上界**
   * （持有者崩潰未釋放 → TTL 到期後下次 cron 可再搶）。**須 ≥ 預期 sweep 時長**（否則租約先到期→重疊；殘留窄窗，
   * Design §17.3）。防排程堆積（sweep 久於 cron → 下一 job 準時入列雙刷）與跨實例並發、雙耗 Ads 配額。
   */
  sweepLeaseMs: number;
}

export const trackingConfig = registerAs('tracking', (): TrackingConfig => ({
  maxLists: Number(process.env.TRACKING_MAX_LISTS),
  maxMembersPerList: Number(process.env.TRACKING_MAX_MEMBERS_PER_LIST),
  maxItemsPerRequest: Number(process.env.TRACKING_MAX_ITEMS_PER_REQUEST),
  backfillMonths: Number(process.env.TRACKING_BACKFILL_MONTHS),
  refreshCron: String(process.env.TRACKING_REFRESH_CRON),
  keepSeriesOnDelete: process.env.TRACKING_KEEP_SERIES_ON_DELETE === 'true',
  sweepLeaseMs: Number(process.env.TRACKING_SWEEP_LEASE_MS),
}));
