/**
 * M15 AI 回答分析版本 namespace（T15.1，FR-42 / §14 config）——供下游落列 tag / idempotency 的版本段使用
 * （bump 即整批失效）。慣例同 `topics.config`（`process.env.X ?? 'v1'`）；Joi 驗證（限 `v\d+`、擋 `:` 注入 cache
 * namespace）+ `.env.example` 文件屬 **T15.7**。
 *
 * **唯一 invalidation lever（M15-R6/#688）**：`aiVisibilitySchemaVersion()`（`AI_VISIBILITY_SCHEMA_VERSION`）。
 * 早期自 brand_intent_radar 搬移的三線 per-prompt 版本（brandExtract/sentiment/mediaClassify）**production 零消費**
 * ——ai-visibility 無 cache 層、Prisma 僅單一 `schemaVersion` 欄——屬 documented no-op / ops trap，已移除
 * （連同 Joi/.env.example/RUNBOOK/Design §14 條目）。bump 分析版本經 `AI_VISIBILITY_SCHEMA_VERSION` 一律有效
 * （M15-R5/#687 後對已完成 run 亦生效：bump 即產新 idempotency key → 新 run → 分析重跑、rows 打新版本 tag）。
 */

/**
 * AI 可見度分析/指標 schema 版本（`AI_VISIBILITY_SCHEMA_VERSION`，預設 `v1`；Design §14）——落 `ai_answers` /
 * `ai_cited_references` / `ai_visibility_metrics` 每列標記，bump 即整批失效（分析層版本，與抓取層
 * `AI_SEARCH_SCHEMA_VERSION` 分工）。同入 AI Search run 的 idempotency key（M15-R5），使 bump 對已完成 run 亦強制重跑。
 */
export function aiVisibilitySchemaVersion(): string {
  return process.env.AI_VISIBILITY_SCHEMA_VERSION ?? 'v1';
}
