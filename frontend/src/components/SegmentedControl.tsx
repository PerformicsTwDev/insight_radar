import { useRef, type KeyboardEvent, type ReactElement } from 'react';

/**
 * Accessible segmented control (T3.4) — a small reusable 表格|圖表-style toggle
 * (`seg-ctrl` in the mockup). Rendered as an ARIA `tablist` following the WAI-ARIA
 * tabs keyboard pattern (NFR-7 / TC-24): a roving tabindex (only the selected tab is
 * in the tab order) with ArrowLeft/ArrowRight/Home/End moving selection and focus
 * together (automatic activation). The parent owns the selected value (controlled)
 * and receives the new value via `onChange`. Tokens only — no scattered hex.
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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Move selection + focus to `index` (wrapping around the ends). Automatic
  // activation: arrowing selects, matching the click behaviour.
  function moveTo(index: number): void {
    const next = (index + options.length) % options.length;
    onChange(options[next].value);
    tabRefs.current[next]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveTo(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveTo(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(options.length - 1);
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex gap-0.5 rounded-lg bg-bg-input p-0.5 ring-1 ring-white/10"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
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
