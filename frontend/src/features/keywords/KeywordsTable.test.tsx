import { fireEvent, render, screen, within } from '@testing-library/react';
import { KeywordsTable, type DimensionColumnConfig } from './KeywordsTable';
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
    // a real series with a missing month → sparkline draws (with a null break, never a 0 dip).
    monthlyVolumes: [
      { year: 2026, month: 1, searches: 1000 },
      { year: 2026, month: 2, searches: null },
      { year: 2026, month: 3, searches: 1400 },
      { year: 2026, month: 4, searches: 1800 },
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
    // no monthly data → sparkline renders the no-data marker (—), never a 0 line.
    monthlyVolumes: [],
  },
  {
    text: 'mystery intent',
    intentLabels: ['mystery'],
    avgMonthlySearches: 5,
    competition: 'UNSPECIFIED',
    competitionIndex: 10,
    cpcLow: 2,
    cpcHigh: 2,
    monthlyVolumes: [
      { year: 2026, month: 1, searches: 3 },
      { year: 2026, month: 2, searches: 7 },
    ],
  },
];

/** Column order in the DOM (search 詞 frozen first, 搜尋趨勢 sparkline, ✦ on-demand last). */
const COL = { text: 0, intent: 1, volume: 2, competition: 3, cpc: 4, trend: 5, ai: 6 } as const;

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

  it('renders the 搜尋趨勢TTM sparkline column (FR-4 → FR-21) between CPC and the ✦ column', () => {
    render(<KeywordsTable rows={rows} />);
    expect(screen.getByRole('columnheader', { name: '搜尋趨勢TTM' })).toBeInTheDocument();
    // column order: 搜尋趨勢TTM sits at index 5, ✦ at 6.
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers[COL.trend]).toBe('搜尋趨勢TTM');
    expect(headers[COL.ai]).toBe('✦');
  });

  it('draws a sparkline for rows with monthlyVolumes and 無趨勢資料 (never a 0 line) for empty months (TC-7)', () => {
    render(<KeywordsTable rows={rows} />);
    // rows with a real series render an accessible SVG trend graphic.
    expect(screen.getAllByRole('img', { name: '搜尋趨勢走勢' }).length).toBe(2);
    // the empty-series row shows the no-data marker in its 搜尋趨勢 cell, not a fabricated 0 line.
    const trendCell = missingRowCells()[COL.trend];
    expect(within(trendCell).getByRole('img', { name: '無趨勢資料' })).toBeInTheDocument();
    expect(trendCell.querySelector('polyline')).toBeNull();
  });
});

describe('TC-28 · KeywordsTable on-demand dimension columns (搜尋意圖主題 / 購買歷程主題, M7-R2b/c)', () => {
  const topicColumn: DimensionColumnConfig = {
    id: 'intentTopic',
    label: '搜尋意圖主題',
    accent: 'topic',
    phase: 'ready',
    onGenerate: () => {},
    cellState: (row) =>
      row.text === 'running shoes' ? { kind: 'value', label: '規格探究' } : { kind: 'empty' },
  };

  it('inserts the dimension column right after 意圖 with its header + per-row client-joined pills', () => {
    render(<KeywordsTable rows={rows} dimensionColumns={[topicColumn]} />);
    // Column order: 搜尋詞(0) 意圖(1) 搜尋意圖主題(2) 搜尋量(3) …
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers[2]).toBe('搜尋意圖主題');
    expect(headers[3]).toBe('搜尋量');
    // the classified row shows its pill; an unclassified row shows — (never a fabricated topic).
    expect(screen.getByText('規格探究')).toBeInTheDocument();
  });

  it('fires the container generate handler from the header ✦ trigger when generatable', () => {
    let generateCalls = 0;
    render(
      <KeywordsTable
        rows={rows}
        dimensionColumns={[
          { ...topicColumn, phase: 'generatable', onGenerate: () => (generateCalls += 1) },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /搜尋意圖主題/ }));
    expect(generateCalls).toBe(1);
  });

  it('renders no dimension column when none is supplied (unchanged base shape)', () => {
    render(<KeywordsTable rows={rows} />);
    expect(screen.queryByRole('columnheader', { name: '搜尋意圖主題' })).not.toBeInTheDocument();
  });
});

