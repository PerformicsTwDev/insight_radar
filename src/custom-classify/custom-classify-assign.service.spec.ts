import type {
  IntentLabeler,
  ParseChatParams,
  ParseChatResult,
} from '../intent/intent-labeler.port';
import type { CustomClassifyAssignCache } from './custom-classify-assign-cache';
import { UNCLASSIFIED_LABEL } from './custom-classify-assign.schema';
import type { CustomAssignBatch } from './custom-classify-assign.schema';
import {
  CustomClassifyAssignService,
  type CustomClassifyAssignConfig,
} from './custom-classify-assign.service';

const CID = 'cid-1';
const LABELS = [
  { label: 'transactional', description: 'buy' },
  { label: 'informational', description: 'research' },
];

function ok(
  results: Array<{ keyword: string; label: string }>,
): ParseChatResult<CustomAssignBatch> {
  return { parsed: { results }, refusal: null };
}

function build(opts: { config?: CustomClassifyAssignConfig; withCache?: boolean } = {}): {
  service: CustomClassifyAssignService;
  parseChat: jest.Mock<Promise<ParseChatResult<CustomAssignBatch>>, [ParseChatParams]>;
  mget: jest.Mock;
  mset: jest.Mock;
} {
  const parseChat = jest.fn<Promise<ParseChatResult<CustomAssignBatch>>, [ParseChatParams]>();
  const labeler = { parseChat } as unknown as IntentLabeler;

  const mget = jest.fn().mockResolvedValue(undefined);
  const mset = jest.fn().mockResolvedValue(undefined);
  const cache = opts.withCache
    ? ({ mget, mset } as unknown as CustomClassifyAssignCache)
    : undefined;

  const service = new CustomClassifyAssignService(
    labeler,
    opts.config ?? { batchSize: 30, llmConcurrency: 6 },
    cache,
  );
  return { service, parseChat, mget, mset };
}

describe('CustomClassifyAssignService (T12.8 / FR-34 / AC-34.2 / TC-70 部分)', () => {
  it('returns [] for empty input without calling the LLM', async () => {
    const { service, parseChat } = build();
    expect(await service.classifyByLabels(CID, LABELS, [])).toEqual([]);
    expect(parseChat).not.toHaveBeenCalled();
  });

  it('falls back to the default batch size when configured with an invalid (non-positive) value', async () => {
    // batchSize 0 → sanitizePositiveInt fallback (30); one batch for a small input, still classifies.
    const { service, parseChat } = build({ config: { batchSize: 0 } });
    parseChat.mockResolvedValue(ok([{ keyword: 'a', label: 'transactional' }]));
    const out = await service.classifyByLabels(CID, LABELS, ['a']);
    expect(parseChat).toHaveBeenCalledTimes(1);
    expect(out).toEqual([{ keyword: 'a', label: 'transactional' }]);
  });

  it('classifies via one LLM completion; result count = input count, in order', async () => {
    const { service, parseChat } = build();
    parseChat.mockResolvedValue(
      ok([
        { keyword: 'buy shoes', label: 'transactional' },
        { keyword: 'shoe review', label: 'informational' },
      ]),
    );
    const out = await service.classifyByLabels(CID, LABELS, ['buy shoes', 'shoe review']);
    expect(parseChat).toHaveBeenCalledTimes(1);
    expect(parseChat.mock.calls[0][0].temperature).toBe(0);
    expect(out).toEqual([
      { keyword: 'buy shoes', label: 'transactional' },
      { keyword: 'shoe review', label: 'informational' },
    ]);
  });

  it('maps a gap / non-confirmed label to the unclassified sentinel', async () => {
    const { service, parseChat } = build();
    parseChat.mockResolvedValue(ok([{ keyword: 'a', label: 'made_up' }])); // 'b' omitted
    const out = await service.classifyByLabels(CID, LABELS, ['a', 'b']);
    expect(out).toEqual([
      { keyword: 'a', label: UNCLASSIFIED_LABEL },
      { keyword: 'b', label: UNCLASSIFIED_LABEL },
    ]);
  });

  it('builds a dynamic enum from the confirmed labels (schema carries exactly those labels)', async () => {
    const { service, parseChat } = build();
    parseChat.mockResolvedValue(ok([{ keyword: 'a', label: 'transactional' }]));
    await service.classifyByLabels(CID, LABELS, ['a']);
    const schema = parseChat.mock.calls[0][0].jsonSchema.schema;
    const labelEnum = (
      schema.properties as Record<
        string,
        { items: { properties: Record<string, { enum: string[] }> } }
      >
    ).results.items.properties.label.enum;
    expect(labelEnum).toEqual(['transactional', 'informational']);
  });

  it('splits misses into batches by batchSize', async () => {
    const { service, parseChat } = build({ config: { batchSize: 2 } });
    parseChat.mockImplementation((p) => {
      const content = p.messages.find((m) => m.role === 'user')?.content ?? '';
      const kws = JSON.parse(content.slice(content.indexOf('['))) as string[];
      return Promise.resolve(ok(kws.map((k) => ({ keyword: k, label: 'transactional' }))));
    });
    const out = await service.classifyByLabels(CID, LABELS, ['a', 'b', 'c', 'd', 'e']);
    expect(parseChat).toHaveBeenCalledTimes(3); // ceil(5/2)
    expect(out).toHaveLength(5);
  });

  describe('with cache', () => {
    it('skips the LLM for cache hits and only sends misses', async () => {
      const { service, parseChat, mget, mset } = build({ withCache: true });
      // 'a' hits (transactional), 'b' misses.
      mget.mockResolvedValue(['transactional', undefined]);
      parseChat.mockResolvedValue(ok([{ keyword: 'b', label: 'informational' }]));

      const out = await service.classifyByLabels(CID, LABELS, ['a', 'b']);

      expect(mget).toHaveBeenCalledWith(
        CID,
        expect.any(String), // labelsHash (label + description)
        ['a', 'b'],
        new Set(['transactional', 'informational']),
      );
      expect(parseChat).toHaveBeenCalledTimes(1);
      // only the miss went to the LLM
      expect(parseChat.mock.calls[0][0].messages.find((m) => m.role === 'user')?.content).toContain(
        '"b"',
      );
      expect(out).toEqual([
        { keyword: 'a', label: 'transactional' },
        { keyword: 'b', label: 'informational' },
      ]);
      // writeback the freshly-classified miss
      expect(mset).toHaveBeenCalledWith(
        CID,
        expect.any(String), // labelsHash
        [{ keyword: 'b', label: 'informational' }],
        expect.any(Set),
      );
    });
  });
});
