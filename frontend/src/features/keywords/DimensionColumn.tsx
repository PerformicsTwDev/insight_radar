import type { ReactElement } from 'react';
import { EM_DASH } from '../../lib/keywordsTable';

/**
 * On-demand **dimension column** (M7-R2b/c, FR-18) — the reusable 搜尋意圖主題 / 購買歷程主題
 * cell + header. The per-keyword value comes from that dimension's own analysis (topics job /
 * journey job), client-joined by `normalizedText` (D2); a column's 「generate all」 runs its
 * dimension analysis but — per the **C13 gate-decoupling 拍板** — does NOT unlock the left
 * dimension view. THIN + presentational: driven entirely by props; the data / generate wiring
 * lives in the container (useTopics / useJourney).
 */

/**
 * Pill accent colour SSOT (mirrors @theme: `topic` = `--color-brand` green,
 * `journey` = `--color-intent-informational` blue). JS-authoritative like {@link intentMap};
 * applied inline (a value lookup can't be JIT-safelisted into a static Tailwind class).
 */
export const DIMENSION_ACCENT_COLOR = {
  topic: '#52b788', // --color-brand
  journey: '#5bc0eb', // --color-intent-informational
} as const;

export type DimensionAccent = keyof typeof DIMENSION_ACCENT_COLOR;

/** Per-cell state: not-generated (masked), job running (generating), a value (pill), or unclassified (—). */
export type DimensionCellState =
  | { readonly kind: 'masked' }
  | { readonly kind: 'generating' }
  | { readonly kind: 'value'; readonly label: string }
  | { readonly kind: 'empty' };

/** Header phase: generated (plain label), generatable (✦ trigger), or running (progress marker). */
export type DimensionHeaderPhase = 'ready' | 'generatable' | 'generating';

/** 8-digit-hex alpha suffixes for the pill fill / ring off the accent's 6-digit hex (≈12% / ≈33%). */
const PILL_FILL_ALPHA = '1f';
const PILL_RING_ALPHA = '55';

export function DimensionCell({
  state,
  accent,
}: {
  state: DimensionCellState;
  accent: DimensionAccent;
}): ReactElement {
  if (state.kind === 'value') {
    // Colour from the accent SSOT (topic green / journey blue), applied inline like the intent chips.
    const color = DIMENSION_ACCENT_COLOR[accent];
    return (
      <span
        className="inline-block max-w-full truncate rounded-full px-2.5 py-0.5 text-xs font-medium ring-1"
        style={{
          color,
          backgroundColor: `${color}${PILL_FILL_ALPHA}`,
          '--tw-ring-color': `${color}${PILL_RING_ALPHA}`,
        }}
        data-accent={accent}
      >
        {state.label}
      </span>
    );
  }
  if (state.kind === 'empty') {
    // Generated, but this keyword is unclassified (noise) — — (never a fabricated topic, C12).
    return <span className="text-white/40">{EM_DASH}</span>;
  }
  // masked / generating → an accessible shimmer bar (no value leaks before generation; the
  // running variant pulses). The label distinguishes the two for screen readers.
  const generating = state.kind === 'generating';
  return (
    <span
      role="img"
      aria-label={generating ? '生成中' : '尚未生成'}
      className={`inline-block h-3 w-14 rounded bg-white/10${generating ? ' animate-pulse' : ''}`}
    />
  );
}

export function DimensionHeader({
  label,
  phase,
  onGenerate,
}: {
  label: string;
  phase: DimensionHeaderPhase;
  onGenerate: () => void;
}): ReactElement {
  if (phase === 'ready') {
    return <span>{label}</span>;
  }
  if (phase === 'generating') {
    return (
      <span className="flex items-center gap-1 text-white/60">
        {label}
        <span
          role="status"
          aria-label="生成中"
          className="h-2 w-2 animate-pulse rounded-full bg-brand"
        />
      </span>
    );
  }
  // generatable → the 「generate all」 ✦ trigger (FR-18 header batch); generating this column runs
  // its own dimension analysis but does NOT unlock the left dimension view (C13 — enforced upstream).
  return (
    <button
      type="button"
      onClick={onGenerate}
      title={`點擊為表格中所有搜尋詞生成${label}`}
      className="flex items-center gap-1 text-brand hover:text-brand-dark"
    >
      {label}
      <span aria-hidden="true">✦</span>
    </button>
  );
}
