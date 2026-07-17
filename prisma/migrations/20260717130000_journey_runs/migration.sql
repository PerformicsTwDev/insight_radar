-- M12 購買歷程分類 async job run（T12.6，FR-33/AC-33.6；Design §17.5）.
-- 202→GET/SSE/idempotency 契約，仿 topic_cluster_runs。Journey-run-only DDL（僅新增此表）；
-- 不觸碰既有 pgvector / pg_trgm 索引（migrations 規則 §3）.

-- CreateTable
CREATE TABLE "journey_runs" (
    "id" UUID NOT NULL,
    "keyword_analysis_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "progress" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "keyword_count" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "journey_runs_idempotency_key_key" ON "journey_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "journey_runs_keyword_analysis_id_idx" ON "journey_runs"("keyword_analysis_id");
