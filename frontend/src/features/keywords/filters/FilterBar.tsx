import { useState, type ReactElement } from 'react';
import {
  applyChip,
  clearField,
  isValidRange,
  specToChips,
  type FilterFieldKey,
  type FilterSpec,
} from '../../../lib/filterSpec';
import { FILTER_FIELDS, type FilterFieldDef } from './filterFields';
import { buildChip, parseNum, toggleValue, valueLabel } from './filterLabels';

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

const CHIP_BTN =
  'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition';
const POPOVER =
  'absolute left-0 z-30 mt-2 w-72 rounded-xl bg-bg-raised p-3 shadow-lg ring-1 ring-white/10';
const INPUT =
  'w-full rounded-lg bg-bg-input px-2.5 py-1.5 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-brand';
const APPLY_BTN =
  'rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-bg-body enabled:hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40';
const CLEAR_BTN =
  'rounded-lg px-2.5 py-1.5 text-xs text-white/70 ring-1 ring-white/10 hover:bg-white/5';

export function FilterBar({ allowedFilters, value, onChange }: FilterBarProps): ReactElement {
  return (
    <div role="group" aria-label="篩選" className="flex flex-wrap items-center gap-2">
      {allowedFilters.map((field) => (
        <FilterChip key={field} field={field} spec={value} onChange={onChange} />
      ))}
      <button type="button" onClick={() => onChange({})} className={CLEAR_BTN}>
        清除全部
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

  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
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
    // Seed the popover inputs from the current spec so an open chip reflects state.
    setInclude(current?.type === 'inex' ? (current.include ?? '') : '');
    setExclude(current?.type === 'inex' ? (current.exclude ?? '') : '');
    setMinText(current?.type === 'range' && current.min !== undefined ? String(current.min) : '');
    setMaxText(current?.type === 'range' && current.max !== undefined ? String(current.max) : '');
    setSelected(current?.type === 'options' ? current.values : []);
    setTopic(current?.type === 'menukw' ? (current.topic ?? '') : '');
    setKeyword(current?.type === 'menukw' ? (current.keyword ?? '') : '');
    setOpen(true);
  }

  const rangeValid = def.type !== 'range' || isValidRange(parseNum(minText), parseNum(maxText));

  function handleApply(): void {
    onChange(
      applyChip(
        spec,
        buildChip(field, def, {
          include,
          exclude,
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
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        className={`${CHIP_BTN} ${
          active
            ? 'bg-brand/10 text-white ring-brand/40'
            : 'bg-white/5 text-white/70 ring-white/10 hover:bg-white/10'
        }`}
      >
        <span>{def.label}</span>
        <span className={active ? 'text-brand' : 'text-white/40'}>{valueLabel(current, def)}</span>
      </button>

      {open ? (
        <div role="group" aria-label={`${def.label} 篩選`} className={POPOVER}>
          <ChipBody
            def={def}
            include={include}
            exclude={exclude}
            minText={minText}
            maxText={maxText}
            selected={selected}
            topic={topic}
            keyword={keyword}
            rangeValid={rangeValid}
            onInclude={setInclude}
            onExclude={setExclude}
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
  readonly exclude: string;
  readonly minText: string;
  readonly maxText: string;
  readonly selected: readonly string[];
  readonly topic: string;
  readonly keyword: string;
  readonly rangeValid: boolean;
  readonly onInclude: (v: string) => void;
  readonly onExclude: (v: string) => void;
  readonly onMin: (v: string) => void;
  readonly onMax: (v: string) => void;
  readonly onToggleOption: (v: string) => void;
  readonly onTopic: (v: string) => void;
  readonly onKeyword: (v: string) => void;
}

function ChipBody(props: ChipBodyProps): ReactElement {
  const { def } = props;
  if (def.type === 'inex') {
    return (
      <div className="flex flex-col gap-2">
        <input
          aria-label="包含"
          value={props.include}
          onChange={(e) => props.onInclude(e.target.value)}
          placeholder={def.includePlaceholder}
          className={INPUT}
        />
        <input
          aria-label="不包含"
          value={props.exclude}
          onChange={(e) => props.onExclude(e.target.value)}
          placeholder={def.excludePlaceholder}
          className={INPUT}
        />
      </div>
    );
  }
  if (def.type === 'range') {
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            aria-label="最低"
            value={props.minText}
            onChange={(e) => props.onMin(e.target.value)}
            placeholder="最低"
            className={INPUT}
          />
          <input
            type="number"
            aria-label="最高"
            value={props.maxText}
            onChange={(e) => props.onMax(e.target.value)}
            placeholder="最高"
            className={INPUT}
          />
        </div>
        {props.rangeValid ? null : (
          <p role="alert" className="text-xs text-trend-negative">
            最低不得大於最高
          </p>
        )}
      </div>
    );
  }
  if (def.type === 'options') {
    return (
      <div className="flex flex-col gap-1.5">
        {(def.options ?? []).map((opt) => (
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
