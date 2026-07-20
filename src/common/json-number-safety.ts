/**
 * JSON numeric-precision safety (M13-R2 / #553).
 *
 * Content-addressed hashes (S16 capture content-hash) are computed over an **already-JSON.parsed** value.
 * JS numbers are IEEE-754 doubles, so any integer whose magnitude exceeds `Number.MAX_SAFE_INTEGER`
 * (2^53-1) loses precision on parse: two distinct 64-bit ids sent as JSON *numbers* collapse to the same
 * double → same canonical serialization → same hash → dedup silently drops a distinct row.
 *
 * `findUnsafeJsonNumberPath` recursively scans a parsed value (mirroring `canonicalize`'s recursion —
 * objects + arrays) and returns the JSONPath-ish location of the **first** number whose magnitude exceeds
 * `Number.MAX_SAFE_INTEGER`, or `null` when every number is precision-safe. Callers reject unsafe payloads
 * at the ingest boundary (large ids must be sent as strings), which makes the collision unrepresentable —
 * no big-integer JSON parser or dependency required.
 *
 * Only magnitude matters: safe integers round-trip exactly, and fractional values within the safe range
 * that share a double are semantically equal (acceptable dedup). Values ≥ 2^53 are where distinct JSON
 * numbers begin collapsing, so `> Number.MAX_SAFE_INTEGER` is the exact cutoff.
 */
export function findUnsafeJsonNumberPath(value: unknown, path = '$'): string | null {
  if (typeof value === 'number') {
    // JSON numbers are always finite (JSON has no NaN/Infinity), so magnitude alone decides safety.
    return Math.abs(value) > Number.MAX_SAFE_INTEGER ? path : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findUnsafeJsonNumberPath(value[i], `${path}[${i}]`);
      if (hit !== null) {
        return hit;
      }
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const hit = findUnsafeJsonNumberPath(nested, `${path}.${key}`);
      if (hit !== null) {
        return hit;
      }
    }
    return null;
  }
  return null;
}
