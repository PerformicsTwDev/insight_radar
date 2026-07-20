import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';
import type { AiSearchRunParams } from '../ai-search/ai-search-run.types';

/**
 * `ai-search` queue 的 job payload（T14.6，FR-41/AC-41.x）。producer（`POST /ai-search-analyses`）建 AiSearchRun 後
 * enqueue（jobId=runId）；processor 據此跑 SerpAPI pull（reserved）+ 收 extension push（經 `/captures`）→ 合流落
 * `ai_search_captures`（以 jobId 關聯）。keywords/channels/ownerId 由當次請求 DTO 帶入（reset 重入列時重建）。
 */
export interface AiSearchJobPayload {
  runId: string;
  ownerId: string | null;
  keywords: string[];
  channels: CaptureChannel[];
  brandProfileId: string | null;
  params: AiSearchRunParams;
}

/** processor 回傳（BullMQ job return value）。partial＝某渠道/來源缺（INV-6 gating），非整批失敗。 */
export interface AiSearchJobResult {
  status: 'completed' | 'partial';
  captureCount: number;
}
