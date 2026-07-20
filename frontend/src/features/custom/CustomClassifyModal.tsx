import type { ReactElement } from 'react';

/**
 * TODO(T5.1 GREEN): 自訂分類 HITL modal — 名稱 + 指令 → 生成分類架構 → 標籤 chips
 * (AI 累加 / 手動增刪) → 開始分析. Not-implemented shell for the RED commit — the
 * props are final so the tests compile; markup/behaviour land in GREEN.
 */

export interface CustomClassifyModalProps {
  readonly analysisId: string;
  readonly onClose: () => void;
  readonly onConfirm: (labels: readonly string[]) => void | Promise<void>;
}

export function CustomClassifyModal(_props: CustomClassifyModalProps): ReactElement {
  return <div />;
}
