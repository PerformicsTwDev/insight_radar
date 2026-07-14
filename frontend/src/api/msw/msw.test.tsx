import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect, useState } from 'react';
import { api } from '../client';
import type { paths } from '../schema';
import { server } from './server';

type HealthOk = paths['/health']['get']['responses']['200']['content']['application/json'];

// 最小元件：經 typed `api` client 打 `/health` 並渲染 status——證明 MSW 於 **component 測試** 攔截
// （元件從不打真後端）。真頁面於 M1+ 落地；此為 API 層 + MSW harness 的驗證。
function HealthStatus() {
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    void api.GET('/health').then(({ data }) => setStatus(data?.status ?? 'unknown'));
  }, []);
  return <span>health: {status}</span>;
}

// T0.5 DoD ④「MSW 於 component 測試攔截」——非 TC-38（drift gate＝CI `openapi:check` step）。
describe('MSW: typed client interception (T0.5 DoD)', () => {
  it('renders the MSW-mocked /health status via the openapi-fetch client', async () => {
    render(<HealthStatus />);
    expect(await screen.findByText('health: ok')).toBeInTheDocument();
  });

  it('honours a per-test override handler (server.use)', async () => {
    server.use(http.get('/health', () => HttpResponse.json<HealthOk>({ status: 'degraded' })));
    render(<HealthStatus />);
    expect(await screen.findByText('health: degraded')).toBeInTheDocument();
  });
});
