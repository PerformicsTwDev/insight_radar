import { AZURE_OPENAI_MAX_RETRIES, createAzureOpenAiClient } from './azure-openai.factory';
import type { AzureOpenAICtor } from './azure-openai.factory';
import type { AzureConfig } from '../config/azure.config';

const CONFIG: AzureConfig = {
  endpoint: 'https://x.openai.azure.com',
  apiKey: 'AKEY',
  deployment: 'gpt-4o-mini',
  apiVersion: '2024-10-21',
};

describe('createAzureOpenAiClient (T2.1)', () => {
  it('maps config to AzureOpenAI options incl. maxRetries=5 (NFR-3/AC-4.6)', () => {
    const opts: unknown[] = [];
    const FakeCtor = function (this: unknown, o: unknown) {
      opts.push(o);
      return { chat: { completions: { parse: () => Promise.resolve({}) } } };
    } as unknown as AzureOpenAICtor;

    createAzureOpenAiClient(CONFIG, FakeCtor);

    expect(opts).toEqual([
      {
        endpoint: 'https://x.openai.azure.com',
        apiKey: 'AKEY',
        apiVersion: '2024-10-21',
        deployment: 'gpt-4o-mini',
        maxRetries: 5,
      },
    ]);
    expect(AZURE_OPENAI_MAX_RETRIES).toBe(5);
  });

  it('defaults to the real AzureOpenAI constructor (lazy; no network at build)', () => {
    // 不傳 Ctor → 走預設 AzureOpenAI；建構為 lazy（不打網路），回傳具 chat.completions.parse 的 client。
    const client = createAzureOpenAiClient(CONFIG);
    expect(typeof client.chat.completions.parse).toBe('function');
  });
});
