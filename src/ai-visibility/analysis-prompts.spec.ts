import {
  BRAND_EXTRACTION_SYSTEM_PROMPT,
  buildBrandExtractionMessages,
} from './brand-extraction.prompt';
import { SENTIMENT_SYSTEM_PROMPT_PREFIX, buildSentimentMessages } from './sentiment.prompt';
import {
  MEDIA_CLASSIFIER_SYSTEM_PROMPT,
  buildMediaClassifierMessages,
} from './media-classifier.prompt';
import { MEDIA_TYPES } from './media-classifier.schema';
import { UNTRUSTED_CONTENT_BEGIN, UNTRUSTED_CONTENT_END } from './injection-isolation';

/**
 * TC-78 (部分) / FR-42 / NFR-19 — 搬移的三線 prompt（品牌抽取 / 情緒 / 引用媒體分類）：業務規則（S17）忠實搬移
 * + 不可信第三方內容一律經注入隔離 wrapper（結構化訊息 + 邊界，不拼進指令）。
 */
describe('TC-78: brand-extraction prompt (extract-brands-from-text-blocks)', () => {
  // 用獨特 sentinel 當不可信內容，避免與 prompt 自身的範例文字碰撞（真證隔離而非巧合）。
  const SENTINEL = 'ZZ_UNTRUSTED_BLOCK_品牌哨兵_9Q7';
  const blocks = [{ id: 'b1', snippets: [SENTINEL] }];

  it('preserves the S17 no-dedup / exposure-count business rule', () => {
    expect(BRAND_EXTRACTION_SYSTEM_PROMPT).toContain('露出次數');
    expect(BRAND_EXTRACTION_SYSTEM_PROMPT).toContain('不要去重');
  });

  it('routes the untrusted blocks through the isolation wrapper (system rules, user data)', () => {
    const msgs = buildBrandExtractionMessages(blocks);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain(BRAND_EXTRACTION_SYSTEM_PROMPT);
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain(UNTRUSTED_CONTENT_BEGIN);
    expect(msgs[1].content).toContain(UNTRUSTED_CONTENT_END);
    expect(msgs[1].content).toContain(SENTINEL);
    // 不可信內容不得出現在 system 指令。
    expect(msgs[0].content).not.toContain(SENTINEL);
  });
});

describe('TC-78: sentiment prompt (aio-brand-sentiment-batch-analyzer)', () => {
  const brand = { name: 'ASUS', aliases: ['華碩'] };
  const textBlocks = [{ id: 't1', text: 'iphone 功能齊全很方便，但價格太高不划算' }];

  it('preserves the S17 both-+1 (mixed sentiment) business rule', () => {
    expect(SENTIMENT_SYSTEM_PROMPT_PREFIX).toContain('positive');
    expect(SENTIMENT_SYSTEM_PROMPT_PREFIX).toContain('negative');
    expect(SENTIMENT_SYSTEM_PROMPT_PREFIX).toContain('褒貶混合');
  });

  it('injects the first-party brand name + aliases into the instruction (trusted), data isolated', () => {
    const msgs = buildSentimentMessages(brand, textBlocks);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('ASUS');
    expect(msgs[0].content).toContain('華碩');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain(UNTRUSTED_CONTENT_BEGIN);
    expect(msgs[1].content).toContain('功能齊全');
    expect(msgs[0].content).not.toContain('功能齊全');
  });
});

describe('TC-78: media-classifier prompt (url-media-classifier)', () => {
  const references = [{ id: 'r1', link: 'https://momo.com.tw/goods' }];

  it('lists all nine media-type enum values and the domain-only rule', () => {
    for (const t of MEDIA_TYPES) {
      expect(MEDIA_CLASSIFIER_SYSTEM_PROMPT).toContain(t);
    }
    expect(MEDIA_CLASSIFIER_SYSTEM_PROMPT.toLowerCase()).toContain('domain');
  });

  it('routes untrusted references through the isolation wrapper', () => {
    const msgs = buildMediaClassifierMessages(references);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toContain(MEDIA_CLASSIFIER_SYSTEM_PROMPT);
    expect(msgs[1].content).toContain(UNTRUSTED_CONTENT_BEGIN);
    expect(msgs[1].content).toContain('momo.com.tw');
    expect(msgs[0].content).not.toContain('momo.com.tw');
  });
});
