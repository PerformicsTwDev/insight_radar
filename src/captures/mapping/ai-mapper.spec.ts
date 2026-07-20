import type { MapperInput } from './canonical.types';
import { mapAiCapture } from './ai-mapper';

const capturedAt = new Date('2025-11-21T00:00:00.000Z');

function aiInput(payload: unknown, overrides: Partial<MapperInput> = {}): MapperInput {
  return {
    source: 'extension',
    channel: 'chatGpt',
    schemaVersion: 'v1',
    payload,
    capturedAt,
    ...overrides,
  };
}

describe('mapAiCapture (T13.4 / FR-37/39 → AiSearchCapture 中立形狀 / TC-73)', () => {
  it('完整代表輸入 → ok，收斂 query/blocks/references + capturedAt(ISO)', () => {
    const result = mapAiCapture(
      aiInput({ query: 'q', blocks: ['a'], references: [{ title: 't', link: 'https://l' }] }),
    );
    expect(result.mapStatus).toBe('ok');
    expect(result.reasons).toEqual([]);
    expect(result.canonical).toEqual({
      source: 'extension',
      channel: 'chatGpt',
      schemaVersion: 'v1',
      query: 'q',
      blocks: ['a'],
      references: [{ title: 't', link: 'https://l', index: 0 }],
      capturedAt: '2025-11-21T00:00:00.000Z',
    });
  });

  it('query alias（keyword）收斂；空 blocks 陣列合法', () => {
    const result = mapAiCapture(aiInput({ keyword: 'k', blocks: [] }));
    expect(result.mapStatus).toBe('ok');
    expect(result.canonical?.query).toBe('k');
    expect(result.canonical?.blocks).toEqual([]);
    expect(result.canonical?.references).toEqual([]);
  });

  it('blocks 字串（answer alias）包成陣列', () => {
    const result = mapAiCapture(aiInput({ query: 'q', answer: 'text' }));
    expect(result.mapStatus).toBe('ok');
    expect(result.canonical?.blocks).toEqual(['text']);
  });

  it('references 跨渠道形狀（sources: {name,url}）收斂為統一形狀', () => {
    const result = mapAiCapture(
      aiInput({ query: 'q', blocks: ['a'], sources: [{ name: 'N', url: 'https://u' }] }),
    );
    expect(result.canonical?.references).toEqual([{ title: 'N', link: 'https://u', index: 0 }]);
  });

  it('缺 query → failed（核心欄缺、canonical null、raw 保留）', () => {
    const payload = { blocks: ['a'] };
    const result = mapAiCapture(aiInput(payload));
    expect(result.mapStatus).toBe('failed');
    expect(result.canonical).toBeNull();
    expect(result.reasons).toContain('missing:query');
    expect(result.raw).toBe(payload);
  });

  it('缺 blocks → partial（核心 query 在、blocks=[]、raw 保留）', () => {
    const result = mapAiCapture(aiInput({ query: 'q' }));
    expect(result.mapStatus).toBe('partial');
    expect(result.reasons).toContain('missing:blocks');
    expect(result.canonical?.blocks).toEqual([]);
  });

  it('未知欄位 → partial（漂移預警），canonical 仍產出', () => {
    const result = mapAiCapture(aiInput({ query: 'q', blocks: ['a'], weirdField: 1 }));
    expect(result.mapStatus).toBe('partial');
    expect(result.reasons).toContain('unknown_field:weirdField');
    expect(result.canonical?.query).toBe('q');
  });

  it('payload 非物件 → failed（payload_not_object、raw 保留）', () => {
    const result = mapAiCapture(aiInput('not-an-object'));
    expect(result.mapStatus).toBe('failed');
    expect(result.canonical).toBeNull();
    expect(result.reasons).toContain('payload_not_object');
    expect(result.raw).toBe('not-an-object');
  });

  it('缺 channel（未經 registry 分派）→ failed', () => {
    const result = mapAiCapture(aiInput({ query: 'q', blocks: ['a'] }, { channel: undefined }));
    expect(result.mapStatus).toBe('failed');
    expect(result.reasons).toContain('missing_channel');
  });
});
