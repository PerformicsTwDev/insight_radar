// T14.1 · FR-38（AC-38.1/38.2/38.3/38.5）· TC-74 baseline
//
// SerpApi AI 回應 **wire 形狀結構斷言基準**——不呼叫真實 SerpApi（reserved、無憑證），只載入
// `__fixtures__/serp-ai/*` 的 documented-schema fixtures + 斷言關鍵結構，作為 T14.2/T14.3
// `SerpApiAiProvider` adapter 契約測試的 golden 基準（AIO 兩路 + AI Mode）。
//
// ⚠ 本 spec **無 production 邏輯**：只斷言 fixture 資料形狀；兩路判別/解析本體屬 T14.2/T14.3 adapter。
import {
  AIO_PAGE_TOKEN_EXPIRY,
  aiModeV1,
  aiOverviewInlineV1,
  aiOverviewPageTokenStep1V1,
  aiOverviewPageTokenStep2V1,
} from './__fixtures__/serp-ai';
import type {
  SerpApiAiOverview,
  SerpApiAiOverviewInline,
  SerpApiAiReference,
  SerpApiAiTextBlock,
} from './__fixtures__/serp-ai';

const TEXT_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'list',
  'table',
  'code_block',
  'expandable',
  'comparison',
]);

/** 兩路判別（in-test，不外洩 production 判別碼）：內嵌路帶 `text_blocks`、二次抓取路只帶 `page_token`。 */
function isInlineAiOverview(aio: SerpApiAiOverview): aio is SerpApiAiOverviewInline {
  return 'text_blocks' in aio && !('page_token' in aio);
}

