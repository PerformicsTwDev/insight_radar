-- M13 中立資料模型基座（T13.1，FR-36/37、NFR-17；Design §18.1/18.2/18.3/18.5）.
-- 來源無關 ingestion 的分層資料模型（INV-4/5）：raw append-only（captures）→ per-source/per-platform mapper（T13.4）→
-- canonical 具名表（ai_search_captures / social_posts）。**本 migration 僅新增此三表 + 其索引**（append-only DDL）；
-- 不觸碰既有 pgvector / pg_trgm 索引與任何已套用表（migrations 規則 §3；roll-forward only）.
-- captures.content_hash = sha256(canonical(source,schemaVersion,item))＝同來源同內容去重鍵（S16，content-hash
-- idempotency 前置，供 T13.3）；owner_id 第一天存在（FR-27，機器 x-api-key 來源=null）。canonical 兩表為骨架
-- （建表可讀寫），mapper/job/分析面於 M14/M16 逐步填.

-- CreateTable
CREATE TABLE "captures" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "source" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "channel" TEXT,
    "platform" TEXT,
    "content_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "map_status" TEXT NOT NULL DEFAULT 'ok',
    "captured_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_search_captures" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "job_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "references" JSONB NOT NULL DEFAULT '[]',
    "captured_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_search_captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "job_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "post_key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "author" TEXT,
    "profile_link" TEXT,
    "content" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ,
    "likes" INTEGER,
    "comments" INTEGER,
    "reposts" INTEGER,
    "shares" INTEGER,
    "schema_version" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "captures_source_channel_captured_at_idx" ON "captures"("source", "channel", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "captures_content_hash_key" ON "captures"("content_hash");

-- CreateIndex
CREATE INDEX "ai_search_captures_job_id_channel_query_idx" ON "ai_search_captures"("job_id", "channel", "query");

-- CreateIndex
CREATE INDEX "social_posts_job_id_published_at_idx" ON "social_posts"("job_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "social_posts_job_id_post_key_key" ON "social_posts"("job_id", "post_key");
