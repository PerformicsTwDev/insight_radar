/**
 * 社群互動計數正規化（AC-37.3 / FR-46；Design §18.5）——純函式。緊湊記法字串/數字 → 有限整數。
 *
 * 支援：純數字 / 數字字串 / 千分位逗號（`"1,234"→1234`）；英文乘數 `K/M/B`（`"8K"→8000`、`"1.2M"→1200000`）；
 * 中文乘數 `千/萬(万)/億(亿)`（`"8千"→8000`、`"3.4萬"→34000`、`"1.2億"→120000000`）。乘數計算後**四捨五入**
 * 為整數，避免二進位浮點殘渣（`1.1*1000`）。
 *
 * 缺值（`null`/`undefined`/空白）/ 不可解析 / 非有限值 → **null**（**不補 0**，S14 缺值≠0；`0` 為真實值另計）。
 * 不處理負值（互動計數非負）。
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

export function normalizeCount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
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
  if (!Number.isFinite(base)) {
    return null;
  }
  const suffix = match[2];
  // 英文乘數大小寫不敏感（`toLowerCase`）；中文乘數不受影響。regex 已把 suffix 限定在已知集合。
  const multiplier = suffix ? MULTIPLIERS[suffix.toLowerCase()] : 1;
  return multiplier === 1 ? base : Math.round(base * multiplier);
}
