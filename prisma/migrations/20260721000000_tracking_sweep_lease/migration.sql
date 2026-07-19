-- M11 排程刷新 sweep 的 DB 租約鎖（single-flight，#470/NFR-16；Design §17.3）.
-- sweep 為 append-only + partial 韌性（AC-29.5）→ 不可包進單一長交易；改用租約：scheduled job 進場以單一
-- 原子 INSERT ... ON CONFLICT DO UPDATE ... WHERE leased_until < now() RETURNING 搶租約，搶到才 sweep、
-- 否則跳過（防排程堆積 + 跨實例並發雙刷、雙耗 Ads 配額）。Lease-only DDL（僅新增此表）；不觸碰既有索引.

-- CreateTable
CREATE TABLE "tracking_sweep_leases" (
    "name" TEXT NOT NULL,
    "leased_until" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tracking_sweep_leases_pkey" PRIMARY KEY ("name")
);
