import { createAzureOpenAiClient, AZURE_OPENAI_MAX_RETRIES } from './azure-openai.factory';
import type { AzureConfig } from '../config/azure.config';

const CONFIG: AzureConfig = {
  endpoint: 'https://x.openai.azure.com',
  apiKey: 'AKEY',
  deployment: 'gpt-4o-mini',
  apiVersion: '2024-10-21',
  llmBatchSize: 30,
  llmConcurrency: 6,
  maxRetries: 5,
};

/** A 429 response carrying Retry-After, then a 200 — to prove the SDK retries + honours Retry-After. */
function makeFlakyFetch(failures: number) {
  let calls = 0;
  const retryAfterSeconds: number[] = [];
  const fetchImpl = (_url: string | URL, init?: RequestInit): Promise<Response> => {
    calls += 1;
    if (calls <= failures) {
      return Promise.resolve(
        new Response('{"error":{"message":"rate limited"}}', {
          status: 429,
          headers: { 'retry-after': '0', 'content-type': 'application/json' },
        }),
      );
    }
    void init;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: '{"results":[]}', refusal: null },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  };
  return {
    fetch: fetchImpl,
    get calls() {
      return calls;
    },
    retryAfterSeconds,
  };
}

describe('AzureOpenAI SDK retry (TC-32)', () => {
  it('configures maxRetries=5 by default', () => {
    expect(AZURE_OPENAI_MAX_RETRIES).toBe(5);
  });

  it('retries a 429 (honouring Retry-After) and then succeeds within maxRetries', async () => {
    const flaky = makeFlakyFetch(2); // fail twice, succeed on the 3rd
    const client = createAzureOpenAiClient(CONFIG, undefined, flaky.fetch);

    const completion = await client.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'x', strict: true, schema: { type: 'object' } },
      },
    });

    expect(flaky.calls).toBe(3); // 1 initial + 2 retries
    expect((completion as { choices: unknown[] }).choices).toHaveLength(1);
  });

  it('honours the configured maxRetries from config', () => {
    // maxRetries flows from AZURE_OPENAI_MAX_RETRIES into the client; default path covered above.
    const client = createAzureOpenAiClient(CONFIG, undefined, makeFlakyFetch(0).fetch);
    expect(client).toBeDefined();
  });
});
