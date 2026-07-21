-- M15 AI 可見度分析結果 + 指標落庫（T15.5，FR-42/FR-43；Design §18.4）.
-- AI Search 抓取 job（T14.6）合流的 AiSearchCapture 經三線 LLM pipeline（品牌/情緒/媒體，T15.2/T15.3）分析後，
-- 衍生 per-answer（ai_answers）+ per-reference 媒體分類（ai_cited_references）+ 可見度指標（ai_visibility_metrics，
-- buildAiVisibility T15.4 攤平）落庫，供 T15.6 view 讀取。沿用抓取 job 落點（job_id = ai_search_runs.id），
-- 分析結果以 job_id clean-slate 保 idempotent re-run。append-only：僅新增三表 + 其索引，不觸碰既有表/索引（§3）.

-- CreateTable
CREATE TABLE "ai_answers" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "job_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "answer_text" TEXT NOT NULL,
    "brands" JSONB NOT NULL DEFAULT '[]',
    "positive" INTEGER NOT NULL DEFAULT 0,
    "negative" INTEGER NOT NULL DEFAULT 0,
    "schema_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_cited_references" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "job_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "media_type" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_cited_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_visibility_metrics" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "job_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "group_key" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "mentions" INTEGER NOT NULL,
    "share_of_voice" DOUBLE PRECISION,
    "citations" INTEGER NOT NULL,
    "exposure" DOUBLE PRECISION,
    "schema_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_visibility_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_answers_job_id_channel_idx" ON "ai_answers"("job_id", "channel");

-- CreateIndex
CREATE INDEX "ai_cited_references_job_id_channel_idx" ON "ai_cited_references"("job_id", "channel");

-- CreateIndex
CREATE INDEX "ai_visibility_metrics_job_id_dimension_channel_idx" ON "ai_visibility_metrics"("job_id", "dimension", "channel");
