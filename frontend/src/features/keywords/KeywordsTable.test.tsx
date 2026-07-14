import { render, screen, within } from '@testing-library/react';
import { KeywordsTable } from './KeywordsTable';
import { EM_DASH } from '../../lib/keywordsTable';
import type { KeywordRow } from '../../api/keywords';

const rows: KeywordRow[] = [
  {
    text: 'running shoes',
    intentLabels: ['commercial'],
    avgMonthlySearches: 12000,
    competition: 'HIGH',
    competitionIndex: 88,
    cpcLow: 1.2,
    cpcHigh: 3.4,
  },
  {
    text: '缺值列',
    intentLabels: [],
    avgMonthlySearches: null,
    competition: 'LOW',
    competitionIndex: null,
    cpcLow: null,
    cpcHigh: null,
  },
  {
    text: 'mystery intent',
    intentLabels: ['mystery'],
    avgMonthlySearches: 5,
    competition: 'UNSPECIFIED',
    competitionIndex: 10,
    cpcLow: 2,
    cpcHigh: 2,
  },
];

/** Column order in the DOM (search 詞 frozen first, ✦ on-demand last). */
const COL = { text: 0, intent: 1, volume: 2, competition: 3, cpc: 4, ai: 5 } as const;

function missingRowCells() {
  const missingRow = screen.getByRole('row', { name: /缺值列/ });
  return within(missingRow).getAllByRole('cell');
}

describe('TC-15 · KeywordsTable (frozen col + sticky header + null → —, C12)', () => {
  it('renders the five columns plus the ✦ on-demand placeholder header', () => {
    render(<KeywordsTable rows={rows} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['搜尋詞', '意圖', '搜尋量', '競爭度', 'CPC']));
    // ✦ on-demand generation column — placeholder only; real wiring is M4.
    expect(screen.getByRole('columnheader', { name: '✦' })).toBeInTheDocument();
  });

  it('freezes the 搜尋詞 column (sticky left) and sticks the header (sticky top)', () => {
    render(<KeywordsTable rows={rows} />);
    const textHeader = screen.getByRole('columnheader', { name: '搜尋詞' });
    expect(textHeader.className).toContain('sticky');
    expect(textHeader.className).toContain('left-0');

    const thead = screen.getByTestId('keywords-thead');
    expect(thead.className).toContain('sticky');
    expect(thead.className).toContain('top-0');

    // the frozen body cell is also sticky-left so it stays put on horizontal scroll.
    const frozenCell = missingRowCells()[COL.text];
    expect(frozenCell.className).toContain('sticky');
    expect(frozenCell.className).toContain('left-0');
  });

  it('shows — (never 0) for null volume / CPC / competition-index cells (C12)', () => {
    render(<KeywordsTable rows={rows} />);
    const cells = missingRowCells();
    expect(cells[COL.volume]).toHaveTextContent(EM_DASH);
    expect(cells[COL.cpc]).toHaveTextContent(EM_DASH);
    // competition is present (LOW → 低) even when its index is null.
    expect(cells[COL.competition]).toHaveTextContent('低');
  });

  it('formats real values (never rendered as 0 for present metrics)', () => {
    render(<KeywordsTable rows={rows} />);
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByText('NT$1.20–NT$3.40')).toBeInTheDocument();
    expect(screen.getByText('高 · 88')).toBeInTheDocument();
  });

  it('renders intent chips via the intentMap SSOT, falling back for unknown labels', () => {
    render(<KeywordsTable rows={rows} />);
    expect(screen.getByText('商業型')).toBeInTheDocument(); // commercial → zh (C2)
    expect(screen.getByText('mystery')).toBeInTheDocument(); // unknown → raw label
    // an empty intent list renders — (not an empty cell).
    expect(missingRowCells()[COL.intent]).toHaveTextContent(EM_DASH);
  });
});

describe('TC-15 · KeywordsTable virtualization (windows a large page)', () => {
  // jsdom reports offsetHeight 0 for every element; @tanstack/react-virtual measures
  // the scroll element via offsetHeight, so we give it a viewport to produce a window.
  let originalOffsetHeight: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 400,
    });
  });

  afterAll(() => {
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    }
  });

  const many: KeywordRow[] = Array.from({ length: 150 }, (_, i) => ({
    text: `kw-${i}`,
    intentLabels: ['informational'],
    avgMonthlySearches: i,
    competition: 'LOW',
    competitionIndex: i,
    cpcLow: 1,
    cpcHigh: 2,
  }));

  it('renders only a window of the 150 rows (not all of them) yet the first row is present', async () => {
    render(<KeywordsTable rows={many} />);

    // the first row of the window renders correctly (virtualizer settles in an effect).
    expect(await screen.findByText('kw-0')).toBeInTheDocument();

    const bodyRows = screen
      .getAllByRole('row')
      .filter((r) => within(r).queryAllByRole('cell').length > 0);
    expect(bodyRows.length).toBeGreaterThan(0);
    expect(bodyRows.length).toBeLessThan(many.length);
  });
});
