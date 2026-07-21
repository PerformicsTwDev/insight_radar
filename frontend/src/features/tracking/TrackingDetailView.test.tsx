import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * TC-30 (component; FR-19 · backend FR-30 · AC-30.1~30.5 · Design §9.2) — the tracking
 * detail time-series dashboard. jsdom can't render `<canvas>`, so `chart.js` is mocked
 * and we assert the **assembled datasets** (aggregate line first from `total`, then one
 * `fetchedAt`-axis-aligned line per selected member with `null` breaks — never 0). The
 * empty state ("尚無時序資料") draws NO chart (no fake 0 line, AC-30.3); the time-range
 * control (6M/12M/all) refetches with a `from` bound; the member table shows the latest
 * search volume + a sparkline + addedAt + a confirm-gated, guarded remove. All egress
 * is MSW-mocked.
 */

// Capture every Chart.js config across (re)constructions + count destroys.
const chart = vi.hoisted(() => ({ configs: [] as unknown[], destroys: { count: 0 } }));
vi.mock('chart.js', () => {
  class MockChart {
    static register = vi.fn();
    constructor(_canvas: unknown, config: unknown) {
      chart.configs.push(config);
    }
    update = vi.fn();
    destroy = (): void => {
      chart.destroys.count += 1;
    };
  }
  return { Chart: MockChart, registerables: [] };
});

import { TrackingDetailView } from './TrackingDetailView';
import { server } from '../../api/msw/server';

const LIST_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SERIES_ROUTE = '/api/v1/tracking-lists/:listId/series';
const REFRESH_ROUTE = '/api/v1/tracking-lists/:listId/refresh';
const MEMBER_ROUTE = '/api/v1/tracking-lists/:listId/members/:normalizedText';

interface Dataset {
  label: string;
  data: (number | null)[];
  fill: boolean;
  borderColor: string;
}
interface Config {
  data: { labels: string[]; datasets: Dataset[] };
}
const lastConfig = (): Config => chart.configs[chart.configs.length - 1] as Config;

const AXIS = ['2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'];

const point = (fetchedAt: string, avg: number | null) => ({
  fetchedAt,
  avgMonthlySearches: avg,
  competition: 'HIGH',
  cpc: 1.1,
});

/** A member's axis-aligned series (null-break points carry the axis time, avg null). */
function memberSeries(
  normalizedText: string,
  text: string,
  values: (number | null)[],
): Record<string, unknown> {
  const series = AXIS.map((t, i) => point(t, values[i]));
  const latest = [...series].reverse().find((p) => p.avgMonthlySearches !== null) ?? null;
  return {
    normalizedText,
    text,
    addedAt: '2026-01-01T00:00:00.000Z',
    lastCheckedAt: '2026-05-01T00:00:00.000Z',
    latest,
    series,
  };
}

function seriesBody(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    list: { listId: LIST_ID, name: 'Running shoes', geo: 'TW', language: 'zh-TW' },
    axis: AXIS,
    total: [300, 250, 400],
    members: [
      // running shoes: present at obs 0 + 2, MISSING at obs 1 → a null break.
      memberSeries('running shoes', 'Running Shoes', [100, null, 140]),
      memberSeries('trail shoes', 'Trail Shoes', [null, 50, null]),
    ],
    summary: { memberCount: 2, latestFetchedAt: AXIS[2] },
    ...overrides,
  };
}

/** Members of `body` minus the removed `normalizedText` (for the refetch-after-remove flow). */
function remaining(
  body: Record<string, unknown>,
  normalizedText: string,
): Record<string, unknown>[] {
  return (body.members as Record<string, unknown>[]).filter(
    (m) => m.normalizedText !== normalizedText,
  );
}

/** Register `GET /:listId/series`, recording each request's `from` query param. */
function withSeries(body: Record<string, unknown>): string[] {
  const froms: string[] = [];
  server.use(
    http.get(SERIES_ROUTE, ({ request }) => {
      froms.push(new URL(request.url).searchParams.get('from') ?? '');
      return HttpResponse.json(body, { status: 200 });
    }),
  );
  return froms;
}

beforeEach(() => {
  chart.configs.length = 0;
  chart.destroys.count = 0;
});

