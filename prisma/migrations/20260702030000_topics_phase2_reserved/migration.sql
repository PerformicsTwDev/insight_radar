-- CreateTable: topic_taxonomy / topic_audit_logs（T8.11 / Design §16.4 Phase 2 RESERVED）——
-- 主題階層樹（self-FK，FR-20/21）+ 人工校正稽核（FR-19）。**本期僅建表、無邏輯**；id 由 Prisma client 產生。
CREATE TABLE "topic_taxonomy" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "level" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "topic_name" TEXT NOT NULL,

    CONSTRAINT "topic_taxonomy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "topic_taxonomy_parent_id_idx" ON "topic_taxonomy"("parent_id");

-- self-FK：parent_id → topic_taxonomy(id)（樹狀結構；刪除父需先處理子，故 RESTRICT）。
ALTER TABLE "topic_taxonomy" ADD CONSTRAINT "topic_taxonomy_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "topic_taxonomy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "topic_audit_logs" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_audit_logs_pkey" PRIMARY KEY ("id")
);
