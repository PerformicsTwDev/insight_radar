import type { ReactElement } from 'react';

/**
 * Accessible segmented control (T3.4) — red stub (not yet implemented).
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

export function SegmentedControl<T extends string>(_props: SegmentedControlProps<T>): ReactElement {
  return <div />;
}
