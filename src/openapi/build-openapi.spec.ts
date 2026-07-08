import type { INestApplication } from '@nestjs/common';
import { buildOpenApiDocument, serializeOpenApi } from './build-openapi';
import { createOpenApiApp } from './create-openapi-app';

/**
 * TC-55 部分（FR-22）：OpenAPI 產出——含所有 `/api/v1` 端點 + SSE event schema、且**決定性**
 * （兩次序列化 byte 相同 → drift-safe、前端 codegen 穩定）。以 preview app 反射，不連任何外部資源。
 */
const BUSINESS_PATHS = [
  '/api/v1/keyword-analyses',
  '/api/v1/keyword-analyses/{id}',
  '/api/v1/keyword-analyses/{id}/stream',
  '/api/v1/keyword-analyses/{id}/keywords',
  '/api/v1/keyword-analyses/{id}/query',
  '/api/v1/keyword-analyses/{id}/topics',
  '/api/v1/keyword-analyses/{id}/topics/stream',
];

describe('TC-55: OpenAPI 產出（FR-22）', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createOpenApiApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('含所有 /api/v1 業務端點（/health 不掛前綴），method 正確', () => {
    const doc = buildOpenApiDocument(app);
    const paths = Object.keys(doc.paths);

    for (const p of BUSINESS_PATHS) {
      expect(paths).toContain(p);
    }
    expect(paths).toContain('/health'); // @Public、不掛 /api/v1 前綴
    expect(paths).not.toContain('/api/v1/health');

    expect(doc.paths['/api/v1/keyword-analyses'].post).toBeDefined();
    expect(doc.paths['/api/v1/keyword-analyses/{id}'].get).toBeDefined();
    expect(doc.paths['/api/v1/keyword-analyses/{id}'].delete).toBeDefined();
    expect(doc.paths['/api/v1/keyword-analyses/{id}/query'].post).toBeDefined();
  });

  it('SSE event schema 註冊於 components.schemas（progress/completed/failed）', () => {
    const doc = buildOpenApiDocument(app);
    const schemas = doc.components?.schemas ?? {};

    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining(['SseProgressEventDto', 'SseCompletedEventDto', 'SseFailedEventDto']),
    );
  });

  it('宣告 x-api-key 安全定義', () => {
    const doc = buildOpenApiDocument(app);
    expect(doc.components?.securitySchemes?.['x-api-key']).toMatchObject({
      type: 'apiKey',
      name: 'x-api-key',
      in: 'header',
    });
  });

  it('決定性：兩次序列化 byte 相同 + 頂層 key canonical 排序', () => {
    const first = serializeOpenApi(buildOpenApiDocument(app));
    const second = serializeOpenApi(buildOpenApiDocument(app));

    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(first) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
  });
});
