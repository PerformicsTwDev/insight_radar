import type { ReactElement } from 'react';

/**
 * TODO(T5.1 GREEN): reusable label chip-box (removable pill chips + an inline input).
 * Not-implemented shell for the RED commit — the signature is final so the tests
 * compile; markup/behaviour land in GREEN.
 */

export interface ChipBoxProps {
  readonly labels: readonly string[];
  readonly onAdd: (label: string) => void;
  readonly onRemove: (label: string) => void;
  readonly inputAriaLabel?: string;
  readonly placeholder?: string;
}

export function ChipBox(_props: ChipBoxProps): ReactElement {
  return <div />;
}
