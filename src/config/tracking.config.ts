import { registerAs } from '@nestjs/config';

/**
 * 追蹤清單設定（M11，FR-28/29；Design §14/§17.3）。值已由 env.validation Joi schema 驗證/補預設。
 *
 * T11.3 僅需 `maxMembersPerList`（加成員上限守門，AC-28.7）；其餘 `TRACKING_*`（refresh cron /
 * backfill months / keep-series-on-delete 等）由 T11.8 一併補齊，故此處**只**登記本任務所需一項。
 */
export interface TrackingConfig {
  /** 每清單成員數上限（AC-28.7；達上限再加入 → 409，保護每月 Ads 配額，NFR-16）。 */
  maxMembersPerList: number;
}

export const trackingConfig = registerAs('tracking', (): TrackingConfig => ({
  maxMembersPerList: Number(process.env.TRACKING_MAX_MEMBERS_PER_LIST),
}));
