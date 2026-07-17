import type { CustomLabel } from './custom-classify.schema';

/** 建立自訂分類定義的請求（controller DTO 驗證後的乾淨型別；T12.7，FR-34）。 */
export interface CustomClassifyRequest {
  /** 使用者為此分類取的名稱（顯示用）。 */
  name: string;
  /** 分類指令＝要 LLM 依此**設計標籤**的維度（非可執行命令，S19 隔離）。 */
  instruction: string;
}

/** 自訂分類定義（階段一產物：一組待 HITL 確認的標籤；尚無逐字指派＝T12.8）。 */
export interface CustomClassification {
  id: string;
  name: string;
  instruction: string;
  /** LLM 產出、經去重＋截斷至 ≤ `CUSTOM_CLASSIFY_MAX_LABELS` 的標籤集。 */
  labels: CustomLabel[];
  createdAt: string;
}
