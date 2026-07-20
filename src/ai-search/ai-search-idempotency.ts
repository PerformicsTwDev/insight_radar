import { canonicalize } from '../common/canonical-json';
import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';
import { sha256Hex } from '../common/sha256';
import { normalizeText } from '../google-ads/normalize';
import type { AiSearchRunParams } from './ai-search-run.types';

/**
 * 計算 AI Search 抓取 job 的 idempotency key（T14.6，FR-41/AC-41.1；owner 分範圍，仿 computeIdempotencyKey）。
 *
 * 語意相同 → 同一 key（命中既有 run、不重跑）：
 * - `ownerScope`：**owner 分範圍**——session actor 傳 `ownerId`、x-api-key 機器 actor 傳 `null`（共享）。不同 session
 *   owner 位元相同請求得**不同** key（各建自己的 run，杜絕跨租戶回不可讀 jobId，同 AC-1.4/#358）；機器 `null` 間全域去重。
 * - `keywords`：以**共用 `normalizeText`**（去重/快取同一規則）正規化、去重、**排序成 canonical order**。
 * - `channels`：**排序**（順序無關；`[chatGpt,googleSearch]`=`[googleSearch,chatGpt]`）。
 * - `brandProfileId`：`null`（未帶）與具體 id 語意不同 → 納入。
 * - `params`：`{ schemaVersion }` 以 **key 排序後 canonical JSON** 序列化（bump → 新 run）。
 * 回傳 sha256 hex。
 */
export function computeAiSearchIdempotencyKey(
  keywords: string[],
  channels: CaptureChannel[],
  brandProfileId: string | null,
  params: AiSearchRunParams,
  ownerScope: string | null,
): string {
  const canonicalKeywords = [...new Set(keywords.map(normalizeText))].sort();
  const canonicalChannels = [...channels].sort();
  const canonical = JSON.stringify({
    owner: ownerScope,
    keywords: canonicalKeywords,
    channels: canonicalChannels,
    brandProfileId,
    params: canonicalize(params),
  });
  return sha256Hex(canonical);
}
