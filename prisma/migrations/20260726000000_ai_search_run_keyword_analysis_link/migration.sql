-- T15.8a AI Search ↔ keyword-analysis 連結（#678 G1，Option A additive optional link）.
-- 加 nullable keyword_analysis_id + index：keyword-analysis 的 `ai_search` feature 由該 analysis
-- 最新 linked AiSearchRun 狀態推導（owner-scoped）。standalone M14 用法（POST /ai-search-analyses 未帶
-- analysisId）落 NULL，完全保留 FR-41 行為（向後相容）。append-only：僅 ALTER 既有表加欄 + index，
-- 不動既有欄/索引（migrations 規則 §3；欄可為 NULL → 既有列免回填）.

-- AlterTable
ALTER TABLE "ai_search_runs" ADD COLUMN "keyword_analysis_id" UUID;

-- CreateIndex
CREATE INDEX "ai_search_runs_keyword_analysis_id_idx" ON "ai_search_runs"("keyword_analysis_id");
