import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  deserializeFiltersFromUrl,
  serializeFiltersToUrl,
  type FilterFieldKey,
  type FilterSpec,
} from '../../../lib/filterSpec';
import { DEFAULT_ALLOWED_FILTERS } from './filterFields';
import { FilterBar } from './FilterBar';

/**
 * TC-17 (FR-6, Design §6 C4): the filter chips popover applies / clears chips and
 * the resulting FilterSpec AND its URL projection both update from the same
 * action (the single codec drives both). `allowedFilters` gates which chips are
 * offered; min>max is blocked client-side; an empty term is omitted; clearing
 * empties the spec and the URL.
 */

// A stateful host: the URL param is exactly `serializeFiltersToUrl(spec)` — the
// same value the router container writes — so asserting it proves URL sync.
function Harness({ allowedFilters }: { allowedFilters?: readonly FilterFieldKey[] }) {
  const [spec, setSpec] = useState<FilterSpec>({});
  return (
    <>
      <FilterBar
        allowedFilters={allowedFilters ?? DEFAULT_ALLOWED_FILTERS}
        value={spec}
        onChange={setSpec}
      />
      <output data-testid="spec">{JSON.stringify(spec)}</output>
      <output data-testid="url">{serializeFiltersToUrl(spec)}</output>
    </>
  );
}

const readSpec = (): FilterSpec =>
  JSON.parse(screen.getByTestId('spec').textContent ?? '{}') as FilterSpec;
const readUrl = (): string => screen.getByTestId('url').textContent ?? '';

/** Open a chip's popover by clicking its toggle, then return the popover scope. */
function openChip(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
  return within(screen.getByRole('group', { name: `${label} 篩選` }));
}

