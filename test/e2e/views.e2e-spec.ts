import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { keywordsView } from 'src/keywords/views';
import { createTestApp } from '../utils';

/**
 * TC-55 部分（FR-22/NFR-10）：`GET /api/v1/views` 自省端點——回各 view 的
 * allowedSelect/Filters/Sort + kind（responseShape）+ requiresFeature，**與 `/query` 同一 ViewRegistry
 * 來源**（不另抄白名單）；未認證 → 401。閉環：新增 ViewDefinition 自動出現於 /views（NFR-10）。
 */
const API_KEY = 'test-api-key';

interface ViewMeta {
  name: string;
  kind: string;
  allowedSelect: string[];
  allowedFilters: string[];
  allowedSort: string[];
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

  it('回各 view metadata（allowedSelect/Filters/Sort + kind + requiresFeature），與 registry 同源', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/views').set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    const body = res.body as { views: ViewMeta[] };

    const names = body.views.map((v) => v.name).sort();
    expect(names).toEqual(
      [
        'cpc_histogram',
        'intent_distribution',
        'intent_topics',
        'keywords',
        'serp_questions',
        'trend',
      ].sort(),
    );

    const kw = body.views.find((v) => v.name === 'keywords');
    expect(kw).toBeDefined();
    expect(kw?.kind).toBe('table');
    // 同源：與 /query 用的同一 ViewDefinition 白名單（非另抄）。
    expect(kw?.allowedFilters).toEqual([...keywordsView.allowedFilters]);
    expect(kw?.allowedSort).toEqual([...keywordsView.allowedSort]);
    expect(kw?.allowedSelect).toEqual([...keywordsView.allowedSelect]);
    expect(kw?.requiresFeature).toBe('keyword_metrics'); // 未指定 → 預設 feature

    expect(body.views.find((v) => v.name === 'trend')?.kind).toBe('trend');
    expect(body.views.find((v) => v.name === 'intent_distribution')?.kind).toBe('chart');
    expect(body.views.find((v) => v.name === 'cpc_histogram')?.kind).toBe('chart');
    expect(body.views.find((v) => v.name === 'serp_questions')?.requiresFeature).toBe('serp');
    expect(body.views.find((v) => v.name === 'intent_topics')?.requiresFeature).toBe('topics');
  });
});
