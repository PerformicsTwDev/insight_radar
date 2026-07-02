import { ContentFilterFinishReasonError, LengthFinishReasonError } from 'openai/core/error';
import type {
  IntentLabeler,
  ParseChatParams,
  ParseChatResult,
} from '../intent/intent-labeler.port';
import type { RawTopicNaming } from './topic-naming.postprocess';
import type { ClusterToName } from './topic-naming.prompt';
import { TopicNamingService, type TopicNamingConfig } from './topic-naming.service';

type ParseResult = ParseChatResult<RawTopicNaming>;
type ParseMock = jest.Mock<Promise<ParseResult>, [ParseChatParams]>;

function makeService(config: Partial<TopicNamingConfig> = {}): {
  service: TopicNamingService;
  parseChat: ParseMock;
} {
  const parseChat = jest.fn<Promise<ParseResult>, [ParseChatParams]>();
  const labeler = { parseChat } as unknown as IntentLabeler;
  const service = new TopicNamingService(labeler, { batchClusters: 20, ...config });
  return { service, parseChat };
}

function cluster(label: number, reps: string[] = [`kw${label}`]): ClusterToName {
  return {
    clusterLabel: label,
    representativeKeywords: reps,
    clusterVolume: 100,
    keywordCount: reps.length,
  };
}

function topic(name: string, intent = 'informational'): Record<string, unknown> {
  return {
    topic_name: name,
    parent_topic: 'Parent',
    intent_label: intent,
    topic_type: 'head',
    reason: 'because',
  };
}

function ok(topics: Record<string, unknown>[]): ParseResult {
  return { parsed: { topics }, refusal: null };
}

describe('TopicNamingService (T8.7 / TC-44)', () => {
  it('names clusters via strict json_schema (temperature 0), preserving order', async () => {
    const { service, parseChat } = makeService();
    parseChat.mockResolvedValue(
      ok([topic('Espresso', 'commercial'), topic('Login', 'navigational')]),
    );

    const out = await service.nameClusters([cluster(0), cluster(1)]);

    expect(parseChat).toHaveBeenCalledTimes(1);
    const params = parseChat.mock.calls[0][0];
    expect(params.jsonSchema.name).toBe('topic_naming');
    expect(params.temperature).toBe(0);
    expect(params.maxCompletionTokens).toBe(4000);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      clusterLabel: 0,
      topicName: 'Espresso',
      intentLabel: 'commercial',
      degraded: false,
    });
    expect(out[1]).toMatchObject({
      clusterLabel: 1,
      topicName: 'Login',
      intentLabel: 'navigational',
      degraded: false,
    });
  });

  it('cleans an invalid intent_label from the LLM to informational', async () => {
    const { service, parseChat } = makeService();
    parseChat.mockResolvedValue(ok([topic('Beans', 'buy-it-now')]));

    const [naming] = await service.nameClusters([cluster(0)]);

    expect(naming.intentLabel).toBe('informational');
    expect(naming.degraded).toBe(false);
  });

  it('batches clusters by TOPIC_LLM_BATCH_CLUSTERS (one call per batch)', async () => {
    const { service, parseChat } = makeService({ batchClusters: 1 });
    parseChat.mockImplementation((params) => {
      // one cluster per call → echo a single topic
      void params;
      return Promise.resolve(ok([topic('T')]));
    });

    const out = await service.nameClusters([cluster(0), cluster(1), cluster(2)]);

    expect(parseChat).toHaveBeenCalledTimes(3);
    expect(out.map((c) => c.clusterLabel)).toEqual([0, 1, 2]);
  });

  it('falls back the whole batch (degraded) on a count mismatch from the LLM', async () => {
    const { service, parseChat } = makeService();
    parseChat.mockResolvedValue(ok([topic('only-one')])); // 1 topic for 2 clusters

    const out = await service.nameClusters([cluster(0), cluster(1)]);

    expect(parseChat).toHaveBeenCalledTimes(1);
    expect(out.every((c) => c.degraded)).toBe(true);
  });

  it('falls back (degraded) on a refusal', async () => {
    const { service, parseChat } = makeService();
    parseChat.mockResolvedValue({ parsed: null, refusal: 'no' });

    const [naming] = await service.nameClusters([cluster(0, ['seed kw'])]);

    expect(naming).toMatchObject({
      topicName: 'seed kw',
      intentLabel: 'informational',
      degraded: true,
    });
  });

  it('falls back (degraded) on a content_filter error', async () => {
    const { service, parseChat } = makeService();
    parseChat.mockRejectedValue(new ContentFilterFinishReasonError());

    const [naming] = await service.nameClusters([cluster(0)]);

    expect(naming.degraded).toBe(true);
    expect(naming.reason).toContain('content_filter');
  });

  it('splits a batch in half on a length error, then succeeds on the halves', async () => {
    const { service, parseChat } = makeService();
    parseChat
      .mockRejectedValueOnce(new LengthFinishReasonError()) // full batch of 2
      .mockResolvedValue(ok([topic('Half')])); // each half of 1

    const out = await service.nameClusters([cluster(0), cluster(1)]);

    expect(parseChat).toHaveBeenCalledTimes(3); // full (throws) + 2 singles
    expect(out).toHaveLength(2);
    expect(out.every((c) => !c.degraded)).toBe(true);
  });

  it('falls back a single cluster that still hits length after splitting to 1', async () => {
    const { service, parseChat } = makeService();
    parseChat.mockRejectedValue(new LengthFinishReasonError());

    const [naming] = await service.nameClusters([cluster(0)]);

    expect(parseChat).toHaveBeenCalledTimes(1);
    expect(naming).toMatchObject({ degraded: true });
    expect(naming.reason).toContain('length');
  });

  it('re-throws an unexpected (non finish-reason) error', async () => {
    const { service, parseChat } = makeService();
    parseChat.mockRejectedValue(new Error('network exploded'));

    await expect(service.nameClusters([cluster(0)])).rejects.toThrow('network exploded');
  });

  it('returns [] and makes no LLM call for no clusters', async () => {
    const { service, parseChat } = makeService();

    expect(await service.nameClusters([])).toEqual([]);
    expect(parseChat).not.toHaveBeenCalled();
  });

  it('returns only group-level naming (no per-keyword intent — separate from FR-4)', async () => {
    const { service, parseChat } = makeService();
    parseChat.mockResolvedValue(ok([topic('Beans', 'commercial')]));

    const [naming] = await service.nameClusters([cluster(0)]);

    // 群層命名欄位；不含每字 label（keyword_intents 由 FR-4 分表，T8.8 不覆寫）。
    expect(Object.keys(naming).sort()).toEqual(
      [
        'clusterLabel',
        'degraded',
        'intentLabel',
        'parentTopic',
        'reason',
        'topicName',
        'topicType',
      ].sort(),
    );
  });
});
