import { registerAs } from '@nestjs/config';

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
}

export const ingestConfig = registerAs('ingest', (): IngestConfig => ({
  batchMax: Number(process.env.INGEST_BATCH_MAX),
  bodyLimitMb: Number(process.env.INGEST_BODY_LIMIT_MB),
}));
