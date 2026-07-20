-- M14 品牌檔案（T14.5，FR-40；Design §18.3）.
-- 綁 owner_id（FR-27，nullable、不回填）——owner 過濾唯一強制點在 service 層（S8，非參數繞過）。
-- name/aliases/sites/competitors 供 AI 可見度分析抽取與計數（FR-42/43）；aliases 聯集正規化比對抽純函式。
-- 同 owner name 唯一（UNIQUE (owner_id, name)；Postgres NULLs distinct → 機器 null-owner 同名不受約束，
-- 與 tracking_lists 同型；重複→409）。append-only：僅新增此表 + 其 unique index，不觸碰既有表/索引
-- （migrations 規則 §3，roll-forward only）.

-- CreateTable
CREATE TABLE "brand_profiles" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "sites" JSONB NOT NULL DEFAULT '[]',
    "competitors" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_profiles_owner_id_name_key" ON "brand_profiles"("owner_id", "name");
