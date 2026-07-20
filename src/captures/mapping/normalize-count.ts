/**
 * 社群互動計數正規化（AC-37.3 / FR-46；Design §18.5）——純函式。緊湊記法字串/數字 → 有限、非負、安全整數。
 *
 * 支援：純數字 / 數字字串 / 千分位逗號（`"1,234"→1234`）；英文乘數 `K/M/B`（`"8K"→8000`、`"1.2M"→1200000`）；
 * 中文乘數 `千/萬(万)/億(亿)`（`"8千"→8000`、`"3.4萬"→34000`、`"1.2億"→120000000`）。
 *
 * 正規化結果恆為**有限、非負、JS 安全整數（< 2^53）**：
 * - 非整數**四捨五入**為整數（`3.7→4`；乘數路徑亦避免二進位浮點殘渣如 `1.1*1000`）。
 * - **負值 → null**（互動計數非負，S14 缺值另計）。
 * - 超 JS 安全整數（>2^53）→ null（不外漏失精度整數）。`8K/8千→8000`、`1.2億→1.2e8` 等大數保留**全精度**，
 *   **mapper 層不 clamp**（INT4 溢位屬 M16 落庫責任——`SocialPost.likes…` 應評估 BigInt，比照 #469 VolumeSnapshot）。
 *
 * 缺值（`null`/`undefined`/空白）/ 不可解析 / 非有限值 → **null**（**不補 0**，S14 缺值≠0；`0` 為真實值另計）。
 */
const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
  千: 1e3,
  萬: 1e4,
  万: 1e4,
  億: 1e8,
  亿: 1e8,
};

// `<digits>[.<digits>]` + 可選單一乘數後綴（大小寫不敏感）。
const COMPACT = /^(\d+(?:\.\d+)?)([kmb千萬万億亿])?$/i;

/** 收斂為有限、非負、JS 安全整數（四捨五入）；否則 null（不外漏 NaN/Infinity/負數/失精度整數）。 */
function toCount(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) ? rounded : null;
}

export function normalizeCount(value: unknown): number | null {
  if (typeof value === 'number') {
    return toCount(value);
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  // 去千分位逗號後比對；suffix 大小寫不敏感（英文），中文字元不受 `i` 影響。
  const match = COMPACT.exec(trimmed.replace(/,/g, ''));
  if (!match) {
    return null;
  }

  const base = Number(match[1]);
  const suffix = match[2];
  // 英文乘數大小寫不敏感（`toLowerCase`）；中文乘數不受影響。regex 已把 suffix 限定在已知集合。
  const multiplier = suffix ? MULTIPLIERS[suffix.toLowerCase()] : 1;
  return toCount(base * multiplier);
}
