import { ConflictException } from '@nestjs/common';

/**
 * 讀取層 not-ready 提示（T6.3，FR-6 · AC-6.4）：分析存在但**尚無不可變 snapshot**（`queued`/`running`，或
 * 尚未持久化的 `partial`/`failed`）。回 **409 Conflict**（資源目前狀態不允許讀結果）＋ `code:'NOT_READY'`＋帶
 * job `status`，讓前端改輪詢 `GET /keyword-analyses/:id`——**不回不完整誤導資料**。`HttpExceptionFilter` 會取用
 * `code`/`message` 組成統一 `ErrorResponse`。
 */
export class NotReadyException extends ConflictException {
  constructor(status: string) {
    super({
      code: 'NOT_READY',
      message: `Analysis results are not ready (status: ${status}); poll GET /keyword-analyses/:id for progress`,
    });
  }
}