describe('TC-17 · FilterBar (chips popover → FilterSpec + URL)', () => {
  it('offers only the allowed filters as chips', () => {
    render(<Harness />);
    for (const label of ['搜尋詞', '意圖類別', '競爭度', '搜尋量', 'CPC']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
    // competitionIndex + topic dimensions are not offered on the base view.
    expect(screen.queryByRole('button', { name: /競爭度指數/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /意圖主題/ })).not.toBeInTheDocument();
  });

  it('renders only the single explicitly-allowed filter', () => {
    render(<Harness allowedFilters={['keyword']} />);
    expect(screen.getByRole('button', { name: /搜尋詞/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /意圖類別/ })).not.toBeInTheDocument();
  });

  it('applies an inex include term → q in both the spec and the URL', () => {
    render(<Harness />);
    const pop = openChip('搜尋詞');
    fireEvent.change(pop.getByLabelText('包含'), { target: { value: '吸塵器' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    expect(readSpec()).toEqual({ q: '吸塵器' });
    expect(readUrl()).not.toBe('');
    expect(deserializeFiltersFromUrl(readUrl())).toEqual({ q: '吸塵器' });
  });

  it('applies a numeric range → volumeMin/volumeMax in the spec and URL', () => {
    render(<Harness />);
    const pop = openChip('搜尋量');
    fireEvent.change(pop.getByLabelText('最低'), { target: { value: '100' } });
    fireEvent.change(pop.getByLabelText('最高'), { target: { value: '500' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    expect(readSpec()).toEqual({ volumeMin: 100, volumeMax: 500 });
    expect(deserializeFiltersFromUrl(readUrl())).toEqual({ volumeMin: 100, volumeMax: 500 });
  });

  it('blocks a min>max range (inline error + disabled 套用; spec untouched)', () => {
    render(<Harness />);
    const pop = openChip('搜尋量');
    fireEvent.change(pop.getByLabelText('最低'), { target: { value: '500' } });
    fireEvent.change(pop.getByLabelText('最高'), { target: { value: '100' } });

    expect(pop.getByRole('alert')).toHaveTextContent(/最低.*最高|不得大於/);
    expect(pop.getByRole('button', { name: '套用' })).toBeDisabled();
    expect(readSpec()).toEqual({});
  });

  it('applies multi-select options as an OR set (intent)', () => {
    render(<Harness />);
    const pop = openChip('意圖類別');
    fireEvent.click(pop.getByRole('checkbox', { name: '資訊型' }));
    fireEvent.click(pop.getByRole('checkbox', { name: '商業型' }));
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    expect(readSpec()).toEqual({ intent: ['informational', 'commercial'] });
  });

  it('combines two filters as AND and keeps the URL in sync', () => {
    render(<Harness />);
    let pop = openChip('搜尋詞');
    fireEvent.change(pop.getByLabelText('包含'), { target: { value: 'shoe' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    pop = openChip('搜尋量');
    fireEvent.change(pop.getByLabelText('最低'), { target: { value: '100' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    expect(readSpec()).toEqual({ q: 'shoe', volumeMin: 100 });
    expect(deserializeFiltersFromUrl(readUrl())).toEqual({ q: 'shoe', volumeMin: 100 });
  });

  it('clears a single chip, leaving the other filters intact', () => {
    render(<Harness />);
    let pop = openChip('搜尋詞');
    fireEvent.change(pop.getByLabelText('包含'), { target: { value: 'shoe' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));
    pop = openChip('搜尋量');
    fireEvent.change(pop.getByLabelText('最低'), { target: { value: '100' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    pop = openChip('搜尋詞');
    fireEvent.click(pop.getByRole('button', { name: '清除' }));

    expect(readSpec()).toEqual({ volumeMin: 100 });
  });

  it('clears everything with 清除全部 → empty spec and empty URL', () => {
    render(<Harness />);
    let pop = openChip('搜尋詞');
    fireEvent.change(pop.getByLabelText('包含'), { target: { value: 'shoe' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));
    pop = openChip('搜尋量');
    fireEvent.change(pop.getByLabelText('最低'), { target: { value: '100' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));
    expect(readSpec()).not.toEqual({});

    fireEvent.click(screen.getByRole('button', { name: '清除全部' }));
    expect(readSpec()).toEqual({});
    expect(readUrl()).toBe('');
  });

  it('omits an empty include term (applying a blank keyword clears q)', () => {
    render(<Harness />);
    let pop = openChip('搜尋詞');
    fireEvent.change(pop.getByLabelText('包含'), { target: { value: 'shoe' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));
    expect(readSpec()).toEqual({ q: 'shoe' });

    pop = openChip('搜尋詞');
    fireEvent.change(pop.getByLabelText('包含'), { target: { value: '  ' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));
    expect(readSpec()).toEqual({});
  });

  it('offers a menukw chip but its selection does not alter the base FilterSpec (documented gap)', () => {
    render(<Harness allowedFilters={['intentTopic']} />);
    const pop = openChip('意圖主題');
    fireEvent.change(pop.getByLabelText('主題'), { target: { value: '' } });
    fireEvent.change(pop.getByLabelText('關鍵字'), { target: { value: '寵物' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));
    // topic dimension is not part of the flat /keywords FilterSpec → no-op on the spec.
    expect(readSpec()).toEqual({});
  });

  it('toggles the popover closed when the chip is clicked again', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /搜尋量/ }));
    expect(screen.getByRole('group', { name: '搜尋量 篩選' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /搜尋量/ }));
    expect(screen.queryByRole('group', { name: '搜尋量 篩選' })).not.toBeInTheDocument();
  });

  // TC-24 (NFR-7) — the popover is keyboard-dismissible and returns focus to its trigger.
  it('closes the open popover on Escape and refocuses the chip trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /搜尋量/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('group', { name: '搜尋量 篩選' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: '搜尋量 篩選' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('marks the range inputs aria-invalid when min > max', () => {
    render(<Harness />);
    const pop = openChip('搜尋量');
    fireEvent.change(pop.getByLabelText('最低'), { target: { value: '500' } });
    fireEvent.change(pop.getByLabelText('最高'), { target: { value: '100' } });
    expect(pop.getByLabelText('最低')).toHaveAttribute('aria-invalid', 'true');
    expect(pop.getByLabelText('最高')).toHaveAttribute('aria-invalid', 'true');
  });

  it('seeds the popover inputs from the current spec when re-opened', () => {
    render(<Harness />);
    let pop = openChip('搜尋詞');
    fireEvent.change(pop.getByLabelText('包含'), { target: { value: 'shoe' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    pop = openChip('搜尋詞');
    expect(pop.getByLabelText<HTMLInputElement>('包含').value).toBe('shoe');
  });

  it('seeds a range popover and shows a — bounded label for an open-upper range', () => {
    render(<Harness />);
    let pop = openChip('搜尋量');
    fireEvent.change(pop.getByLabelText('最高'), { target: { value: '500' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    // max-only range → the chip shows a ≤ label; reopening seeds the 最高 input.
    expect(screen.getByRole('button', { name: /≤500/ })).toBeInTheDocument();
    pop = openChip('搜尋量');
    expect(pop.getByLabelText<HTMLInputElement>('最高').value).toBe('500');
  });

  it('formats a money range chip label as NT$ (CPC)', () => {
    render(<Harness />);
    const pop = openChip('CPC');
    fireEvent.change(pop.getByLabelText('最低'), { target: { value: '2' } });
    fireEvent.change(pop.getByLabelText('最高'), { target: { value: '8' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));
    expect(screen.getByRole('button', { name: /NT\$2–NT\$8/ })).toBeInTheDocument();
  });

  it('shows the joined zh option labels on an applied options chip', () => {
    render(<Harness />);
    const pop = openChip('意圖類別');
    fireEvent.click(pop.getByRole('checkbox', { name: '資訊型' }));
    fireEvent.click(pop.getByRole('checkbox', { name: '交易型' }));
    fireEvent.click(pop.getByRole('button', { name: '套用' }));
    expect(screen.getByRole('button', { name: /資訊型、交易型/ })).toBeInTheDocument();
  });

  it('renders an include-only inex popover (no exclude input — backend has no NOT)', () => {
    render(<Harness />);
    const pop = openChip('搜尋詞');
    expect(pop.getByLabelText('包含')).toBeInTheDocument();
    expect(pop.queryByLabelText('不包含')).not.toBeInTheDocument();
  });

  it('seeds a reopened range popover from a min-only bound', () => {
    render(<Harness />);
    let pop = openChip('搜尋量');
    fireEvent.change(pop.getByLabelText('最低'), { target: { value: '100' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    // min-only range → the chip shows a + label; reopening seeds 最低 and leaves 最高 blank.
    expect(screen.getByRole('button', { name: /100\+/ })).toBeInTheDocument();
    pop = openChip('搜尋量');
    expect(pop.getByLabelText<HTMLInputElement>('最低').value).toBe('100');
    expect(pop.getByLabelText<HTMLInputElement>('最高').value).toBe('');
  });

  it('seeds a reopened range popover from both bounds', () => {
    render(<Harness />);
    let pop = openChip('搜尋量');
    fireEvent.change(pop.getByLabelText('最低'), { target: { value: '100' } });
    fireEvent.change(pop.getByLabelText('最高'), { target: { value: '500' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    pop = openChip('搜尋量');
    expect(pop.getByLabelText<HTMLInputElement>('最低').value).toBe('100');
    expect(pop.getByLabelText<HTMLInputElement>('最高').value).toBe('500');
  });

  it('unchecks an already-selected option (toggle off)', () => {
    render(<Harness />);
    let pop = openChip('意圖類別');
    fireEvent.click(pop.getByRole('checkbox', { name: '資訊型' }));
    fireEvent.click(pop.getByRole('checkbox', { name: '商業型' }));
    fireEvent.click(pop.getByRole('button', { name: '套用' }));
    expect(readSpec()).toEqual({ intent: ['informational', 'commercial'] });

    pop = openChip('意圖類別');
    fireEvent.click(pop.getByRole('checkbox', { name: '資訊型' })); // toggle off
    fireEvent.click(pop.getByRole('button', { name: '套用' }));
    expect(readSpec()).toEqual({ intent: ['commercial'] });
  });
});