describe('TC-28 · KeywordsTable ✦ column wiring (analysisId → interactive AiIntentCell)', () => {
  it('renders a static ✦ placeholder (no interactive cells) when no analysisId is supplied', () => {
    render(<KeywordsTable rows={rows} />);
    // Standalone / degraded render (no analysis context) → the ✦ column stays a masked placeholder.
    expect(screen.queryByRole('button', { name: 'AI 歸納搜尋意圖' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '✦' })).toBeInTheDocument();
  });

  it('renders one interactive ✦ AI-intent cell per row when analysisId is supplied (T4.1, FR-18)', () => {
    render(<KeywordsTable rows={rows} analysisId="an-1" />);
    expect(screen.getAllByRole('button', { name: 'AI 歸納搜尋意圖' })).toHaveLength(rows.length);
  });
});

describe('TC-47 · KeywordsTable per-row selection column (FR-19, opt-in)', () => {
  it('renders no selection column when no `selection` is supplied (pre-T6.4 shape)', () => {
    render(<KeywordsTable rows={rows} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    // Column order is unchanged (搜尋詞 stays the frozen lead column).
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers[COL.text]).toBe('搜尋詞');
  });

  it('renders one checkbox per row (labelled by the row text) and reflects isSelected', () => {
    render(
      <KeywordsTable
        rows={rows}
        selection={{
          isSelected: (row) => row.text === 'running shoes',
          onToggle: () => undefined,
        }}
      />,
    );
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(rows.length);
    expect(screen.getByRole('checkbox', { name: '選取 running shoes' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '選取 缺值列' })).not.toBeChecked();
  });

  it('calls onToggle with the row when its checkbox is clicked', () => {
    const toggled: string[] = [];
    render(
      <KeywordsTable
        rows={rows}
        selection={{ isSelected: () => false, onToggle: (row) => toggled.push(row.text) }}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 mystery intent' }));
    expect(toggled).toEqual(['mystery intent']);
  });

  it('freezes both the selection column and 搜尋詞 (sticky-left) when selection is on', () => {
    render(
      <KeywordsTable rows={rows} selection={{ isSelected: () => false, onToggle: () => {} }} />,
    );
    // With a selection column the frozen lead pair is [select, 搜尋詞]; 搜尋詞 shifts to index 1.
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0].className).toContain('sticky'); // select column pinned at left 0
    const textHeader = screen.getByRole('columnheader', { name: '搜尋詞' });
    expect(textHeader.className).toContain('sticky');
    expect(textHeader).toHaveStyle({ left: '44px' }); // offset past the select column
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
    monthlyVolumes: [],
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

  it('windows correctly when scrolled deep into a 3,000+ row page (AC-4.1 scroll depth)', async () => {
    const manyThousands: KeywordRow[] = Array.from({ length: 3500 }, (_, i) => ({
      text: `kw-${i}`,
      intentLabels: ['informational'],
      avgMonthlySearches: i,
      competition: 'LOW',
      competitionIndex: i,
      cpcLow: 1,
      cpcHigh: 2,
      monthlyVolumes: [],
    }));
    render(<KeywordsTable rows={manyThousands} />);
    await screen.findByText('kw-0'); // initial window at the top

    // Scroll well past row 3,000 (row height 44px) and let the virtualizer recompute.
    const scroller = screen.getByRole('table');
    scroller.scrollTop = 3000 * 44;
    fireEvent.scroll(scroller);

    // The window shifts to the deep rows: a ~row-3,000 keyword renders, the top row is
    // gone, and the DOM row count stays bounded (windowed — not proportional to 3,500).
    expect(await screen.findByText('kw-3000')).toBeInTheDocument();
    expect(screen.queryByText('kw-0')).not.toBeInTheDocument();

    const bodyRows = screen
      .getAllByRole('row')
      .filter((r) => within(r).queryAllByRole('cell').length > 0);
    expect(bodyRows.length).toBeGreaterThan(0);
    expect(bodyRows.length).toBeLessThan(60); // bounded window, not ~3,500 DOM rows

    // Frozen column + sticky header remain applied after a deep scroll (CSS pinning
    // is asserted here; pixel-level sticky rendering is a visual-regression concern,
    // deferred to the M6 Playwright visual baseline).
    const deepRow = screen.getByRole('row', { name: /kw-3000/ });
    expect(within(deepRow).getAllByRole('cell')[0].className).toContain('sticky');
    expect(screen.getByTestId('keywords-thead').className).toContain('sticky');
  });
});
