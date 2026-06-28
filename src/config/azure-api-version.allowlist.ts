// 單一真實來源（T0.4 ConfigModule Joi 與 T2.x AzureOpenAiService 啟動斷言共用同一份）。
// 鐵律：AZURE_OPENAI_API_VERSION 用 allowlist 集合比對，**嚴禁字典序 >= 比較**——
// 字典序會誤判 GA `2024-08-01`（被當成 `2024-08-01-preview` 之前綴而判較小）或 GA `v1`
// （字首 v 排在數字之後）。詳見 DevelopmentRules §13.2、Design §4.2、Requirement §7.2。
export const AZURE_OPENAI_API_VERSION_ALLOWLIST = [
  '2024-08-01-preview', // 首個支援 structured outputs 的版本
  '2024-10-21', // GA（建議鎖定）
  'v1', // GA v1（建議鎖定）
] as const;

export type AzureOpenAiApiVersion = (typeof AZURE_OPENAI_API_VERSION_ALLOWLIST)[number];

// 用法（config/azure.ts 與 Joi schema 引用同一陣列）：
//   AZURE_OPENAI_API_VERSION: Joi.string().valid(...AZURE_OPENAI_API_VERSION_ALLOWLIST).required()
export function isAllowedAzureApiVersion(v: string): v is AzureOpenAiApiVersion {
  return (AZURE_OPENAI_API_VERSION_ALLOWLIST as readonly string[]).includes(v);
}
