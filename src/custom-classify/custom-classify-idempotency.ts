import { canonicalStringify } from '../common/canonical-json';
import { sha256Hex } from '../common/sha256';
import type { CustomLabel } from './custom-classify.schema';
import type { CustomClassifyRunParams } from './custom-classify-run.types';

/**
 * 確認標籤集的 canonical hash（T12.8，FR-34/AC-34.2）。以 label 排序後 canonical 序列化 → **reorder-invariant**
 * （同一組標籤不論順序 → 同 hash）；涵蓋 label + description（description 改動亦影響分類指引 → 應重跑，故一併入 hash）。
 */
export function computeLabelsHash(labels: CustomLabel[]): string {
  const sorted = [...labels].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return sha256Hex(canonicalStringify(sorted));
}

/**
 * 計算自訂分類階段二 job 的 idempotency key（T12.8，FR-34/AC-34.2；仿 computeJourneyIdempotencyKey）。
 *
 * 語意相同 → 同一 key（同分類定義 + 同 snapshot + 同版本/標籤參數 → 命中既有 run、不重跑）：
 * - `classificationId`：綁定特定分類定義（`idempotency_key` 全域 unique；GET 以 `classificationId` 查 run）。
 * - `snapshotChecksum`：綁定該分類的不可變 snapshot（內容變 → 不同 key）。
 * - `params`：`{ schemaVersion, deployment, labelsHash }` 以**鍵序無關的 canonical JSON**（共用 S9 單點）序列化。
 *   bump `CUSTOM_CLASSIFY_SCHEMA_VERSION` / 換部署 / 改確認標籤（`labelsHash`）→ 不同 key → 允許新 run。回傳 sha256 hex。
 */
export function computeCustomClassifyIdempotencyKey(
  classificationId: string,
  snapshotChecksum: string,
  params: CustomClassifyRunParams,
): string {
  return sha256Hex(canonicalStringify({ classificationId, checksum: snapshotChecksum, params }));
}
