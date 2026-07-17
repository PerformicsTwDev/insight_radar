import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { keywordsView } from 'src/keywords/views';
import { createTestApp } from '../utils';

/**
 * TC-55 部分（FR-22/NFR-10）：`GET /api/v1/views` 自省端點——回各 view 的
 * `{ name, grain, allowedSelect:[{key,type}], allowedFilters, allowedSort, responseShape }`（AC-22.2）
 * ＋ as-built 的 `requiresFeature`（feature-gating，AC-14.7；spec-first 併入 AC-22.2）。**與 `/query` 同一
 * ViewRegistry 來源**（不另抄白名單）；未認證 → 401。閉環：新增 ViewDefinition 自動出現於 /views（NFR-10）。
 */
const API_KEY = 'test-api-key';

interface SelectField {
  key: string;
  type: 'text' | 'number' | 'array';
}
interface ViewMeta {
  name: string;
  grain: string;
  allowedSelect: SelectField[];
  allowedFilters: string[];
  allowedSort: string[];
  responseShape: string;
  requiresFeature: string;
}

describe('GET /api/v1/views 自省 (e2e · TC-55 部分 · FR-22/NFR-10)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('未認證 → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/views');
    expect(res.status).toBe(401);
  });

  it('回 AC-22.2 契約形狀（grain + allowedSelect:[{key,type}] + responseShape），與 registry 同源', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/views').set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    const body = res.body as { views: ViewMeta[] };

    const names = body.views.map((v) => v.name).sort();
    expect(names).toEqual(
      [
        'cpc_histogram',
        'intent_distribution',
        'intent_topics',
        'journey',
        'journey_funnel',
        'keywords',
        'serp_questions',
        'trend',
      ].sort(),
    );

    const kw = body.views.find((v) => v.name === 'keywords');
    expect(kw).toBeDefined();
    expect(kw?.responseShape).toBe('table'); // AC-22.2：responseShape（非 kind）
    expect(kw?.grain).toBe('keyword'); // AC-22.2 / Design §17.1 grain 表
    // allowedSelect 為 [{key,type}]（AC-22.2），key 集合與 /query 白名單同源（非另抄）。
    expect(kw?.allowedSelect.map((f) => f.key)).toEqual([...keywordsView.allowedSelect]);
    expect(kw?.allowedSelect.find((f) => f.key === 'text')?.type).toBe('text');
    expect(kw?.allowedSelect.find((f) => f.key === 'avgMonthlySearches')?.type).toBe('number');
    expect(kw?.allowedSelect.find((f) => f.key === 'intent')?.type).toBe('array');
    // allowedFilters/allowedSort 仍為 key 陣列，與 registry 同源。
    expect(kw?.allowedFilters).toEqual([...keywordsView.allowedFilters]);
    expect(kw?.allowedSort).toEqual([...keywordsView.allowedSort]);
    expect(kw?.requiresFeature).toBe('keyword_metrics'); // 未指定 → 預設 feature

    const trend = body.views.find((v) => v.name === 'trend');
    expect(trend?.responseShape).toBe('trend');
    expect(trend?.grain).toBe('month');
    expect(trend?.allowedSelect).toEqual([]); // chart/trend view：無 select 欄位
    expect(body.views.find((v) => v.name === 'intent_distribution')?.responseShape).toBe('chart');
    expect(body.views.find((v) => v.name === 'cpc_histogram')?.responseShape).toBe('chart');
    // placeholder（gated）view：帶 typed allowedSelect + grain。
    const serp = body.views.find((v) => v.name === 'serp_questions');
    expect(serp?.requiresFeature).toBe('serp');
    expect(serp?.allowedSelect.find((f) => f.key === 'estimatedImpressions')?.type).toBe('number');
    expect(body.views.find((v) => v.name === 'intent_topics')?.requiresFeature).toBe('topics');
  });
});