/** references 結構斷言：每筆有數字 index、統一 {title,link,snippet,source}（Design §18.3 references 形狀）。 */
function assertReferences(references: readonly SerpApiAiReference[]): void {
  expect(Array.isArray(references)).toBe(true);
  expect(references.length).toBeGreaterThan(0);
  for (const ref of references) {
    expect(typeof ref.index).toBe('number');
    expect(Number.isInteger(ref.index)).toBe(true);
    expect(typeof ref.title).toBe('string');
    expect(ref.title!.length).toBeGreaterThan(0);
    expect(typeof ref.link).toBe('string');
    expect(ref.link).toMatch(/^https?:\/\//);
    expect(typeof ref.source).toBe('string');
  }
}

/** text_blocks 結構斷言 + reference_indexes 完整性（每個 index 必對得到 references[].index）。 */
function assertTextBlocks(
  blocks: readonly SerpApiAiTextBlock[],
  references: readonly SerpApiAiReference[],
): void {
  expect(Array.isArray(blocks)).toBe(true);
  expect(blocks.length).toBeGreaterThan(0);

  const refIndexes = new Set(references.map((r) => r.index));
  const collectRefIndexes: number[] = [];
  let sawParagraph = false;
  let sawList = false;

  for (const block of blocks) {
    expect(TEXT_BLOCK_TYPES.has(block.type)).toBe(true);
    if (block.type === 'paragraph') {
      sawParagraph = true;
      expect(typeof block.snippet).toBe('string');
      expect(block.snippet!.length).toBeGreaterThan(0);
    }
    if (block.type === 'list') {
      sawList = true;
      expect(Array.isArray(block.list)).toBe(true);
      expect(block.list!.length).toBeGreaterThan(0);
      for (const item of block.list!) {
        expect(typeof item.snippet).toBe('string');
        expect(item.snippet!.length).toBeGreaterThan(0);
        for (const idx of item.reference_indexes ?? []) collectRefIndexes.push(idx);
      }
    }
    for (const idx of block.reference_indexes ?? []) collectRefIndexes.push(idx);
  }

  // 樣本應同時涵蓋 paragraph 與 list 兩種主要 block 型別（供 adapter 兩型解析基準）。
  expect(sawParagraph).toBe(true);
  expect(sawList).toBe(true);

  // reference_indexes 完整性：不得指向不存在的 reference（避免 adapter 對空引用臆造）。
  for (const idx of collectRefIndexes) {
    expect(refIndexes.has(idx)).toBe(true);
  }
}

describe('SerpApi AI fixtures — structural baseline (T14.1 / FR-38 / TC-74)', () => {
  describe('AC-38.1 路一 · AI Overview 內嵌（engine=google）', () => {
    it('是內嵌路：ai_overview 直接帶 text_blocks（無需二次抓取）', () => {
      expect(aiOverviewInlineV1.search_parameters?.engine).toBe('google');
      expect(aiOverviewInlineV1.ai_overview).toBeDefined();
      expect(isInlineAiOverview(aiOverviewInlineV1.ai_overview!)).toBe(true);
    });

    it('text_blocks + references 結構完整、reference_indexes 對得到來源', () => {
      const aio = aiOverviewInlineV1.ai_overview as SerpApiAiOverviewInline;
      assertReferences(aio.references);
      assertTextBlocks(aio.text_blocks, aio.references);
    });

    it('AC-38.5：hl=zh-tw / gl=tw', () => {
      expect(aiOverviewInlineV1.search_parameters?.hl).toBe('zh-tw');
      expect(aiOverviewInlineV1.search_parameters?.gl).toBe('tw');
    });
  });

  describe('AC-38.1 路二 · AI Overview page_token 二次抓取', () => {
    it('第一路（engine=google）只回 page_token + serpapi_link、無 text_blocks', () => {
      expect(aiOverviewPageTokenStep1V1.search_parameters?.engine).toBe('google');
      const aio = aiOverviewPageTokenStep1V1.ai_overview!;
      expect(isInlineAiOverview(aio)).toBe(false);
      expect('page_token' in aio).toBe(true);
      if ('page_token' in aio) {
        expect(typeof aio.page_token).toBe('string');
        expect(aio.page_token.length).toBeGreaterThan(0);
        expect(aio.serpapi_link).toContain('engine=google_ai_overview');
        expect(aio.serpapi_link).toContain('page_token=');
        expect('text_blocks' in aio).toBe(false);
      }
    });

    it('page_token <1min 過期語意的結構標記（AC-38.1；SERPAPI_AIO_PAGE_TOKEN_TIMEOUT_MS 基準）', () => {
      expect(AIO_PAGE_TOKEN_EXPIRY.ttlMs).toBe(60_000);
      expect(AIO_PAGE_TOKEN_EXPIRY.ttlMs).toBeLessThanOrEqual(60_000);
    });

    it('第二路（engine=google_ai_overview）以同一 page_token 抓回完整 text_blocks + references', () => {
      expect(aiOverviewPageTokenStep2V1.search_parameters?.engine).toBe('google_ai_overview');
      const step1Aio = aiOverviewPageTokenStep1V1.ai_overview!;
      expect('page_token' in step1Aio).toBe(true);
      if ('page_token' in step1Aio) {
        // 二次抓取須沿用第一路發出的 page_token（token 連續性）。
        expect(aiOverviewPageTokenStep2V1.search_parameters?.page_token).toBe(step1Aio.page_token);
      }
      assertReferences(aiOverviewPageTokenStep2V1.ai_overview.references);
      assertTextBlocks(
        aiOverviewPageTokenStep2V1.ai_overview.text_blocks,
        aiOverviewPageTokenStep2V1.ai_overview.references,
      );
    });
  });

  describe('AC-38.3 · AI Mode（engine=google_ai_mode）', () => {
    it('top-level text_blocks + references + reconstructed_markdown（Design §18.3）', () => {
      expect(aiModeV1.search_parameters?.engine).toBe('google_ai_mode');
      expect(aiModeV1.search_metadata?.status).toBe('Success');
      assertReferences(aiModeV1.references);
      assertTextBlocks(aiModeV1.text_blocks, aiModeV1.references);
      expect(typeof aiModeV1.reconstructed_markdown).toBe('string');
      expect(aiModeV1.reconstructed_markdown!.length).toBeGreaterThan(0);
    });

    it('AC-38.5：hl=zh-tw / gl=tw', () => {
      expect(aiModeV1.search_parameters?.hl).toBe('zh-tw');
      expect(aiModeV1.search_parameters?.gl).toBe('tw');
    });
  });
});
