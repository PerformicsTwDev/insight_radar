import type { ReactElement } from 'react';

/**
 * Shared confirm gate between a destructive trigger and its mutation (T5.5 → T5.6).
 * Extracted from `TrackingListsView` so the tracking detail dashboard reuses the exact
 * same accessible dialog (role="dialog" + aria-modal, backdrop-dismiss, a danger confirm
 * + a secondary cancel). The parent owns the open/close state and the guarded confirm
 * handler; this is a pure presentational shell. Tokens only — no scattered hex.
 */
export interface ConfirmDialogProps {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

const SEC_BTN =
  'rounded-lg px-3 py-1.5 text-sm text-white/70 ring-1 ring-white/10 hover:bg-white/5';
const DANGER_BTN =
  'rounded-lg bg-trend-negative/90 px-4 py-2 text-sm font-semibold text-white hover:bg-trend-negative';

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): ReactElement {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center"
    >
      <div
        onClick={onCancel}
        aria-hidden="true"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />
      <div className="relative w-[92%] max-w-sm rounded-2xl bg-bg-card p-6 shadow-2xl ring-1 ring-white/10">
        <h3 className="text-base font-bold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/70">{body}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className={SEC_BTN}>
            取消
          </button>
          <button type="button" onClick={onConfirm} className={DANGER_BTN}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
