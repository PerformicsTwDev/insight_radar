import { AzureOpenAiService } from './azure-openai.service';
import type { OpenAiChatClient, ParseChatParams } from './intent-labeler.port';

/** 可程式化 fake OpenAI client：記錄送出的 params、回傳安排好的 completion。 */
class FakeChatClient implements OpenAiChatClient {
  public readonly calls: unknown[] = [];
  constructor(private readonly completion: unknown) {}
  chat = {
    completions: {
      parse: (params: unknown): Promise<unknown> => {
        this.calls.push(params);
        return Promise.resolve(this.completion);
      },
    },
  };
}

const SCHEMA = {
  name: 'intent_labeling',
  schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
} as const;

const baseParams: ParseChatParams = {
  messages: [{ role: 'user', content: 'hi' }],
  jsonSchema: SCHEMA,
};

describe('AzureOpenAiService.parseChat (T2.1 / TC-15 部分)', () => {
  it('sends response_format json_schema with strict:true', async () => {
    const client = new FakeChatClient({
      choices: [{ message: { parsed: { ok: true }, refusal: null } }],
    });
    const service = new AzureOpenAiService(client, 'gpt-4o-mini');

    await service.parseChat(baseParams);

    const sent = client.calls[0] as {
      model: string;
      response_format: { type: string; json_schema: { strict: boolean; name: string } };
    };
    expect(sent.model).toBe('gpt-4o-mini');
    expect(sent.response_format.type).toBe('json_schema');
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.response_format.json_schema.name).toBe('intent_labeling');
  });

  it('returns the parsed payload from message.parsed', async () => {
    const client = new FakeChatClient({
      choices: [{ message: { parsed: { ok: true }, refusal: null } }],
    });
    const service = new AzureOpenAiService(client, 'gpt-4o-mini');

    const result = await service.parseChat(baseParams);
    expect(result.parsed).toEqual({ ok: true });
    expect(result.refusal).toBeNull();
  });

  it('surfaces a model refusal (parsed null, refusal text)', async () => {
    const client = new FakeChatClient({
      choices: [{ message: { parsed: null, refusal: 'I cannot help with that' } }],
    });
    const service = new AzureOpenAiService(client, 'gpt-4o-mini');

    const result = await service.parseChat(baseParams);
    expect(result.parsed).toBeNull();
    expect(result.refusal).toBe('I cannot help with that');
  });

  it('forwards temperature and max_completion_tokens when provided', async () => {
    const client = new FakeChatClient({
      choices: [{ message: { parsed: { ok: true }, refusal: null } }],
    });
    const service = new AzureOpenAiService(client, 'gpt-4o-mini');

    await service.parseChat({ ...baseParams, temperature: 0, maxCompletionTokens: 4000 });
    const sent = client.calls[0] as { temperature?: number; max_completion_tokens?: number };
    expect(sent.temperature).toBe(0);
    expect(sent.max_completion_tokens).toBe(4000);
  });

  it('omits temperature / max_completion_tokens when not provided', async () => {
    const client = new FakeChatClient({
      choices: [{ message: { parsed: { ok: true }, refusal: null } }],
    });
    const service = new AzureOpenAiService(client, 'gpt-4o-mini');

    await service.parseChat(baseParams);
    const sent = client.calls[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('temperature');
    expect(sent).not.toHaveProperty('max_completion_tokens');
  });
});
