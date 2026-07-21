/**
 * M15 AI 回答分析 prompt 版本 namespace（T15.1，FR-42 / §14 config）——供下游快取 key 的版本段使用
 * （bump 即整批失效，S17/S19）。搬自 brand_intent_radar 的三線 prompt 各一版本；預設 `v1`、可經 env 覆寫。
 *
 * 慣例同 `topics.config`（`process.env.X ?? 'v1'`）。**Joi 驗證（限 `v\d+`、擋 `:` 注入 cache namespace）+
 * `.env.example` 文件**屬 **T15.7**（`AI_VISIBILITY_SCHEMA_VERSION` 一併入 config namespace）；本檔僅建立取值點，
 * 使 T15.2/T15.3 服務可先接上版本化快取。
 */

/** 品牌抽取 prompt 版本（`BRAND_EXTRACT_PROMPT_VERSION`，預設 `v1`）。 */
export function brandExtractPromptVersion(): string {
  return process.env.BRAND_EXTRACT_PROMPT_VERSION ?? 'v1';
}

/** 情緒 prompt 版本（`SENTIMENT_PROMPT_VERSION`，預設 `v1`）。 */
export function sentimentPromptVersion(): string {
  return process.env.SENTIMENT_PROMPT_VERSION ?? 'v1';
}

/** 引用媒體分類 prompt 版本（`MEDIA_CLASSIFY_PROMPT_VERSION`，預設 `v1`）。 */
export function mediaClassifyPromptVersion(): string {
  return process.env.MEDIA_CLASSIFY_PROMPT_VERSION ?? 'v1';
}
