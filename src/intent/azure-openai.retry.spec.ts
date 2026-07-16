import { createAzureOpenAiClient, AZURE_OPENAI_MAX_RETRIES } from './azure-openai.factory';
import type { AzureConfig } from '../config/azure.config';

const CONFIG: AzureConfig = {
  endpoint: 'https://x.openai.azure.com',
  apiKey: 'AKEY',
  deployment: 'gpt-4o-mini',
  apiVersion: '2024-10-21',
  llmBatchSize: 30,
  llmConcurrency: 6,
  journeyLlmBatchSize: 30,
  maxRetries: 5,
};

/**
 * A 429 carrying `retry-after`, then a 200 — to prove the SDK retries AND honours Retry-After.
 * Captures the wall-clock timestamp of each call so the test can assert the backoff gap
 * matches the header (not the SDK's default exponential backoff).
 */
function makeFlakyFetch(failures: number, retryAfter = '0') {
  const callTimes: number[] = [];
  const fetchImpl = (_url: string | URL, init?: RequestInit): Promise<Response> => {
    callTimes.push(Date.now());
    if (callTimes.length <= failures) {
      return Promise.resolve(
        new Response('{"error":{"message":"rate limited"}}', {
          status: 429,
          headers: { 'retry-after': retryAfter, 'content-type': 'application/json' },
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
      return callTimes.length;
    },
    /** ms gaps between consecutive calls (i.e. how long each retry waited). */
    gaps(): number[] {
      return callTimes.slice(1).map((t, i) => t - callTimes[i]);
    },
  };
}

describe('AzureOpenAI SDK retry (TC-32)', () => {
  it('configures maxRetries=5 by default', () => {
    expect(AZURE_OPENAI_MAX_RETRIES).toBe(5);
  });

  it('retries a 429 and then succeeds within maxRetries', async () => {
    const flaky = makeFlakyFetch(2); // fail twice, succeed on the 3rd
    const client = createAzureOpenAiClient(CONFIG, undefined, flaky.fetch);

    const completion = await client.chat.completions.parse(parseArgs());

    expect(flaky.calls).toBe(3); // 1 initial + 2 retries
    expect((completion as { choices: unknown[] }).choices).toHaveLength(1);
  });

  it('honours the Retry-After header for the backoff delay', async () => {
    // retry-after:1 → the SDK must wait ~1s before retrying (vs its ~0.5s default first backoff).
    const flaky = makeFlakyFetch(1, '1');
    const client = createAzureOpenAiClient(CONFIG, undefined, flaky.fetch);

    await client.chat.completions.parse(parseArgs());

    expect(flaky.calls).toBe(2);
    // the single retry gap should reflect the 1s Retry-After (allow scheduler slack).
    expect(flaky.gaps()[0]).toBeGreaterThanOrEqual(900);
  });

  it('does not retry when maxRetries is configured to 0 (preserves intentional 0)', async () => {
    const flaky = makeFlakyFetch(1); // would succeed on retry, but retries are disabled
    const client = createAzureOpenAiClient({ ...CONFIG, maxRetries: 0 }, undefined, flaky.fetch);

    await expect(client.chat.completions.parse(parseArgs())).rejects.toBeDefined();
    expect(flaky.calls).toBe(1); // no retry
  });
});

function parseArgs() {
  return {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user' as const, content: 'hi' }],
    response_format: {
      type: 'json_schema' as const,
      json_schema: { name: 'x', strict: true, schema: { type: 'object' } },
    },
  };
}
