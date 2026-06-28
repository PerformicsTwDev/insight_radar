-- Manual (Design §5.2): pg_trgm extension — Prisma 不自動產生；下方 trgm GIN 索引需要它，故置頂。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'completed', 'partial', 'failed', 'canceled');

-- CreateTable
CREATE TABLE "keyword_analyses" (
    "id" UUID NOT NULL,
    "status" "JobStatus" NOT NULL,
    "seeds" JSONB NOT NULL,
    "params" JSONB NOT NULL,
    "progress" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "result_snapshot_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "keyword_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_snapshots" (
    "id" UUID NOT NULL,
    "keyword_analysis_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "keyword_count" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,

    CONSTRAINT "result_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keywords" (
    "normalized_text" TEXT NOT NULL,
    "geo" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "avg_monthly_searches" INTEGER,
    "competition" TEXT,
    "competition_index" INTEGER,
    "cpc_low_micros" BIGINT,
    "cpc_high_micros" BIGINT,
    "monthly_volumes" JSONB NOT NULL DEFAULT '[]',
    "currency_code" TEXT,
    "metrics_fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keywords_pkey" PRIMARY KEY ("geo","language","normalized_text")
);

-- CreateTable
CREATE TABLE "keyword_intents" (
    "normalized_text" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "labels" JSONB NOT NULL,
    "labeled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_intents_pkey" PRIMARY KEY ("normalized_text","model_version")
);

-- CreateTable
CREATE TABLE "snapshot_rows" (
    "snapshot_id" UUID NOT NULL,
    "keyword_analysis_id" UUID NOT NULL,
    "row_index" INTEGER NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "snapshot_rows_pkey" PRIMARY KEY ("snapshot_id","row_index")
);

-- CreateIndex
CREATE UNIQUE INDEX "keyword_analyses_idempotency_key_key" ON "keyword_analyses"("idempotency_key");

-- CreateIndex
CREATE INDEX "keyword_analyses_status_idx" ON "keyword_analyses"("status");

-- CreateIndex
CREATE INDEX "result_snapshots_keyword_analysis_id_idx" ON "result_snapshots"("keyword_analysis_id");

-- CreateIndex
CREATE INDEX "snapshot_rows_keyword_analysis_id_idx" ON "snapshot_rows"("keyword_analysis_id");

-- AddForeignKey
ALTER TABLE "keyword_analyses" ADD CONSTRAINT "keyword_analyses_result_snapshot_id_fkey" FOREIGN KEY ("result_snapshot_id") REFERENCES "result_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_rows" ADD CONSTRAINT "snapshot_rows_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "result_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manual (Design §5.2): GIN / trgm 索引 — Prisma 不自動產生。
-- keywords.text 模糊搜尋（pg_trgm）：
CREATE INDEX "ix_keywords_text_trgm" ON "keywords" USING gin ("text" gin_trgm_ops);
-- snapshot_rows.data->intentLabels 的 jsonb any/all（?| / @>）：
CREATE INDEX "ix_snap_intent" ON "snapshot_rows" USING gin (("data" -> 'intentLabels'));
-- snapshot_rows.data->>text 的模糊搜尋（pg_trgm）：
CREATE INDEX "ix_snap_text_trgm" ON "snapshot_rows" USING gin (("data" ->> 'text') gin_trgm_ops);
