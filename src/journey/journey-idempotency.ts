import { canonicalStringify } from '../common/canonical-json';
import { sha256Hex } from '../common/sha256';
import type { JourneyRunParams } from './journey-run.types';

/**
 * 計算購買歷程 job 的 idempotency key（T12.6，FR-33/AC-33.6；仿 computeTopicIdempotencyKey）。
 *
 * 語意相同 → 同一 key（同分析 + 同 snapshot + 同版本參數 → 命中既有 run、不重跑）：
 * - `analysisId`：綁定特定分析（`idempotency_key` 全域 unique、GET 以 `keywordAnalysisId` 查 run；只用內容
 *   定址會使兩個內容相同的不同分析撞同一 key）。
 * - `snapshotChecksum`：綁定該分析的特定不可變 snapshot（內容變 → 不同 key）。
 * - `params`：`{ schemaVersion, deployment }` 以**鍵序無關的 canonical JSON**（共用 S9 單點）序列化。
 *   bump `JOURNEY_SCHEMA_VERSION` / 換部署 → 不同 key → 允許新 run。回傳 sha256 hex。
 */
export function computeJourneyIdempotencyKey(
  analysisId: string,
  snapshotChecksum: string,
  params: JourneyRunParams,
): string {
  return sha256Hex(canonicalStringify({ analysisId, checksum: snapshotChecksum, params }));
}