describe('TC-30 · TrackingDetailView (aggregate + fetchedAt-axis member lines)', () => {
  it('draws the aggregate line by default (single dataset, total verbatim)', async () => {
    withSeries(seriesBody());
    render(<TrackingDetailView listId={LIST_ID} />);

    await waitFor(() => expect(chart.configs.length).toBeGreaterThan(0));
    const config = lastConfig();
    expect(config.data.labels).toEqual(['2026-01-01', '2026-03-01', '2026-05-01']);
    expect(config.data.datasets).toHaveLength(1);
    expect(config.data.datasets[0].data).toEqual([300, 250, 400]); // §9.2 continuous total
    expect(config.data.datasets[0].fill).toBe(true);
  });

  it('adds a fetchedAt-aligned line per selected member with a null break (AC-30.2)', async () => {
    withSeries(seriesBody());
    render(<TrackingDetailView listId={LIST_ID} />);
    await waitFor(() => expect(chart.configs.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /篩選成員/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Running Shoes' }));

    const config = lastConfig();
    expect(config.data.datasets).toHaveLength(2);
    expect(config.data.datasets[0].label).toBe('全部成員加總');
    expect(config.data.datasets[1].label).toBe('Running Shoes');
    // aligned to the shared fetchedAt axis; the missing middle observation is a null
    // break (never 0, never re-derived) — the C11 single-point.
    expect(config.data.datasets[1].data).toEqual([100, null, 140]);
    expect(config.data.datasets[1].fill).toBe(false);
    expect(chart.destroys.count).toBeGreaterThanOrEqual(1);
  });

  it('shows 尚無時序資料 and draws NO chart when the axis is empty (first run, no fake 0)', async () => {
    // members exist but were never refreshed → empty axis (AC-30.3).
    withSeries(
      seriesBody({
        axis: [],
        total: [],
        members: [
          {
            normalizedText: 'running shoes',
            text: 'Running Shoes',
            addedAt: '2026-01-01T00:00:00.000Z',
            lastCheckedAt: null,
            latest: null,
            series: [],
          },
        ],
        summary: { memberCount: 1, latestFetchedAt: null },
      }),
    );
    render(<TrackingDetailView listId={LIST_ID} />);

    expect(await screen.findByText('尚無時序資料')).toBeInTheDocument();
    expect(chart.configs).toHaveLength(0); // no chart constructed → no fabricated 0 line
    // the member is still listed (it exists, just has no series yet).
    expect(screen.getByText('Running Shoes')).toBeInTheDocument();
  });

  it('surfaces a load failure without crashing', async () => {
    server.use(http.get(SERIES_ROUTE, () => new HttpResponse(null, { status: 404 })));
    render(<TrackingDetailView listId={LIST_ID} />);
    expect(await screen.findByText('時序載入失敗')).toBeInTheDocument();
  });
});

describe('TC-30 · time-range window (6M / 12M / all)', () => {
  it('refetches without a `from` on all, and with a `from` on 6 個月', async () => {
    const froms = withSeries(seriesBody());
    render(<TrackingDetailView listId={LIST_ID} />);
    await waitFor(() => expect(froms.length).toBeGreaterThan(0));
    expect(froms[0]).not.toBe(''); // default window is bounded (12M)

    fireEvent.click(screen.getByRole('tab', { name: '全部' }));
    await waitFor(() => expect(froms[froms.length - 1]).toBe('')); // all → no lower bound

    fireEvent.click(screen.getByRole('tab', { name: '6 個月' }));
    await waitFor(() => expect(froms[froms.length - 1]).not.toBe('')); // 6M → bounded again
  });
});

describe('TC-30 · member table (latest volume / sparkline / addedAt / remove)', () => {
  it('lists each member with its latest search volume and a sparkline', async () => {
    withSeries(seriesBody());
    render(<TrackingDetailView listId={LIST_ID} />);

    const row = await screen.findByRole('row', { name: /Running Shoes/ });
    // latest month searches from member.latest.avgMonthlySearches (140), grouped.
    expect(within(row).getByText('140')).toBeInTheDocument();
    // reused SVG sparkline (lib/sparkline via SparklineCell).
    expect(within(row).getByRole('img', { name: '搜尋趨勢走勢' })).toBeInTheDocument();
  });

  it('removes a member behind a confirm dialog then refetches the reduced series', async () => {
    let current = seriesBody();
    let seenMember: string | undefined;
    server.use(
      http.get(SERIES_ROUTE, () => HttpResponse.json(current, { status: 200 })),
      http.delete(MEMBER_ROUTE, ({ params }) => {
        seenMember = params.normalizedText as string;
        current = seriesBody({ members: remaining(current, params.normalizedText as string) });
        return HttpResponse.json({ listId: LIST_ID, normalizedText: seenMember }, { status: 200 });
      }),
    );
    render(<TrackingDetailView listId={LIST_ID} />);

    fireEvent.click(await screen.findByRole('button', { name: '移除 Running Shoes' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '確定移除' }),
    );

    await waitFor(() => expect(screen.queryByText('Running Shoes')).not.toBeInTheDocument());
    expect(seenMember).toBe('running shoes');
    expect(screen.getByText('Trail Shoes')).toBeInTheDocument(); // the other member stays
  });

  it('shows an error and keeps the member when the removal fails (404)', async () => {
    withSeries(seriesBody());
    server.use(http.delete(MEMBER_ROUTE, () => new HttpResponse(null, { status: 404 })));
    render(<TrackingDetailView listId={LIST_ID} />);

    fireEvent.click(await screen.findByRole('button', { name: '移除 Running Shoes' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '確定移除' }),
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Running Shoes')).toBeInTheDocument(); // stays on failure
  });

  it('closes the confirm dialog on cancel without removing', async () => {
    withSeries(seriesBody());
    render(<TrackingDetailView listId={LIST_ID} />);

    fireEvent.click(await screen.findByRole('button', { name: '移除 Running Shoes' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Running Shoes')).toBeInTheDocument();
  });

  it('shows the empty-member hint when the list has no members', async () => {
    withSeries(
      seriesBody({
        axis: [],
        total: [],
        members: [],
        summary: { memberCount: 0, latestFetchedAt: null },
      }),
    );
    render(<TrackingDetailView listId={LIST_ID} />);

    expect(await screen.findByText('此清單尚無成員。')).toBeInTheDocument();
    expect(screen.getByText('尚無時序資料')).toBeInTheDocument();
  });

  it('collapses a rapid double member removal to exactly ONE DELETE (in-flight guard)', async () => {
    let current = seriesBody();
    let deleted = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(SERIES_ROUTE, () => HttpResponse.json(current, { status: 200 })),
      http.delete(MEMBER_ROUTE, async ({ params }) => {
        deleted += 1;
        current = seriesBody({ members: remaining(current, params.normalizedText as string) });
        await gate;
        return HttpResponse.json(
          { listId: LIST_ID, normalizedText: params.normalizedText },
          { status: 200 },
        );
      }),
    );
    render(<TrackingDetailView listId={LIST_ID} />);

    fireEvent.click(await screen.findByRole('button', { name: '移除 Running Shoes' }));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', {
      name: '確定移除',
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm); // re-entry while the first DELETE is outstanding → no-op
    release();

    await waitFor(() => expect(screen.queryByText('Running Shoes')).not.toBeInTheDocument());
    expect(deleted).toBe(1);
  });
});

describe('TC-30 · manual refresh (POST /:listId/refresh, guarded)', () => {
  it('enqueues a refresh on click (202)', async () => {
    withSeries(seriesBody());
    let refreshed = 0;
    server.use(
      http.post(REFRESH_ROUTE, () => {
        refreshed += 1;
        return HttpResponse.json({ status: 'queued', listId: LIST_ID }, { status: 202 });
      }),
    );
    render(<TrackingDetailView listId={LIST_ID} />);

    fireEvent.click(await screen.findByRole('button', { name: '重新整理搜量' }));
    await waitFor(() => expect(refreshed).toBe(1));
  });

  it('shows an error when the refresh enqueue fails (404)', async () => {
    withSeries(seriesBody());
    server.use(http.post(REFRESH_ROUTE, () => new HttpResponse(null, { status: 404 })));
    render(<TrackingDetailView listId={LIST_ID} />);

    fireEvent.click(await screen.findByRole('button', { name: '重新整理搜量' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('collapses a rapid double refresh to exactly ONE POST (in-flight guard)', async () => {
    withSeries(seriesBody());
    let refreshed = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(REFRESH_ROUTE, async () => {
        refreshed += 1;
        await gate;
        return HttpResponse.json({ status: 'queued', listId: LIST_ID }, { status: 202 });
      }),
    );
    render(<TrackingDetailView listId={LIST_ID} />);

    const button = await screen.findByRole('button', { name: '重新整理搜量' });
    fireEvent.click(button);
    fireEvent.click(button); // re-entry while the first POST is outstanding → no-op
    release();

    await waitFor(() => expect(screen.getByText(/已排入刷新/)).toBeInTheDocument());
    expect(refreshed).toBe(1);
  });

  it('series-load failure → 重試 reloads and renders the series on success (state matrix)', async () => {
    let call = 0;
    server.use(
      http.get(SERIES_ROUTE, () => {
        call += 1;
        return call === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json(seriesBody(), { status: 200 });
      }),
    );
    render(<TrackingDetailView listId={LIST_ID} />);

    expect(await screen.findByText('時序載入失敗')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('Running Shoes')).toBeInTheDocument();
  });
});
