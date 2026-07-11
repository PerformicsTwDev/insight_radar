-- AlterTable: keyword_analyses 追加 owner_id（T10.6 / FR-27, Design §17.2）——資源歸屬。
-- nullable、**不回填**（M10 前既有列保持 NULL，AC-27.2）；owner 過濾在 service/repository 層強制、
-- session 只見自己 + null 共享列、apiKey 機器 actor 不過濾（AC-27.3/27.4/27.5）。id 型別對齊 users.id（UUID）。
ALTER TABLE "keyword_analyses" ADD COLUMN "owner_id" UUID;

-- 歷史清單 owner 過濾用（GET /keyword-analyses where owner_id）。
CREATE INDEX "keyword_analyses_owner_id_idx" ON "keyword_analyses"("owner_id");
