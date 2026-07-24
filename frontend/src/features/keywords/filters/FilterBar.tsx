import { useId, useRef, useState, type ReactElement } from 'react';
import { useOutsideClick } from '../../../hooks/useOutsideClick';
import {
  applyChip,
  clearField,
  isValidRange,
  specToChips,
  type FilterFieldKey,
  type FilterSpec,
} from '../../../lib/filterSpec';
import { FILTER_FIELDS, ROADMAP_FILTER_FIELDS, type FilterFieldDef } from './filterFields';
import { buildChip, parseNum, popoverSeed, toggleValue, valueLabel } from './filterLabels';

/**
 * Filter chips bar (T2.5, FR-6, Design §6 C4). A controlled component: it renders
 * one chip per `allowedFilters` field and drives all state through the single
 * `lib/filterSpec` codec — apply / clear a chip → a new `FilterSpec` via
 * `onChange` (the router container then mirrors it into the URL). Nothing here
 * re-implements the chips↔spec mapping; the popover only edits inputs and hands a
 * typed `Chip` to `applyChip`. Tokens only — no hardcoded hex.
 */

export interface FilterBarProps {
  readonly allowedFilters: readonly FilterFieldKey[];
  readonly value: FilterSpec;
  readonly onChange: (next: FilterSpec) => void;
}

// v4 `.filter-chip` (design-context/results-v4-spec.md): 36px pill, 7/12 padding, 999 radius,
// 12.5px/600, the ⚑ bars icon + a brand `filter-value`. Active = brand-tinted (bg .08 / border .34).
const CHIP_BTN =
  'inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-full border px-3 py-[7px] text-[12.5px] font-semibold transition';
const CHIP_INACTIVE =
  'border-white/10 bg-white/[0.035] text-white/[0.66] hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white/90';
const CHIP_ACTIVE = 'border-brand/[0.34] bg-brand/[0.08] text-white/90';
// v4 `.filter-popover`: 280px, 14 radius, translucent bg-body + 14px blur, deep shadow.
const POPOVER =
  'absolute left-0 z-[70] mt-2 w-[280px] rounded-[14px] border border-white/10 bg-bg-body/[0.98] p-3 shadow-[0_18px_45px_rgba(0,0,0,0.45)] backdrop-blur-[14px]';
const INPUT =
  'w-full rounded-lg bg-bg-input px-2.5 py-1.5 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-brand';
// v4 popover actions: 套用 = `.primary-btn`, 清除 = `.sec-btn` (small).
const APPLY_BTN =
  'rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-bg-body enabled:hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40';
const CLEAR_BTN =
  'rounded-lg border border-white/20 px-2.5 py-1.5 text-xs font-semibold text-white/70 transition hover:border-white/40 hover:bg-white/5 hover:text-white';

/** The ⚑ bars icon that prefixes every v4 filter chip (prototype `FILTER_ICONS.bars`). */
function FilterIcon(): ReactElement {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}

export function FilterBar({ allowedFilters, value, onChange }: FilterBarProps): ReactElement {
  return (
    <div role="group" aria-label="篩選" className="flex flex-wrap items-center gap-2">
      {allowedFilters.map((field) =>
        ROADMAP_FILTER_FIELDS.has(field) ? (
          <RoadmapChip key={field} field={field} />
        ) : (
          <FilterChip key={field} field={field} spec={value} onChange={onChange} />
        ),
      )}
      <button type="button" onClick={() => onChange({})} className={CLEAR_BTN}>
        清除全部
      </button>
    </div>
  );
}

/**
 * A disabled display chip (M7-R22 [6]): shown for v4 fidelity but with no backend filter support
 * yet ({@link ROADMAP_FILTER_FIELDS}), so it can't masquerade as a live filter that silently does
 * nothing (FR-6). A「即將推出」hint + tooltip communicate the roadmap; re-enabled when #777 lands.
 */
function RoadmapChip({ field }: { field: FilterFieldKey }): ReactElement {
  const def = FILTER_FIELDS[field];
  return (
    <div className="relative">
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="篩選功能開發中，即將推出"
        className={`${CHIP_BTN} ${CHIP_INACTIVE} cursor-not-allowed opacity-50`}
      >
        <FilterIcon />
        <span>{def.label}</span>
        <span className="text-[11px] font-normal text-white/40">即將推出</span>
      </button>
    </div>
  );
}

