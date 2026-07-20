import { useState, type KeyboardEvent, type ReactElement } from 'react';

/**
 * Reusable label chip-box (T5.1, FR-16; the 自訂分類 HITL modal's tag editor). Renders
 * one removable pill per label plus an inline input that emits `onAdd` on Enter.
 * **Presentational only**: de-dup / accumulate live in the host so both the AI-append
 * and the manual-add paths share the ONE dedupe point (C7). Tokens only — no
 * hardcoded hex.
 */

export interface ChipBoxProps {
  readonly labels: readonly string[];
  readonly onAdd: (label: string) => void;
  readonly onRemove: (label: string) => void;
  readonly inputAriaLabel?: string;
  readonly placeholder?: string;
}

const BOX =
  'flex flex-wrap items-center gap-2 rounded-lg bg-bg-input px-2.5 py-2 ring-1 ring-white/10 focus-within:ring-brand';
const CHIP =
  'inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-white ring-1 ring-brand/40';
const CHIP_X = 'leading-none text-brand/70 hover:text-brand';
const INPUT =
  'min-w-32 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30';

export function ChipBox({
  labels,
  onAdd,
  onRemove,
  inputAriaLabel = '新增標籤',
  placeholder = '新增標籤…',
}: ChipBoxProps): ReactElement {
  const [draft, setDraft] = useState('');

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = draft.trim();
    if (value.length === 0) return; // empty / whitespace-only → no-op
    onAdd(value);
    setDraft('');
  }

  return (
    <div className={BOX}>
      {labels.map((label) => (
        <span key={label} className={CHIP}>
          {label}
          <button
            type="button"
            aria-label={`移除 ${label}`}
            onClick={() => onRemove(label)}
            className={CHIP_X}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        aria-label={inputAriaLabel}
        value={draft}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        className={INPUT}
      />
    </div>
  );
}
