import { ConflictException } from '@nestjs/common';

/**
 * View feature-gating（T6.8，FR-14 · AC-14.7）：view 依賴的 compute feature（如 `serp_questions` 需 `serp`、
 * `intent_topics` 需 `topics`）**尚未 ready** 時，`POST /query` 回 **409 Conflict** ＋ `code:'FEATURE_NOT_READY'`
 * ＋帶 feature 名與狀態——前端據 `GET /:id` 的 `features.<feature>.status` 顯示「先執行 X」，而非回誤導空表。
 */
export class FeatureNotReadyException extends ConflictException {
  constructor(feature: string, status: string) {
    super({
      code: 'FEATURE_NOT_READY',
      message: `This view requires feature '${feature}' which is not ready (status: ${status}); generate it first (see features on GET /keyword-analyses/:id)`,
    });
  }
}
