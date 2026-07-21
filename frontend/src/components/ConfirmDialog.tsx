import type { ReactElement } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * Shared confirm gate between a destructive trigger and its mutation (T5.5 → T5.6).
 * Extracted from `TrackingListsView` so the tracking detail dashboard reuses the exact
 * same accessible dialog (role="dialog" + aria-modal, backdrop-dismiss, a danger confirm
 * + a secondary cancel). The parent owns the open/close state and the guarded confirm
 * handler; this is a pure presentational shell. Keyboard-accessible via the shared
 * {@link useFocusTrap} (Esc dismisses, focus trapped + restored — NFR-7 / TC-24).
 * Tokens only — no scattered hex.
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
// Solid danger surface (`--color-danger`): white text clears WCAG AA (5.4:1) where the
// lighter `trend-negative` indicator colour did not — that token stays for error text.
const DANGER_BTN =
  'rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger-hover';

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): ReactElement {
  const dialogRef = useFocusTrap<HTMLDivElement>(onCancel);
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
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
