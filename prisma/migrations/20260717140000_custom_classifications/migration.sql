-- M12 自訂分類定義（T12.7 階段一，FR-34/AC-34.1；Design §17.5）.
-- instruction + snapshot 樣本 → LLM 生 labels（HITL 待確認）；每字→label 指派於階段二（T12.8）.
-- Custom-classification-only DDL（僅新增此表）；不觸碰既有 pgvector / pg_trgm 索引（migrations 規則 §3）.

-- CreateTable
CREATE TABLE "custom_classifications" (
    "id" UUID NOT NULL,
    "keyword_analysis_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "labels" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_classifications_keyword_analysis_id_idx" ON "custom_classifications"("keyword_analysis_id");
