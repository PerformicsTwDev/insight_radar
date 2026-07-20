import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { AiIntentCell } from './AiIntentCell';
import { IntentTopicsView } from '../topics/IntentTopicsView';

/**
 * TC-28 (component) — the single-cell ✦ on-demand AI-intent cell (T4.1, FR-18 /
 * AC-18.1). A masked ✦ → click → synchronous `POST :id/ai-intent-summary`
 * ({scope:'keyword', normalizedText}) → the summary fills the cell; a row with no
 * normalizedText → 400 → a distinct "缺少關鍵字資料" mark; a transient failure →
 * retryable. And the C13 decoupling guard: generating a ✦ cell must NOT unlock the
 * left-side dimension view-gate. The backend FR-31 endpoint is deferred, so it is
 * mocked via MSW (external APIs are always mocked).
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ROUTE = '/api/v1/keyword-analyses/:id/ai-intent-summary';
const CELL_LABEL = 'AI 歸納搜尋意圖';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  // Default: a keyword-scope summary that echoes the normalizedText it received.
  server.use(
    http.post(ROUTE, async ({ request }) => {
      const body = (await request.json()) as { scope?: string; normalizedText?: string };
      if (body.scope === 'keyword' && !body.normalizedText) {
        return HttpResponse.json(
          { statusCode: 400, code: 'normalizedText_required' },
          { status: 400 },
        );
      }
      return HttpResponse.json({
        normalizedText: body.normalizedText,
        summary: '導購型：使用者在比較品牌與價格',
      });
    }),
  );
});

describe('TC-28 · AiIntentCell (single-cell 同步回填)', () => {
  it('idle → shows a masked ✦ generate button (not yet a summary)', () => {
    render(<AiIntentCell analysisId={ID} normalizedText="running shoes" />);
    expect(screen.getByRole('button', { name: CELL_LABEL })).toHaveTextContent('✦');
    expect(screen.queryByText(/導購型/)).not.toBeInTheDocument();
  });

  it('click → POSTs {scope:keyword, normalizedText} and fills the cell with the summary (done)', async () => {
    let received: unknown;
    server.use(
      http.post(ROUTE, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ normalizedText: 'running shoes', summary: '導購型意圖摘要' });
      }),
    );
    render(<AiIntentCell analysisId={ID} normalizedText="running shoes" />);

    fireEvent.click(screen.getByRole('button', { name: CELL_LABEL }));

    await waitFor(() => expect(screen.getByText('導購型意圖摘要')).toBeInTheDocument());
    expect(received).toEqual({ scope: 'keyword', normalizedText: 'running shoes' });
    // Settled → the generate button is gone (no silent re-fetch of a done cell).
    expect(screen.queryByRole('button', { name: CELL_LABEL })).not.toBeInTheDocument();
  });

  it('shows the loading state between click and response', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(ROUTE, async () => {
        await gate;
        return HttpResponse.json({ normalizedText: 'running shoes', summary: 'done!' });
      }),
    );
    render(<AiIntentCell analysisId={ID} normalizedText="running shoes" />);

    fireEvent.click(screen.getByRole('button', { name: CELL_LABEL }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

    release();
    await waitFor(() => expect(screen.getByText('done!')).toBeInTheDocument());
  });

  it('a row with no normalizedText → 400 → the distinct 缺少關鍵字資料 mark (not a retry)', async () => {
    render(<AiIntentCell analysisId={ID} />);

    fireEvent.click(screen.getByRole('button', { name: CELL_LABEL }));

    await waitFor(() => expect(screen.getByText(/缺少關鍵字資料/)).toBeInTheDocument());
    // Not a generic failure — no retry affordance (a retry can't supply the missing key).
    expect(screen.queryByRole('button', { name: /重試/ })).not.toBeInTheDocument();
  });

  it('a transient failure (500) → error state with a retry that regenerates', async () => {
    let calls = 0;
    server.use(
      http.post(ROUTE, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ normalizedText: 'running shoes', summary: '重試成功摘要' });
      }),
    );
    render(<AiIntentCell analysisId={ID} normalizedText="running shoes" />);

    fireEvent.click(screen.getByRole('button', { name: CELL_LABEL }));
    const retry = await screen.findByRole('button', { name: /重試/ });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText('重試成功摘要')).toBeInTheDocument());
    expect(calls).toBe(2);
  });

  it('rapid double-click on the error-branch retry → fires exactly ONE POST (sibling of M4-R1 #603)', async () => {
    // Sibling check for #603: unlike startBatch, the retry path dispatches `generate`
    // synchronously BEFORE its await, so the first click flips the cell to loading and
    // the retry button unmounts (→ a spinner) before a second click can land. Verifies
    // the render-driven guard already prevents a duplicate regenerate POST here.
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(ROUTE, async () => {
        calls += 1;
        if (calls === 1) return new HttpResponse(null, { status: 500 });
        await gate; // hold the retry POST open to keep the double-click window ajar
        return HttpResponse.json({ normalizedText: 'running shoes', summary: '重試成功摘要' });
      }),
    );
    render(<AiIntentCell analysisId={ID} normalizedText="running shoes" />);

    fireEvent.click(screen.getByRole('button', { name: CELL_LABEL }));
    const retry = await screen.findByRole('button', { name: /重試/ });
    // Fast double-click on the same retry affordance.
    fireEvent.click(retry);
    fireEvent.click(retry);
    release();

    await waitFor(() => expect(screen.getByText('重試成功摘要')).toBeInTheDocument());
    expect(calls).toBe(2); // 1 initial (500) + exactly 1 retry — never a duplicate.
  });
});

describe('TC-28 · ✦ generation is decoupled from the left-side view-gate (C13)', () => {
  it('generating a ✦ cell does NOT unlock the intent-topics dimension view (gate untouched)', async () => {
    let topicsPosted = false;
    server.use(
      // If ✦ generation were (wrongly) coupled to the view-gate, it would POST /topics.
      http.post('/api/v1/keyword-analyses/:id/topics', () => {
        topicsPosted = true;
        return HttpResponse.json({ topicJobId: 'job-x' }, { status: 202 });
      }),
    );

    // The topics view is gated (features has no `topics` entry → not_generated).
    render(
      <>
        <AiIntentCell analysisId={ID} normalizedText="running shoes" />
        <IntentTopicsView analysisId={ID} features={{}} />
      </>,
      { wrapper: wrapper() },
    );

    // Precondition: the topics view shows its gate CTA, not the 主題表.
    expect(screen.getByText(/尚未進行意圖主題分析/)).toBeInTheDocument();

    // Generate the ✦ cell → it fills in.
    fireEvent.click(screen.getByRole('button', { name: CELL_LABEL }));
    await waitFor(() => expect(screen.getByText(/導購型/)).toBeInTheDocument());

    // C13: the dimension view-gate is unchanged — still the CTA, no topics table, and
    // no topics run was ever started by the ✦ generation.
    expect(screen.getByText(/尚未進行意圖主題分析/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: '意圖主題表' })).not.toBeInTheDocument();
    expect(topicsPosted).toBe(false);
  });
});
