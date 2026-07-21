import { LengthFinishReasonError } from 'openai/core/error';
import type { BrandAliasInput } from '../brand-profile/brand-match';
import type {
  IntentLabeler,
  ParseChatParams,
  ParseChatResult,
} from '../intent/intent-labeler.port';
import { UNTRUSTED_CONTENT_BEGIN, UNTRUSTED_CONTENT_END } from './injection-isolation';
import type { LlmBatchConfig } from './llm-batch-pipeline';
import type { SentimentResult } from './sentiment.schema';
import { SentimentService } from './sentiment.service';

/** 從隔離後的 user 訊息還原 LLM 實際收到的 blocks（驗證未直接拼進指令、經邊界包夾）。 */
function blocksOf(params: ParseChatParams): Array<{ id: string; text: string }> {
  const userMsg = params.messages.find((m) => m.role === 'user');
  const match = userMsg?.content.match(/\[[\s\S]*\]/);
  return match ? (JSON.parse(match[0]) as Array<{ id: string; text: string }>) : [];
}

interface BuildOpts {
  batchSize?: number;
  /** 依收到的 blocks 決定該批回應（預設：每 block 回褒貶混合 {1,1}）。 */
  behave?: (blocks: Array<{ id: string; text: string }>) => ParseChatResult<SentimentResult>;
}

function build(opts: BuildOpts = {}): {
  service: SentimentService;
  batches: Array<Array<{ id: string; text: string }>>;
  params: ParseChatParams[];
} {
  const behave =
    opts.behave ??
    ((blocks): ParseChatResult<SentimentResult> => ({
      parsed: { results: blocks.map((b) => ({ id: b.id, positive: 1, negative: 1 })) },
      refusal: null,
    }));
  const batches: Array<Array<{ id: string; text: string }>> = [];
  const params: ParseChatParams[] = [];
  const parseChat = jest.fn((p: ParseChatParams) => {
    params.push(p);
    const blocks = blocksOf(p);
    batches.push(blocks);
    return Promise.resolve(behave(blocks) as ParseChatResult<unknown>);
  });
  const labeler = { parseChat } as unknown as IntentLabeler;
  const config: LlmBatchConfig = { batchSize: opts.batchSize ?? 30 };
  return { service: new SentimentService(labeler, config), batches, params };
}

const brand: BrandAliasInput = { name: 'ASUS', aliases: ['華碩'] };
const block = (id: string): { id: string; text: string } => ({ id, text: `text-${id}` });

describe('TC-78: SentimentService (AI 回答品牌情緒——褒貶各+1 + 注入隔離 + 韌性)', () => {
  it('空輸入 → 空輸出、不呼叫 LLM', async () => {
    const { service, params } = build();
    await expect(service.analyzeSentiment(brand, [])).resolves.toEqual([]);
    expect(params).toHaveLength(0);
  });

  it('經 T15.1 隔離 wrapper 送 LLM：system 規則 + 邊界包夾的 user data（不直接拼指令，S19/NFR-19）', async () => {
    const { service, params } = build();
    await service.analyzeSentiment(brand, [block('b0')]);

    expect(params).toHaveLength(1);
    const msgs = params[0].messages;
    expect(msgs[0].role).toBe('system');
    const userMsg = msgs.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain(UNTRUSTED_CONTENT_BEGIN);
    expect(userMsg?.content).toContain(UNTRUSTED_CONTENT_END);
    expect(msgs[0].content).not.toContain('text-b0'); // blocks 不在 system 指令內
  });

  it('目標品牌（name+aliases）注入 system 第一方語境（可信、非 user 不可信資料區）', async () => {
    const { service, params } = build();
    await service.analyzeSentiment(brand, [block('b0')]);
    const sys = params[0].messages[0];
    expect(sys.role).toBe('system');
    expect(sys.content).toContain('ASUS'); // 目標品牌名進 system 規則
  });

  it('用固定 strict brand_sentiment json_schema + temperature=0', async () => {
    const { service, params } = build();
    await service.analyzeSentiment(brand, [block('b0')]);
    expect(params[0].jsonSchema.name).toBe('brand_sentiment');
    expect(params[0].temperature).toBe(0);
    expect(params[0].maxCompletionTokens).toBeGreaterThan(0);
  });

  it('依 batchSize 切批（>batchSize 分多批送）', async () => {
    const { service, batches } = build({ batchSize: 2 });
    const blocks = ['b0', 'b1', 'b2', 'b3', 'b4'].map(block);
    await service.analyzeSentiment(brand, blocks);
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  describe('S17 褒貶各+1（端到端，業務規則不可「修正」）', () => {
    it('LLM 回褒貶混合 → 服務保留 positive=1 且 negative=1（不 collapse）', async () => {
      const { service } = build({
        behave: (blocks) => ({
          parsed: { results: blocks.map((b) => ({ id: b.id, positive: 1, negative: 1 })) },
          refusal: null,
        }),
      });
      const out = await service.analyzeSentiment(brand, [block('b0')]);
      expect(out).toEqual([{ id: 'b0', positive: 1, negative: 1 }]);
    });
  });

  describe('韌性（複用共用 resilientChunk：length 拆批 / refusal fallback，部分失敗不污染他筆）', () => {
    it('length error → 該批對半拆再打（沿用共用骨架）', async () => {
      const { service, batches } = build({
        batchSize: 4,
        behave: (blocks) => {
          if (blocks.length > 2) throw new LengthFinishReasonError();
          return {
            parsed: { results: blocks.map((b) => ({ id: b.id, positive: 1, negative: 1 })) },
            refusal: null,
          };
        },
      });
      const out = await service.analyzeSentiment(brand, ['b0', 'b1', 'b2', 'b3'].map(block));
      expect(out).toEqual([
        { id: 'b0', positive: 1, negative: 1 },
        { id: 'b1', positive: 1, negative: 1 },
        { id: 'b2', positive: 1, negative: 1 },
        { id: 'b3', positive: 1, negative: 1 },
      ]);
      expect(batches[0]).toHaveLength(4);
      expect(batches.slice(1).map((b) => b.length)).toEqual([2, 2]);
    });

    it('refusal → 該批 blocks 補 {0,0}，不污染他批', async () => {
      const { service } = build({
        batchSize: 1,
        behave: (blocks) => {
          if (blocks[0].id === 'bad') {
            return { parsed: null, refusal: 'no' };
          }
          return {
            parsed: { results: blocks.map((b) => ({ id: b.id, positive: 1, negative: 0 })) },
            refusal: null,
          };
        },
      });
      const out = await service.analyzeSentiment(brand, [block('good'), block('bad')]);
      expect(out).toEqual([
        { id: 'good', positive: 1, negative: 0 },
        { id: 'bad', positive: 0, negative: 0 }, // refusal → {0,0}（不污染 good）
      ]);
    });
  });
});
