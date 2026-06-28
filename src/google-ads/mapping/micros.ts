/** micros 的固定比例：1 單位 = 1,000,000 micros（Google Ads 金額單位）。 */
const MICROS_PER_UNIT = 1_000_000;

/**
 * 把原始 micros 解析為 BigInt；**未設值**（`null`/`undefined`/`''`/全空白）→ `null`（**不視為 0**）。
 *
 * 守住「缺值 ≠ 0」單點：上游若以空字串表示未設 bid，也不會被 `BigInt('')===0n` 變成 0。
 * 真正畸形的字串（如 `'abc'`）仍由 `BigInt` 丟出 `SyntaxError`——契約已漂移，應 fail-loud 而非靜默吞掉。
 */
export function parseMicros(micros: string | number | null | undefined): bigint | null {
  if (micros === null || micros === undefined) {
    return null;
  }
  if (typeof micros === 'string' && micros.trim() === '') {
    return null;
  }
  return BigInt(micros);
}

/**
 * 將 micros 轉為金額（÷ 1,000,000，FR-3 / NFR-7）。
 *
 * - `null`/`undefined` → `null`（**絕不補 0**；low-volume 字常缺 bid，缺值與 0 語意不同）。
 * - `0` → `0`（真實值，與 null 區分）。
 * - 以整數位數/小數位數分離計算，避免浮點誤差（例 1,230,000 → 1.23，非 1.2299999999999998）。
 *
 * 註：Google Ads bid micros 一律非負，故不處理負值；如未來有帶號需求再擴充。
 */
export function microsToAmount(micros: string | number | null | undefined): number | null {
  const asBig = parseMicros(micros);
  if (asBig === null) {
    return null;
  }
  const whole = asBig / BigInt(MICROS_PER_UNIT);
  const frac = asBig % BigInt(MICROS_PER_UNIT);
  // 組成 `whole.frac` 字串再 parseFloat：避免 number 除法的二進位浮點漂移。
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return Number(fracStr ? `${whole}.${fracStr}` : `${whole}`);
}
