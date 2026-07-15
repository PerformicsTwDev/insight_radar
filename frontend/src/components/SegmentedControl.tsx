import type { ReactElement } from 'react';

/**
 * Accessible segmented control (T3.4) — a small reusable 表格|圖表-style toggle
 * (`seg-ctrl` in the mockup). Rendered as an ARIA `tablist` of focusable `tab`
 * buttons carrying `aria-selected`; the parent owns the selected value (controlled)
 * and receives the clicked value via `onChange`. Tokens only — no scattered hex.
 */
export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly ariaLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>): ReactElement {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex gap-0.5 rounded-lg bg-bg-input p-0.5 ring-1 ring-white/10"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={
              selected
                ? 'rounded-md bg-bg-raised px-3.5 py-1 text-xs font-semibold text-white shadow'
                : 'rounded-md px-3.5 py-1 text-xs font-semibold text-white/50 hover:text-white/80'
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
