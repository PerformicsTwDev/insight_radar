-- M12 自訂分類階段二（T12.8，FR-34/AC-34.2/34.3；Design §17.4）.
-- keyword_custom_assignments（每字→label 物化，不覆寫 keyword_intents）+ custom_classify_runs（async job 追蹤，
-- 202→GET/SSE/idempotency 契約，仿 journey_runs）。Stage-2-only DDL（僅新增此二表）；
-- 不觸碰既有 pgvector / pg_trgm 索引（migrations 規則 §3）.

-- CreateTable
CREATE TABLE "keyword_custom_assignments" (
    "classification_id" UUID NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "keyword_custom_assignments_pkey" PRIMARY KEY ("classification_id","normalized_text")
);

-- CreateTable
CREATE TABLE "custom_classify_runs" (
    "id" UUID NOT NULL,
    "classification_id" UUID NOT NULL,
    "keyword_analysis_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "progress" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "keyword_count" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_classify_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_classify_runs_idempotency_key_key" ON "custom_classify_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "custom_classify_runs_classification_id_idx" ON "custom_classify_runs"("classification_id");

-- CreateIndex
CREATE INDEX "custom_classify_runs_keyword_analysis_id_idx" ON "custom_classify_runs"("keyword_analysis_id");
