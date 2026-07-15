-- M11 追蹤清單與搜量時序（T11.1，FR-28~30 / NFR-16；Design §17.3）.
-- Tracking-only DDL. `prisma migrate dev` also emitted DROP INDEX for the pgvector
-- HNSW / pg_trgm indexes and a topic_taxonomy self-FK churn — pre-existing "drift"
-- from manual SQL that schema.prisma can't express (migrations rule §3; schema.prisma
-- comments L2/L97), NOT part of T11.1, and dropping them would break embeddings/keyword
-- search — so they are curated out. This migration touches ONLY the three new tables.

-- CreateTable
CREATE TABLE "tracking_lists" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "name" TEXT NOT NULL,
    "geo" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_list_members" (
    "list_id" UUID NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_checked_at" TIMESTAMPTZ,

    CONSTRAINT "tracking_list_members_pkey" PRIMARY KEY ("list_id","normalized_text")
);

-- CreateTable
CREATE TABLE "volume_snapshots" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "geo" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "avg_monthly_searches" INTEGER,
    "monthly_volumes" JSONB NOT NULL DEFAULT '[]',
    "competition" TEXT,
    "competition_index" INTEGER,
    "cpc_low_micros" BIGINT,
    "cpc_high_micros" BIGINT,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "volume_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tracking_lists_owner_id_name_key" ON "tracking_lists"("owner_id", "name");

-- CreateIndex
CREATE INDEX "volume_snapshots_list_id_normalized_text_fetched_at_idx" ON "volume_snapshots"("list_id", "normalized_text", "fetched_at");

-- AddForeignKey
ALTER TABLE "tracking_list_members" ADD CONSTRAINT "tracking_list_members_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "tracking_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
