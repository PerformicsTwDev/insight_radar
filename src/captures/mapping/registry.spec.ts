import { mapAiCapture } from './ai-mapper';
import type { MapperInput } from './canonical.types';
import { createDefaultRegistry, MapperRegistry, normalize, type Mapper } from './registry';
import { mapSocialPost } from './social-mapper';

const capturedAt = new Date('2025-11-21T00:00:00.000Z');
const stubMapper: Mapper = (input) => ({
  mapStatus: 'ok',
  canonical: null,
  raw: input.payload,
  reasons: [],
});

describe('MapperRegistry (T13.4 / FR-37 registry：key=(source,discriminator,schemaVersion) / TC-73)', () => {
  it('exact-version 註冊與解析', () => {
    const r = new MapperRegistry();
    r.register({ source: 'extension', discriminator: 'chatGpt', schemaVersion: 'v1' }, stubMapper);
    expect(r.resolve('extension', 'chatGpt', 'v1')).toBe(stubMapper);
    expect(r.resolve('extension', 'chatGpt', 'v2')).toBeUndefined();
  });

  it('wildcard schemaVersion（骨架 line-level 預設）→ 任一版本 fallback', () => {
    const r = new MapperRegistry();
    r.register({ source: 'extension', discriminator: 'chatGpt' }, stubMapper);
    expect(r.resolve('extension', 'chatGpt', 'anyVersion')).toBe(stubMapper);
  });

  it('exact-version 優先於 wildcard', () => {
    const wild: Mapper = stubMapper;
    const exact: Mapper = (input) => ({
      mapStatus: 'partial',
      canonical: null,
      raw: input.payload,
      reasons: [],
    });
    const r = new MapperRegistry();
    r.register({ source: 'extension', discriminator: 'chatGpt' }, wild);
    r.register({ source: 'extension', discriminator: 'chatGpt', schemaVersion: 'v2' }, exact);
    expect(r.resolve('extension', 'chatGpt', 'v2')).toBe(exact);
    expect(r.resolve('extension', 'chatGpt', 'v9')).toBe(wild);
  });

  it('未知 key → undefined（明確無 mapper）', () => {
    const r = new MapperRegistry();
    expect(r.resolve('extension', 'unknownChan', 'v1')).toBeUndefined();
  });
});

describe('createDefaultRegistry (T13.4 / 骨架分派 / TC-73)', () => {
  const r = createDefaultRegistry();

  it('AI 渠道（extension/serpapi）→ mapAiCapture', () => {
    expect(r.resolve('extension', 'chatGpt', 'v1')).toBe(mapAiCapture);
    expect(r.resolve('extension', 'googleAiMode', 'v1')).toBe(mapAiCapture);
    expect(r.resolve('serpapi', 'aiOverview', 'v1')).toBe(mapAiCapture);
  });

  it('Social 平台（extension/threadsApi）→ mapSocialPost', () => {
    expect(r.resolve('extension', 'threads', 'v1')).toBe(mapSocialPost);
    expect(r.resolve('extension', 'customDomain', 'v1')).toBe(mapSocialPost);
    expect(r.resolve('threadsApi', 'threads', 'v1')).toBe(mapSocialPost);
  });
});

describe('normalize (T13.4 / AC-37.1/37.4 分派 + 韌性 / TC-73)', () => {
  it('依 channel 分派 AI 線（產出 AiSearchCapture 形狀）', () => {
    const result = normalize({
      source: 'extension',
      channel: 'chatGpt',
      schemaVersion: 'v1',
      payload: { query: 'q', blocks: ['a'] },
      capturedAt,
    });
    expect(result.mapStatus).toBe('ok');
    expect(result.canonical).toMatchObject({ channel: 'chatGpt', query: 'q' });
  });

  it('依 platform 分派 Social 線（產出 SocialPost 形狀）', () => {
    const result = normalize({
      source: 'extension',
      platform: 'threads',
      schemaVersion: 'v1',
      payload: { content: 'x', permalink: 'https://a/b' },
      capturedAt,
    });
    expect(result.mapStatus).toBe('ok');
    expect(result.canonical).toMatchObject({ platform: 'threads', content: 'x' });
  });

  it('缺 discriminator（無 channel/platform）→ failed（不拋、raw 保留）', () => {
    const payload = { content: 'x' };
    const result = normalize({ source: 'extension', schemaVersion: 'v1', payload, capturedAt });
    expect(result.mapStatus).toBe('failed');
    expect(result.reasons).toContain('missing_discriminator');
    expect(result.raw).toBe(payload);
  });

  it('channel 與 platform 同時給 → failed（ambiguous_discriminator）', () => {
    const result = normalize({
      source: 'extension',
      channel: 'chatGpt',
      platform: 'threads',
      schemaVersion: 'v1',
      payload: {},
      capturedAt,
    });
    expect(result.mapStatus).toBe('failed');
    expect(result.reasons).toContain('ambiguous_discriminator');
  });

  it('未註冊 mapper → failed（no_mapper_registered，不拋）', () => {
    const result = normalize(
      {
        source: 'extension',
        channel: 'chatGpt',
        schemaVersion: 'v1',
        payload: { query: 'q' },
        capturedAt,
      },
      new MapperRegistry(),
    );
    expect(result.mapStatus).toBe('failed');
    expect(result.reasons).toContain('no_mapper_registered');
  });

  it('同批一筆失敗不阻斷他筆（AC-37.4：逐筆獨立、無 throw）', () => {
    const batch: MapperInput[] = [
      {
        source: 'extension',
        channel: 'chatGpt',
        schemaVersion: 'v1',
        payload: { query: 'q', blocks: ['a'] },
        capturedAt,
      },
      { source: 'extension', schemaVersion: 'v1', payload: { bad: true }, capturedAt },
    ];
    const results = batch.map((item) => normalize(item));
    expect(results[0].mapStatus).toBe('ok');
    expect(results[1].mapStatus).toBe('failed');
  });
});
