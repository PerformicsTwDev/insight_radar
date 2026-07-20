-- M14 AI Search 抓取 job async run（T14.6，FR-41/AC-41.x；Design §18.3）.
-- 202→GET/SSE/idempotency/partial 契約，仿 journey_runs / custom_classify_runs（fresh top-level input：
-- id 即 jobId，非巢狀於既有分析）。owner_id（FR-27，nullable、不回填）；idempotency_key 唯一
-- （並發 P2002 慢路徑仲裁）。append-only：僅新增此表 + 其 unique index，不觸碰既有表/索引（migrations 規則 §3）.

-- CreateTable
CREATE TABLE "ai_search_runs" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "status" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "progress" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "capture_count" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_search_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_search_runs_idempotency_key_key" ON "ai_search_runs"("idempotency_key");
