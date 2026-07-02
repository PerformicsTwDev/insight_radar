-- CreateTable: serp_fetches（T8.3 / FR-15，Design §5.2/§16）——SERP 抓取持久層 SSOT（非 TTL 快取）：
-- 每次抓取一列、append-only、保留歷史（供 freshness 窗重用 + SERP-over-time）。id 由 Prisma client 產生（無 DB default）。
CREATE TABLE "serp_fetches" (
    "id" UUID NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "geo" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "device" TEXT,
    "provider" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "captured" JSONB,
    "raw" JSONB,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serp_fetches_pkey" PRIMARY KEY ("id")
);

-- 取「最新一筆」/ freshness 判斷 / SERP-over-time 查詢。
CREATE INDEX "serp_fetches_geo_language_normalized_text_fetched_at_idx" ON "serp_fetches"("geo", "language", "normalized_text", "fetched_at");
