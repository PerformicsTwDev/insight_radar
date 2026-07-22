import { fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { EMPTY_BRAND, type BrandFormState } from '../../lib/aiSearchForm';
import { BrandProfileForm } from './BrandProfileForm';

/**
 * TC-61 (品牌檔案卡) focused component tests. Drives the controlled `BrandProfileForm`
 * through its interactive surface — site chip removal, competitor row CRUD, and the
 * ✦ AI 補全 failure path (manual entry still works). The whole-home wiring (validation
 * gate, submit, explore-mode) is covered by `AiSearchHome.test.tsx`.
 */

function Harness({ initial = EMPTY_BRAND }: { initial?: BrandFormState }) {
  const [value, setValue] = useState(initial);
  return <BrandProfileForm value={value} onChange={setValue} />;
}

describe('TC-61 · BrandProfileForm interactive surface', () => {
  it('adds then removes a 品牌網站 chip', () => {
    render(<Harness />);
    const site = screen.getByLabelText('新增品牌網站');
    fireEvent.change(site, { target: { value: 'https://www.dyson.tw' } });
    fireEvent.keyDown(site, { key: 'Enter' });
    expect(screen.getByText('https://www.dyson.tw')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '移除 https://www.dyson.tw' }));
    expect(screen.queryByText('https://www.dyson.tw')).not.toBeInTheDocument();
  });

  it('edits a competitor row (name + alias/site chips) and removes the row', () => {
    render(
      <Harness initial={{ ...EMPTY_BRAND, competitors: [{ name: '', aliases: [], sites: [] }] }} />,
    );

    fireEvent.change(screen.getByLabelText('競品 1 名稱'), { target: { value: 'Shark' } });
    expect(screen.getByDisplayValue('Shark')).toBeInTheDocument();

    const compAlias = screen.getByLabelText('競品 1 別名');
    fireEvent.change(compAlias, { target: { value: '夏克' } });
    fireEvent.keyDown(compAlias, { key: 'Enter' });
    expect(screen.getByText('夏克')).toBeInTheDocument();

    const compSite = screen.getByLabelText('競品 1 網站');
    fireEvent.change(compSite, { target: { value: 'shark.com' } });
    fireEvent.keyDown(compSite, { key: 'Enter' });
    expect(screen.getByText('shark.com')).toBeInTheDocument();
    // remove the competitor alias + site chips (both competitor onRemove paths)
    fireEvent.click(screen.getByRole('button', { name: '移除 夏克' }));
    expect(screen.queryByText('夏克')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除 shark.com' }));
    expect(screen.queryByText('shark.com')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '移除競品 1' }));
    expect(screen.queryByLabelText('競品 1 名稱')).not.toBeInTheDocument();
  });

  it('patches only the targeted competitor row, leaving siblings unchanged', () => {
    render(
      <Harness
        initial={{
          ...EMPTY_BRAND,
          competitors: [
            { name: 'Shark', aliases: [], sites: [] },
            { name: 'Miele', aliases: [], sites: [] },
          ],
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText('競品 1 名稱'), { target: { value: 'Shark Pro' } });
    expect(screen.getByLabelText('競品 1 名稱')).toHaveValue('Shark Pro');
    expect(screen.getByLabelText('競品 2 名稱')).toHaveValue('Miele');
  });

  it('shows an error when ✦ AI 補全 fails, leaving manual entry usable', async () => {
    server.use(http.post('/api/v1/ai-ideation', () => HttpResponse.json({}, { status: 500 })));
    render(<Harness initial={{ ...EMPTY_BRAND, name: 'Dyson' }} />);

    fireEvent.click(screen.getByRole('button', { name: /AI 補全/ }));
    expect(await screen.findByText(/AI 補全失敗/)).toBeInTheDocument();

    // manual alias entry still works after the failure
    const alias = screen.getByLabelText('新增品牌別名');
    fireEvent.change(alias, { target: { value: '戴森' } });
    fireEvent.keyDown(alias, { key: 'Enter' });
    expect(screen.getByText('戴森')).toBeInTheDocument();
  });
});
