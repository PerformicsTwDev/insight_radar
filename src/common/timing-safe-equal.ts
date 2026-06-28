import { timingSafeEqual } from 'node:crypto';

/**
 * 常數時間字串比較（避免 timing side-channel 洩漏祕密）。
 * 長度不同直接回 false（不洩漏內容）；等長時走 `crypto.timingSafeEqual`。
 *
 * 給 ApiKeyGuard 及未來其他祕密比對（webhook signature 等）共用。
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}
