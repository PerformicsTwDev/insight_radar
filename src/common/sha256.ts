import { createHash } from 'node:crypto';

/** 內容定址雜湊（集中：cache key、checksum、idempotency 共用同一 sha256 hex）。 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
