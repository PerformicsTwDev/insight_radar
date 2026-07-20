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

describe('TC-75: 四渠道 AI mapper 補全 → AiSearchCapture（FR-39 / AC-39.1~39.3）', () => {
  describe('ChatGPT 多輪：ChatGptResponseFormat 凍結為最後一輪（AC-39.2）', () => {
    it('多輪 turns[] → 僅取最後一輪的 answer + references（不串接前輪、不編造）', () => {
      const result = mapAiCapture(
        aiInput(
          {
            query: 'best travel backpack',
            turns: [
              {
                answer: 'Earlier turn: consider the Osprey Farpoint.',
                references: [{ title: 'Osprey', link: 'https://example.com/osprey' }],
              },
              {
                answer: 'Final turn: the Peak Design Travel is the top pick for 2025.',
                references: [{ title: 'Peak Design', link: 'https://example.com/peak' }],
              },
            ],
          },
          { channel: 'chatGpt' },
        ),
      );
      expect(result.mapStatus).toBe('ok');
      expect(result.reasons).toEqual([]);
      expect(result.canonical?.blocks).toEqual([
        'Final turn: the Peak Design Travel is the top pick for 2025.',
      ]);
      expect(result.canonical?.references).toEqual([
        { title: 'Peak Design', link: 'https://example.com/peak', index: 0 },
      ]);
    });

    it('turns 為空陣列 → 退回 top-level answer（可得輪缺，不編造）', () => {
      const result = mapAiCapture(
        aiInput({ query: 'q', answer: 'flat answer', turns: [] }, { channel: 'chatGpt' }),
      );
      expect(result.mapStatus).toBe('ok');
      expect(result.canonical?.blocks).toEqual(['flat answer']);
    });

    it('turns 末元素非物件 → 退回 top-level answer（best-effort，不編造）', () => {
      const result = mapAiCapture(
        aiInput({ query: 'q', answer: 'flat answer', turns: ['garbled'] }, { channel: 'chatGpt' }),
      );
      expect(result.mapStatus).toBe('ok');
      expect(result.canonical?.blocks).toEqual(['flat answer']);
    });
  });

  describe('Gemini grounding 取捨（AC-39.2）', () => {
    it('grounding 缺失（無 sources）→ references=[]（不編造），mapStatus ok', () => {
      const result = mapAiCapture(
        aiInput({ query: 'q', blocks: ['grounded-free answer'] }, { channel: 'geminiApp' }),
      );
      expect(result.mapStatus).toBe('ok');
      expect(result.canonical?.references).toEqual([]);
    });

    it('grounding 命中：Gemini `{name,url}` → 統一 `{title,link,index}`（AC-39.3）', () => {
      const result = mapAiCapture(
        aiInput(
          {
            query: 'q',
            blocks: ['a'],
            sources: [{ name: 'Examine.com', url: 'https://examine.com/x' }],
          },
          { channel: 'geminiApp' },
        ),
      );
      expect(result.canonical?.references).toEqual([
        { title: 'Examine.com', link: 'https://examine.com/x', index: 0 },
      ]);
    });
  });

  describe('per-channel 認得欄位有界（S20；AC-37.4）', () => {
    it('googleAiMode 的 `relatedQuestions` 認得 → ok（不投影進 canonical）', () => {
      const result = mapAiCapture(
        aiInput(
          { query: 'q', blocks: ['a'], relatedQuestions: ['x?', 'y?'] },
          { channel: 'googleAiMode' },
        ),
      );
      expect(result.mapStatus).toBe('ok');
      expect(result.reasons).toEqual([]);
      expect(result.canonical).not.toHaveProperty('relatedQuestions');
    });

    it('googleSearch 的 `organicResults` 認得 → ok（不投影進 canonical）', () => {
      const result = mapAiCapture(
        aiInput(
          {
            q: 'q',
            blocks: ['a'],
            organicResults: [{ position: 1, title: 't', link: 'https://l' }],
          },
          { channel: 'googleSearch' },
        ),
      );
      expect(result.mapStatus).toBe('ok');
      expect(result.reasons).toEqual([]);
      expect(result.canonical).not.toHaveProperty('organicResults');
    });

    it('`relatedQuestions` 於 chatGpt 為未知欄位（白名單不跨渠道外洩）→ partial', () => {
      const result = mapAiCapture(
        aiInput({ query: 'q', answer: 'a', relatedQuestions: ['x?'] }, { channel: 'chatGpt' }),
      );
      expect(result.mapStatus).toBe('partial');
      expect(result.reasons).toContain('unknown_field:relatedQuestions');
    });

    it('`organicResults` 於 googleAiMode 為未知欄位（渠道專屬不互通）→ partial', () => {
      const result = mapAiCapture(
        aiInput(
          { query: 'q', blocks: ['a'], organicResults: [{ position: 1 }] },
          { channel: 'googleAiMode' },
        ),
      );
      expect(result.mapStatus).toBe('partial');
      expect(result.reasons).toContain('unknown_field:organicResults');
    });
  });
});
