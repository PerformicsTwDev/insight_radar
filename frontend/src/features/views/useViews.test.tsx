import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { useViews } from './useViews';

/**
 * TC-37 — the `useViews` query hook (T3.1, FR-1 / AC-1.2). On success it builds
 * the registry from `GET /views` (not degraded); on a `/views` failure it degrades
 * to the built-in fallback list. External API mocked via MSW.
 */

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const VIEWS = {
  views: [
    {
      name: 'keywords',
      grain: 'keyword',
      allowedSelect: [{ key: 'text', type: 'text' }],
      allowedFilters: ['q'],
      allowedSort: ['text'],
      responseShape: 'table',
      requiresFeature: 'keyword_metrics',
    },
    {
      name: 'intent_topics',
      grain: 'topic',
      allowedSelect: [],
      allowedFilters: [],
      allowedSort: [],
      responseShape: 'table',
      requiresFeature: 'topics',
    },
  ],
};

describe('TC-37 · useViews (query hook → registry + degraded)', () => {
  it('builds the registry from GET /views (not degraded) on success', async () => {
    server.use(http.get('/api/v1/views', () => HttpResponse.json(VIEWS)));

    const { result } = renderHook(() => useViews(), { wrapper: wrapper() });

    await waitFor(() =>
      expect(result.current.registry.navItems.map((n) => n.name)).toEqual([
        'keywords',
        'intent_topics',
        'custom', // synthetic 自訂分類 dimension appended (M7-R7b)
      ]),
    );
    expect(result.current.degraded).toBe(false);
  });

  it('degrades to the built-in fallback list on a /views failure', async () => {
    server.use(http.get('/api/v1/views', () => new HttpResponse(null, { status: 503 })));

    const { result } = renderHook(() => useViews(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.degraded).toBe(true));
    expect(result.current.registry.navItems.map((n) => n.name)).toContain('keywords');
  });
});
