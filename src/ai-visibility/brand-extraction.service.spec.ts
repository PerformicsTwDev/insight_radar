import { LengthFinishReasonError } from 'openai/core/error';
import type { BrandAliasInput } from '../brand-profile/brand-match';
import type {
  IntentLabeler,
  ParseChatParams,
  ParseChatResult,
} from '../intent/intent-labeler.port';
import { UNTRUSTED_CONTENT_BEGIN, UNTRUSTED_CONTENT_END } from './injection-isolation';
import type { BrandExtractionResult } from './brand-extraction.schema';
import {
  type BrandExtractionServiceConfig,
  BrandExtractionService,
} from './brand-extraction.service';

/** LLM 回應形狀：`{results:[{id,brands}]}`。 */
type BrandBatch = BrandExtractionResult;

/** 從隔離後的 user 訊息還原 LLM 實際收到的 blocks（驗證未直接拼進指令、經邊界包夾）。 */
function blocksOf(params: ParseChatParams): Array<{ id: string; text: string }> {
  const userMsg = params.messages.find((m) => m.role === 'user');
  const match = userMsg?.content.match(/\[[\s\S]*\]/);
  return match ? (JSON.parse(match[0]) as Array<{ id: string; text: string }>) : [];
}

interface BuildOpts {
  batchSize?: number;
  llmConcurrency?: number;
  /** 依收到的 blocks 決定該批回應（預設：每 block 回一個以 id 命名的品牌）。 */
  behave?: (blocks: Array<{ id: string; text: string }>) => ParseChatResult<BrandBatch>;
}

function build(opts: BuildOpts = {}): {
  service: BrandExtractionService;
  batches: Array<Array<{ id: string; text: string }>>;
  params: ParseChatParams[];
} {
  const behave =
    opts.behave ??
    ((blocks): ParseChatResult<BrandBatch> => ({
      parsed: { results: blocks.map((b) => ({ id: b.id, brands: [`brand-${b.id}`] })) },
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
  const config: BrandExtractionServiceConfig = {
    batchSize: opts.batchSize ?? 30,
    llmConcurrency: opts.llmConcurrency,
  };
  return { service: new BrandExtractionService(labeler, config), batches, params };
}

const block = (id: string): { id: string; text: string } => ({ id, text: `text-${id}` });

describe('TC-78: BrandExtractionService (AI 回答品牌抽取——不去重 + aliases + 注入隔離)', () => {
  it('空輸入 → 空輸出、不呼叫 LLM', async () => {
    const { service, params } = build();
    await expect(service.extractBrands([])).resolves.toEqual([]);
    expect(params).toHaveLength(0);
  });

  it('經 T15.1 隔離 wrapper 送 LLM：system 規則 + 邊界包夾的 user data（不直接拼指令，S19/NFR-19）', async () => {
    const { service, params } = build();
    await service.extractBrands([block('b0')]);

    expect(params).toHaveLength(1);
    const msgs = params[0].messages;
    expect(msgs[0].role).toBe('system');
    // 不可信 blocks 落在**獨立** user 訊息、以邊界標記包夾（非拼進 system 指令尾）。
    const userMsg = msgs.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain(UNTRUSTED_CONTENT_BEGIN);
    expect(userMsg?.content).toContain(UNTRUSTED_CONTENT_END);
    expect(msgs[0].content).not.toContain('text-b0'); // blocks 不在 system 指令內
  });

  it('用固定 strict brand_extraction json_schema + temperature=0', async () => {
    const { service, params } = build();
    await service.extractBrands([block('b0')]);
    expect(params[0].jsonSchema.name).toBe('brand_extraction');
    expect(params[0].temperature).toBe(0);
    expect(params[0].maxCompletionTokens).toBeGreaterThan(0);
  });

  it('依 batchSize 切批（>batchSize 分多批送）', async () => {
    const { service, batches } = build({ batchSize: 2 });
    const blocks = ['b0', 'b1', 'b2', 'b3', 'b4'].map(block);
    await service.extractBrands(blocks);
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  describe('S17 不去重＝露出次數（端到端，業務規則不可「修正」）', () => {
    it('LLM 對某 block 回同品牌多次 → 服務保留多次（非去重）', async () => {
      const { service } = build({
        behave: (blocks) => ({
          parsed: { results: blocks.map((b) => ({ id: b.id, brands: ['Apple', 'Apple'] })) },
          refusal: null,
        }),
      });
      const out = await service.extractBrands([block('b0')]);
      expect(out).toEqual([{ id: 'b0', brands: ['Apple', 'Apple'] }]);
    });
  });

  describe('aliases 正規化（華碩→ASUS 以 BrandProfile.aliases）', () => {
    const profile: BrandAliasInput[] = [{ name: 'ASUS', aliases: ['華碩'] }];

    it('傳入 profile → 抽出的 華碩 正規化為 ASUS（且不去重）', async () => {
      const { service } = build({
        behave: (blocks) => ({
          parsed: { results: blocks.map((b) => ({ id: b.id, brands: ['華碩', '華碩'] })) },
          refusal: null,
        }),
      });
      const out = await service.extractBrands([block('b0')], profile);
      expect(out).toEqual([{ id: 'b0', brands: ['ASUS', 'ASUS'] }]);
    });

    it('未傳 profile → 華碩 原樣保留、不崩（demo/空品牌集，AC-40.3）', async () => {
      const { service } = build({
        behave: (blocks) => ({
          parsed: { results: blocks.map((b) => ({ id: b.id, brands: ['華碩'] })) },
          refusal: null,
        }),
      });
      const out = await service.extractBrands([block('b0')]);
      expect(out).toEqual([{ id: 'b0', brands: ['華碩'] }]);
    });
  });

  describe('韌性（複用 M2 resilientChunk：length 拆批 / refusal fallback，部分失敗不污染他筆）', () => {
    it('length error → 該批對半拆再打（沿用 intent 骨架）', async () => {
      const { service, batches } = build({
        batchSize: 4,
        behave: (blocks) => {
          if (blocks.length > 2) throw new LengthFinishReasonError();
          return {
            parsed: { results: blocks.map((b) => ({ id: b.id, brands: [`brand-${b.id}`] })) },
            refusal: null,
          };
        },
      });
      const out = await service.extractBrands(['b0', 'b1', 'b2', 'b3'].map(block));
      expect(out).toEqual([
        { id: 'b0', brands: ['brand-b0'] },
        { id: 'b1', brands: ['brand-b1'] },
        { id: 'b2', brands: ['brand-b2'] },
        { id: 'b3', brands: ['brand-b3'] },
      ]);
      // 首批 4 個 throw → 對半 [2,2]。
      expect(batches[0]).toHaveLength(4);
      expect(batches.slice(1).map((b) => b.length)).toEqual([2, 2]);
    });

    it('refusal → 該批 blocks 補空品牌集，不污染他批', async () => {
      const { service } = build({
        batchSize: 1,
        behave: (blocks) => {
          if (blocks[0].id === 'bad') {
            return { parsed: null, refusal: 'no' };
          }
          return {
            parsed: { results: blocks.map((b) => ({ id: b.id, brands: ['Apple'] })) },
            refusal: null,
          };
        },
      });
      const out = await service.extractBrands([block('good'), block('bad')]);
      expect(out).toEqual([
        { id: 'good', brands: ['Apple'] },
        { id: 'bad', brands: [] }, // refusal → 空（不污染 good）
      ]);
    });
  });
});
