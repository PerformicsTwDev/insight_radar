import { registerAs } from '@nestjs/config';

import { parseCsvList } from './parse-csv-list';

/**
 * Capture ingestion 設定（M13，FR-36 / NFR-17；Design §14/§18.2）。值已由 env.validation Joi schema
 * 驗證/補預設，故直接讀取。
 *
 * T13.2 需 `batchMax`（單批 `items` 上限，AC-36.5 請求形狀守門；超 → 413）＋ `bodyLimitMb`（capture 端點
 * **獨立** body 上限，AC-36.5；因 AI 回答／貼文集可能大，須高於全域 `BODY_LIMIT_MB`——故 `POST /captures`
 * 掛專屬、較大的 body parser）。`CAPTURE_ACCEPTED_SCHEMA_VERSIONS`（schemaVersion allowlist，S15）＋
 * `CAPTURE_PAT_ENABLED`（extension direct-push PAT，v2 預留、本期不啟用，NG14）於後續 Task（T13.3/T13.8）補。
 */
export interface IngestConfig {
  /**
   * `POST /captures` 單批 `items` 上限（AC-36.5 請求形狀守門；超 → 413）。先於任何 contentHash 計算／DB 展開
   * 即拒絕——防單一已認證請求挾超大批次放大成應用層 DoS（比照 `TRACKING_MAX_ITEMS_PER_REQUEST`，NFR-17）。
   */
  batchMax: number;
  /**
   * `POST /captures` **獨立** body 上限（MB，AC-36.5）。AI 回答／貼文集可能大，故高於全域 `BODY_LIMIT_MB`；
   * 端點掛專屬 body parser（於全域 parser 之前、僅此路由），逾此 → 413。與全域 hardening（T9.8）機制一致。
   */
  bodyLimitMb: number;
  /**
   * `POST /captures` 的 `schemaVersion` **allowlist**（S15 / AC-36.3；`CAPTURE_ACCEPTED_SCHEMA_VERSIONS`
   * 逗號分隔）。extension 契約現況無 schema versioning——本端點以此欄補上缺口：缺 / 值不在此清單 → `400`
   * （service 層斷言，**不**靜默套預設、不猜形狀）。Joi 保證非空，故此陣列至少一員。
   */
  acceptedSchemaVersions: string[];
  /**
   * extension bridge **能力協商基準**（S21 / NFR-21 / AC-51.4；`EXTENSION_BRIDGE_REQUIRED_FEATURES`，逗號分隔）——
   * 我方期望 extension `EXTERNAL_PONG.features[]` 應提供的渠道清單。前端轉發鏈以此對照 extension 實際回報：**未回報
   * 的渠道 → not-available（gating、不硬崩、不編造，見 `captures/capability-negotiation`）**。預設含現 research-confirmed
   * 3 渠道（`threadsSearch/googleSerp/chatGpt`）+ 期望擴充（AI 四渠道 + 社群多平台 + readability，extension 端外部
   * 協調項 T13.6）——擴充落地前，擴充渠道於 runtime 協商標 not-available。Joi 保證非空，故此陣列至少一員。
   */
  bridgeRequiredFeatures: string[];
}

export const ingestConfig = registerAs('ingest', (): IngestConfig => ({
  batchMax: Number(process.env.INGEST_BATCH_MAX),
  bodyLimitMb: Number(process.env.INGEST_BODY_LIMIT_MB),
  // 逗號分隔 → 去空白、濾空（共用 parseCsvList，M13-R6 [14]）。
  acceptedSchemaVersions: parseCsvList(process.env.CAPTURE_ACCEPTED_SCHEMA_VERSIONS),
  bridgeRequiredFeatures: parseCsvList(process.env.EXTENSION_BRIDGE_REQUIRED_FEATURES),
}));
