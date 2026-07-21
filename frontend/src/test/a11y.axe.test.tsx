import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { axe } from './axe';
import { SegmentedControl } from '../components/SegmentedControl';
import { ChipBox } from '../components/ChipBox';
import { FeatureGate } from '../components/FeatureGate';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews';
import { FilterBar } from '../features/keywords/filters/FilterBar';
import { DEFAULT_ALLOWED_FILTERS } from '../features/keywords/filters/filterFields';
import { KeywordsTable } from '../features/keywords/KeywordsTable';
import { BulkSelectBar } from '../features/tracking/BulkSelectBar';
import { useSelectionStore } from '../stores/selectionStore';
import type { KeywordRow } from '../api/keywords';

/**
 * TC-24 (NFR-7) — the axe gate. Runs the shared WCAG-scoped axe runner (`./axe`)
 * over the key interactive components/views and asserts zero violations. This is the
 * regression floor that keeps future markup accessible; the dialogs
 * (`ConfirmDialog`, `CustomClassifyModal`) carry their own axe assertions alongside
 * their keyboard tests. Contrast is gated by `themeA11y.test.ts` (axe cannot compute
 * it in jsdom).
 */

const ROWS: KeywordRow[] = [
  {
    text: 'running shoes',
    intentLabels: ['informational', 'commercial', 'transactional', 'navigational'],
    avgMonthlySearches: 12000,
    competition: 'HIGH',
    competitionIndex: 88,
    cpcLow: 1.2,
    cpcHigh: 3.4,
    monthlyVolumes: [
      { year: 2026, month: 1, searches: 1000 },
      { year: 2026, month: 2, searches: null },
      { year: 2026, month: 3, searches: 1400 },
    ],
  },
  {
    text: '缺值列',
    intentLabels: [],
    avgMonthlySearches: null,
    competition: 'LOW',
    competitionIndex: null,
    cpcLow: null,
    cpcHigh: null,
    monthlyVolumes: [],
  },
];

function FilterHarness() {
  const [spec, setSpec] = useState({});
  return <FilterBar allowedFilters={DEFAULT_ALLOWED_FILTERS} value={spec} onChange={setSpec} />;
}

async function expectClean(container: HTMLElement) {
  expect(await axe(container)).toHaveNoViolations();
}

describe('TC-24 · axe gate (WCAG A/AA, no violations)', () => {
  it('SegmentedControl', async () => {
    const { container } = render(
      <SegmentedControl
        options={[
          { value: 'a', label: '表格' },
          { value: 'b', label: '圖表' },
        ]}
        value="a"
        onChange={() => {}}
        ariaLabel="檢視方式"
      />,
    );
    await expectClean(container);
  });

  it('ChipBox', async () => {
    const { container } = render(
      <ChipBox labels={['價格導向', '品質導向']} onAdd={() => {}} onRemove={() => {}} />,
    );
    await expectClean(container);
  });

  it('FeatureGate (all states)', async () => {
    for (const status of ['not_generated', 'running', 'failed', 'ready'] as const) {
      const { container, unmount } = render(
        <FeatureGate status={status} featureLabel="意圖主題">
          <p>內容</p>
        </FeatureGate>,
      );
      await expectClean(container);
      unmount();
    }
  });

  it('StateViews (loading / empty / error+retry)', async () => {
    const { container } = render(
      <div>
        <LoadingState />
        <EmptyState message="尚無資料" />
        <ErrorState message="發生錯誤" onRetry={() => {}} />
      </div>,
    );
    await expectClean(container);
  });

  it('FilterBar (closed + open popover)', async () => {
    const { container } = render(<FilterHarness />);
    await expectClean(container);
    fireEvent.click(screen.getByRole('button', { name: /意圖類別/ }));
    await expectClean(container);
  });

  it('KeywordsTable (rows with intent chips + null cells)', async () => {
    const { container } = render(<KeywordsTable rows={ROWS} />);
    await expectClean(container);
  });

  it('BulkSelectBar (floating bar with a selection)', async () => {
    useSelectionStore.setState({
      items: [{ kind: 'keyword', text: 'a', geo: 'TW', language: 'zh-TW' }],
    });
    const { container } = render(<BulkSelectBar />);
    await expectClean(container);
    useSelectionStore.getState().clear();
  });
});