function FilterChip({
  field,
  spec,
  onChange,
}: {
  field: FilterFieldKey;
  spec: FilterSpec;
  onChange: (next: FilterSpec) => void;
}): ReactElement {
  const def = FILTER_FIELDS[field];
  const current = specToChips(spec).find((c) => c.field === field);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Click away closes the popover (M7-R9): a pointer-down outside it (and outside its own
  // trigger) dismisses. Pressing another chip's trigger is "outside" here, so only one
  // popover stays open at a time.
  const popoverRef = useOutsideClick<HTMLDivElement>(open, () => setOpen(false), triggerRef);

  // Esc dismisses the popover and returns focus to its chip trigger (NFR-7 / TC-24).
  function closeToTrigger(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  const [include, setInclude] = useState('');
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [topic, setTopic] = useState('');
  const [keyword, setKeyword] = useState('');

  function toggle(): void {
    if (open) {
      setOpen(false);
      return;
    }
    // Seed the popover inputs from the current spec so an open chip reflects state
    // (the single reverse of buildChip; menukw seeds to '' — it never round-trips).
    const seed = popoverSeed(current);
    setInclude(seed.include);
    setMinText(seed.minText);
    setMaxText(seed.maxText);
    setSelected(seed.selected);
    setTopic(seed.topic);
    setKeyword(seed.keyword);
    setOpen(true);
  }

  const rangeValid = def.type !== 'range' || isValidRange(parseNum(minText), parseNum(maxText));

  function handleApply(): void {
    onChange(
      applyChip(
        spec,
        buildChip(field, def, {
          include,
          minText,
          maxText,
          selected,
          topic,
          keyword,
          current,
        }),
      ),
    );
    setOpen(false);
  }

  function handleClear(): void {
    onChange(clearField(spec, field));
    setOpen(false);
  }

  const active = current !== undefined;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        className={`${CHIP_BTN} ${active ? CHIP_ACTIVE : CHIP_INACTIVE}`}
      >
        <FilterIcon />
        <span>{def.label}</span>
        <span className="max-w-[150px] truncate text-brand">{valueLabel(current, def)}</span>
      </button>

      {open ? (
        <div
          ref={popoverRef}
          role="group"
          aria-label={`${def.label} 篩選`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              closeToTrigger();
            }
          }}
          className={POPOVER}
        >
          <ChipBody
            def={def}
            include={include}
            minText={minText}
            maxText={maxText}
            selected={selected}
            topic={topic}
            keyword={keyword}
            rangeValid={rangeValid}
            onInclude={setInclude}
            onMin={setMinText}
            onMax={setMaxText}
            onToggleOption={(v) => setSelected((prev) => toggleValue(prev, v))}
            onTopic={setTopic}
            onKeyword={setKeyword}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={handleClear} className={CLEAR_BTN}>
              清除
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!rangeValid}
              className={APPLY_BTN}
            >
              套用
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface ChipBodyProps {
  readonly def: FilterFieldDef;
  readonly include: string;
  readonly minText: string;
  readonly maxText: string;
  readonly selected: readonly string[];
  readonly topic: string;
  readonly keyword: string;
  readonly rangeValid: boolean;
  readonly onInclude: (v: string) => void;
  readonly onMin: (v: string) => void;
  readonly onMax: (v: string) => void;
  readonly onToggleOption: (v: string) => void;
  readonly onTopic: (v: string) => void;
  readonly onKeyword: (v: string) => void;
}

function ChipBody(props: ChipBodyProps): ReactElement {
  const { def } = props;
  const errorId = useId();
  if (def.type === 'inex') {
    // Include-only at M2: the backend `q` has no NOT capability, so an exclude
    // input would be a decorative no-op (deferred to M2+, backend #416, FR-6).
    return (
      <input
        aria-label="包含"
        value={props.include}
        onChange={(e) => props.onInclude(e.target.value)}
        placeholder={def.includePlaceholder}
        className={INPUT}
      />
    );
  }
  if (def.type === 'range') {
    // When min>max both inputs are flagged aria-invalid and point at the alert, so
    // AT announces the field-level error (NFR-7 / TC-24).
    const invalid = !props.rangeValid;
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            aria-label="最低"
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            value={props.minText}
            onChange={(e) => props.onMin(e.target.value)}
            placeholder="最低"
            className={INPUT}
          />
          <input
            type="number"
            aria-label="最高"
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            value={props.maxText}
            onChange={(e) => props.onMax(e.target.value)}
            placeholder="最高"
            className={INPUT}
          />
        </div>
        {invalid ? (
          <p id={errorId} role="alert" className="text-xs text-trend-negative">
            最低不得大於最高
          </p>
        ) : null}
      </div>
    );
  }
  if (def.type === 'options') {
    return (
      <div className="flex flex-col gap-1.5">
        {def.options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={props.selected.includes(opt.value)}
              onChange={() => props.onToggleOption(opt.value)}
              className="accent-brand"
            />
            {opt.label}
          </label>
        ))}
      </div>
    );
  }
  // menukw — 主題 select + 關鍵字 input (view-router dimension; does not feed the base FilterSpec).
  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label="主題"
        value={props.topic}
        onChange={(e) => props.onTopic(e.target.value)}
        className={INPUT}
      >
        <option value="">全部主題</option>
        {/* 主題 options are empty at M2 (no topics yet); the topic view-router
            dimension + its option rendering are wired at M3 (T3.x). */}
      </select>
      <input
        aria-label="關鍵字"
        value={props.keyword}
        onChange={(e) => props.onKeyword(e.target.value)}
        placeholder="關鍵字"
        className={INPUT}
      />
    </div>
  );
}
