import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect, useState } from 'react';
import { api } from '../client';
import { server } from './server';

// 最小元件：經 typed `api` client 打 `/health` 並渲染 status——證明 MSW 於 **component 測試** 攔截
// （元件從不打真後端）。真頁面於 M1+ 落地；此為 API 層 + MSW harness 的驗證。
function HealthStatus() {
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    void api.GET('/health').then(({ data }) => setStatus(data?.status ?? 'unknown'));
  }, []);
  return <span>health: {status}</span>;
}

describe('TC-38 · MSW: typed client interception', () => {
  it('renders the MSW-mocked /health status via the openapi-fetch client', async () => {
    render(<HealthStatus />);
    expect(await screen.findByText('health: ok')).toBeInTheDocument();
  });

  it('honours a per-test override handler (server.use)', async () => {
    server.use(http.get('/health', () => HttpResponse.json({ status: 'degraded' })));
    render(<HealthStatus />);
    expect(await screen.findByText('health: degraded')).toBeInTheDocument();
  });
});
