import { LengthFinishReasonError } from 'openai/core/error';
import type {
  IntentLabeler,
  ParseChatParams,
  ParseChatResult,
} from '../intent/intent-labeler.port';
import { UNTRUSTED_CONTENT_BEGIN, UNTRUSTED_CONTENT_END } from './injection-isolation';
import type { LlmBatchConfig } from './llm-batch-pipeline';
import type { MediaClassifierResult } from './media-classifier.schema';
import { MediaClassifierService } from './media-classifier.service';

/** 從隔離後的 user 訊息還原 LLM 實際收到的 references（驗證未直接拼進指令、經邊界包夾）。 */
function refsOf(params: ParseChatParams): Array<{ id: string; link: string }> {
  const userMsg = params.messages.find((m) => m.role === 'user');
  const match = userMsg?.content.match(/\[[\s\S]*\]/);
  return match ? (JSON.parse(match[0]) as Array<{ id: string; link: string }>) : [];
}

interface BuildOpts {
  batchSize?: number;
  /** 依收到的 references 決定該批回應（預設：每 ref 回 news）。注意 media schema 用 `references` 陣列鍵。 */
  behave?: (refs: Array<{ id: string; link: string }>) => ParseChatResult<MediaClassifierResult>;
}

function build(opts: BuildOpts = {}): {
  service: MediaClassifierService;
  batches: Array<Array<{ id: string; link: string }>>;
  params: ParseChatParams[];
} {
  const behave =
    opts.behave ??
    ((refs): ParseChatResult<MediaClassifierResult> => ({
      parsed: { references: refs.map((r) => ({ id: r.id, type: 'news' as const })) },
      refusal: null,
    }));
  const batches: Array<Array<{ id: string; link: string }>> = [];
  const params: ParseChatParams[] = [];
  const parseChat = jest.fn((p: ParseChatParams) => {
    params.push(p);
    const refs = refsOf(p);
    batches.push(refs);
    return Promise.resolve(behave(refs) as ParseChatResult<unknown>);
  });
  const labeler = { parseChat } as unknown as IntentLabeler;
  const config: LlmBatchConfig = { batchSize: opts.batchSize ?? 30 };
  return { service: new MediaClassifierService(labeler, config), batches, params };
}

const ref = (id: string): { id: string; link: string } => ({ id, link: `https://${id}.example/p` });

describe('TC-78: MediaClassifierService (AI 回答引用媒體分類——9-enum + 注入隔離 + 韌性)', () => {
  it('空輸入 → 空輸出、不呼叫 LLM', async () => {
    const { service, params } = build();
    await expect(service.classifyMedia([])).resolves.toEqual([]);
    expect(params).toHaveLength(0);
  });

  it('經 T15.1 隔離 wrapper 送 LLM：system 規則 + 邊界包夾的 user data（不直接拼指令，S19/NFR-19）', async () => {
    const { service, params } = build();
    await service.classifyMedia([ref('r0')]);

    expect(params).toHaveLength(1);
    const msgs = params[0].messages;
    expect(msgs[0].role).toBe('system');
    const userMsg = msgs.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain(UNTRUSTED_CONTENT_BEGIN);
    expect(userMsg?.content).toContain(UNTRUSTED_CONTENT_END);
    expect(msgs[0].content).not.toContain('r0.example'); // references 不在 system 指令內
  });

  it('用固定 strict media_classification json_schema + temperature=0', async () => {
    const { service, params } = build();
    await service.classifyMedia([ref('r0')]);
    expect(params[0].jsonSchema.name).toBe('media_classification');
    expect(params[0].temperature).toBe(0);
    expect(params[0].maxCompletionTokens).toBeGreaterThan(0);
  });

  it('依 batchSize 切批（>batchSize 分多批送）', async () => {
    const { service, batches } = build({ batchSize: 2 });
    const refs = ['r0', 'r1', 'r2', 'r3', 'r4'].map(ref);
    await service.classifyMedia(refs);
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  describe('9 類 enum 映射（端到端）', () => {
    it('各 domain → 對應 9-enum（LLM 回各類，服務原樣輸出）', async () => {
      const types = [
        'ecommerce',
        'retail',
        'review',
        'news',
        'content',
        'blog',
        'social',
        'gov',
        'other',
      ] as const;
      const { service } = build({
        behave: (refs) => ({
          parsed: { references: refs.map((r) => ({ id: r.id, type: r.id as never })) },
          refusal: null,
        }),
      });
      const out = await service.classifyMedia(types.map((t) => ref(t)));
      expect(out).toEqual(types.map((t) => ({ id: t, type: t })));
    });

    it('LLM 回非 enum 值 → 收斂為 other（驗證邊界，不污染下游 enum）', async () => {
      const { service } = build({
        behave: (refs) => ({
          parsed: { references: refs.map((r) => ({ id: r.id, type: 'wikipedia' as never })) },
          refusal: null,
        }),
      });
      const out = await service.classifyMedia([ref('r0')]);
      expect(out).toEqual([{ id: 'r0', type: 'other' }]);
    });
  });

  describe('韌性（複用共用 resilientChunk：length 拆批 / refusal fallback，部分失敗不污染他筆）', () => {
    it('length error → 該批對半拆再打（沿用共用骨架）', async () => {
      const { service, batches } = build({
        batchSize: 4,
        behave: (refs) => {
          if (refs.length > 2) throw new LengthFinishReasonError();
          return {
            parsed: { references: refs.map((r) => ({ id: r.id, type: 'blog' as const })) },
            refusal: null,
          };
        },
      });
      const out = await service.classifyMedia(['r0', 'r1', 'r2', 'r3'].map(ref));
      expect(out).toEqual([
        { id: 'r0', type: 'blog' },
        { id: 'r1', type: 'blog' },
        { id: 'r2', type: 'blog' },
        { id: 'r3', type: 'blog' },
      ]);
      expect(batches[0]).toHaveLength(4);
      expect(batches.slice(1).map((b) => b.length)).toEqual([2, 2]);
    });

    it('refusal → 該批 refs 補 other，不污染他批', async () => {
      const { service } = build({
        batchSize: 1,
        behave: (refs) => {
          if (refs[0].id === 'bad') {
            return { parsed: null, refusal: 'no' };
          }
          return {
            parsed: { references: refs.map((r) => ({ id: r.id, type: 'news' as const })) },
            refusal: null,
          };
        },
      });
      const out = await service.classifyMedia([ref('good'), ref('bad')]);
      expect(out).toEqual([
        { id: 'good', type: 'news' },
        { id: 'bad', type: 'other' }, // refusal → other（不污染 good）
      ]);
    });
  });
});
