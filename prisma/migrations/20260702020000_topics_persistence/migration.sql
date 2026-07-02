-- CreateTable: topic_cluster_runs / topic_clusters / keyword_cluster_assignments
-- (T8.8 / FR-15/18, Design §16.4) —— 主題分群 job + 每群命名 + 每字群指派。標準型別（無 pgvector）。
-- id（TopicRun/TopicCluster）由 Prisma client 產生（無 DB default）；群層 intent 與 FR-4 keyword_intents 分表互補。
CREATE TABLE "topic_cluster_runs" (
    "id" UUID NOT NULL,
    "keyword_analysis_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "progress" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "cluster_count" INTEGER,
    "noise_count" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_cluster_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "topic_cluster_runs_idempotency_key_key" ON "topic_cluster_runs"("idempotency_key");

CREATE TABLE "topic_clusters" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "cluster_label" INTEGER NOT NULL,
    "topic_name" TEXT NOT NULL,
    "parent_topic" TEXT NOT NULL,
    "intent_label" TEXT NOT NULL,
    "topic_type" TEXT NOT NULL,
    "reason" TEXT,
    "cluster_volume" BIGINT,
    "keyword_count" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION,
    "representative_keywords" JSONB NOT NULL,

    CONSTRAINT "topic_clusters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "topic_clusters_run_id_idx" ON "topic_clusters"("run_id");

CREATE TABLE "keyword_cluster_assignments" (
    "run_id" UUID NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "cluster_id" UUID,
    "confidence" DOUBLE PRECISION NOT NULL,
    "is_noise" BOOLEAN NOT NULL,

    CONSTRAINT "keyword_cluster_assignments_pkey" PRIMARY KEY ("run_id","normalized_text")
);

-- FK: topic_clusters.run_id → topic_cluster_runs.id（keyword_cluster_assignments.cluster_id 依 Design 為裸 UUID、無 FK）。
ALTER TABLE "topic_clusters" ADD CONSTRAINT "topic_clusters_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "topic_cluster_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
