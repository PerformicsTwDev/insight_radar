-- Manual (Design §5.2, T8.1 / FR-16 / NFR-13): pgvector extension — Prisma 不自動產生 `vector`/`halfvec`
-- 型別欄位與 HNSW 索引，故整段手寫。pgvector ≥0.7 才有 `halfvec`（ANN 索引維度上限 4000 ⊇ 3072）。
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable: keyword_embeddings（gemini-embedding-001 原生 3072 已 normalize → 存 halfvec(3072) 免手動）。
CREATE TABLE "keyword_embeddings" (
    "normalized_text" TEXT NOT NULL,
    "geo" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "dim" INTEGER NOT NULL,
    "input_hash" TEXT NOT NULL,
    "embedding" halfvec(3072) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_embeddings_pkey" PRIMARY KEY ("geo", "language", "normalized_text", "model", "task_type", "dim")
);

-- HNSW ANN 索引（cosine 距離 `<=>`）：Prisma 不產生 vector 索引，手寫。halfvec_cosine_ops 支援 3072 維
-- （<= halfvec ANN 4000 上限；`vector` 型別上限僅 2000，故 3072 全維必用 halfvec）。
CREATE INDEX "ix_keyword_embeddings_hnsw" ON "keyword_embeddings" USING hnsw ("embedding" halfvec_cosine_ops);
