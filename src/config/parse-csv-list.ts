/**
 * 逗號分隔字串 → 去每個 token 前後空白、濾除空項的陣列
 * （`"v1, v2" → ["v1","v2"]`；`undefined`／空字串／全逗號空白 → `[]`）。
 *
 * config namespace 的共用 CSV list 解析單點：`app.config` 的 `ALLOWED_ORIGINS`（CORS 白名單）與
 * `ingest.config` 的 `CAPTURE_ACCEPTED_SCHEMA_VERSIONS`／`EXTENSION_BRIDGE_REQUIRED_FEATURES` 皆委派之，
 * 避免各處重複 `split(',').map(trim).filter(nonEmpty)`（M13-R6 [14]）。
 */
export function parseCsvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}
