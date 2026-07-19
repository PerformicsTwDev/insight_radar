import type { CanonicalCapture, MapResult } from './canonical.types';

/**
 * 產生 `failed` 結果（AC-37.4）——mapper 與 registry 共用的單一 SSOT：`canonical=null`、`raw` 保留（INV-4）、
 * 單一 `reason`。核心欄可映但有次要缺漏的 `partial`/`ok` 由各 mapper 自行組裝（含多 reason），不走此 helper。
 */
export function failResult<T extends CanonicalCapture>(raw: unknown, reason: string): MapResult<T> {
  return { mapStatus: 'failed', canonical: null, raw, reasons: [reason] };
}
