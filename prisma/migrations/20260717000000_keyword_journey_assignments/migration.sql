-- M12 購買歷程分類（T12.5，FR-33 / AC-33.5；Design §17.5）.
-- Journey-only DDL: one new table, PK [snapshot_id, normalized_text]. **分表互補、不覆寫**
-- keyword_intents（S10）——此 migration 只新增 keyword_journey_assignments，不動既有表。

-- CreateTable
CREATE TABLE "keyword_journey_assignments" (
    "keyword_analysis_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "stage" TEXT NOT NULL,

    CONSTRAINT "keyword_journey_assignments_pkey" PRIMARY KEY ("snapshot_id","normalized_text")
);
