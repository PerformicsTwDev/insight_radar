import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackingListSummary } from '../../api/trackingLists';
import { LeftTrackingNav } from './LeftTrackingNav';
import { useTrackingLists } from './useTrackingLists';

vi.mock('./useTrackingLists', () => ({ useTrackingLists: vi.fn() }));
const mockUseTrackingLists = vi.mocked(useTrackingLists);

function summary(listId: string, name: string): TrackingListSummary {
  return {
    listId,
    name,
    geo: 'geoTargetConstants/2158',
    language: 'languageConstants/1018',
    createdAt: '2026-01-01T00:00:00.000Z',
    memberCount: 3,
  };
}

function setLists(lists: TrackingListSummary[]): void {
  mockUseTrackingLists.mockReturnValue({
    lists,
    setLists: vi.fn(),
    loading: false,
    failed: false,
    reload: vi.fn(),
  });
}

describe('TC-58 / M7-R5 · LeftTrackingNav (left-column tracking-list section)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a named entry per tracking list under the 追蹤清單 heading', () => {
    setLists([summary('l1', '競品觀察清單'), summary('l2', 'Q3 核心字')]);
    render(<LeftTrackingNav onSelect={vi.fn()} />);

    const nav = screen.getByRole('navigation', { name: '相關搜尋詞追蹤清單' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /競品觀察清單/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Q3 核心字/ })).toBeInTheDocument();
  });

  it('calls onSelect with the listId when an entry is clicked', () => {
    const onSelect = vi.fn();
    setLists([summary('l1', '競品觀察清單')]);
    render(<LeftTrackingNav onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /競品觀察清單/ }));
    expect(onSelect).toHaveBeenCalledWith('l1');
  });

  it('renders nothing when there are no tracking lists (no empty section)', () => {
    setLists([]);
    const { container } = render(<LeftTrackingNav onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
