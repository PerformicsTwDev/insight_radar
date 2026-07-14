import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { server } from '../../api/msw/server';
import { JobTrackingPanel } from './JobTrackingPanel';

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper(): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <JobTrackingPanel analysisId={ID} />
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
}

describe('TC-14 · JobTrackingPanel (container wires hook → progress + cancel)', () => {
  it('renders the tracking panel and cancels via the hook (DELETE :id → canceled)', async () => {
    let deleted = false;
    server.use(
      http.delete('/api/v1/keyword-analyses/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    renderPanel();

    // Queued/progress view while the (inert stub) SSE stream is silent.
    expect(screen.getByRole('heading', { level: 2, name: '關鍵字分析' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => expect(deleted).toBe(true));
    expect(await screen.findByText('已取消')).toBeInTheDocument();
  });
});
