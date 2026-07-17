import { AZURE_OPENAI_MAX_RETRIES, createAzureOpenAiClient } from './azure-openai.factory';
import type { AzureOpenAICtor } from './azure-openai.factory';
import type { AzureConfig } from '../config/azure.config';

const CONFIG: AzureConfig = {
  endpoint: 'https://x.openai.azure.com',
  apiKey: 'AKEY',
  deployment: 'gpt-4o-mini',
  apiVersion: '2024-10-21',
  llmBatchSize: 30,
  llmConcurrency: 6,
  journeyLlmBatchSize: 30,
  journeyMaxKeywords: 5000,
  customClassifyMaxLabels: 12,
  customClassifyLlmBatchSize: 30,
  customClassifyMaxKeywords: 5000,
  maxRetries: 5,
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

  it('uses the config maxRetries when valid, else falls back to the default', () => {
    const captured: Array<{ maxRetries: number }> = [];
    const FakeCtor = function (this: unknown, o: { maxRetries: number }) {
      captured.push(o);
      return { chat: { completions: { parse: () => Promise.resolve({}) } } };
    } as unknown as AzureOpenAICtor;

    createAzureOpenAiClient({ ...CONFIG, maxRetries: 3 }, FakeCtor);
    createAzureOpenAiClient({ ...CONFIG, maxRetries: Number.NaN }, FakeCtor); // invalid → default

    expect(captured[0].maxRetries).toBe(3);
    expect(captured[1].maxRetries).toBe(AZURE_OPENAI_MAX_RETRIES); // 5
  });

  it('rejects an apiVersion not in the allowlist before constructing the client (T2.7)', () => {
    let constructed = false;
    const FakeCtor = function (this: unknown) {
      constructed = true;
      return { chat: { completions: { parse: () => Promise.resolve({}) } } };
    } as unknown as AzureOpenAICtor;

    // 字典序會誤放的值 / 純亂值都必須被擋；且在建構 client 之前就拋。
    const bad = { ...CONFIG, apiVersion: '2099-12-31' as never };
    expect(() => createAzureOpenAiClient(bad, FakeCtor)).toThrow(/api.?version/i);
    expect(constructed).toBe(false);
  });

  it('accepts every allowlisted apiVersion (preview / GA / v1)', () => {
    let constructed = 0;
    const FakeCtor = function (this: unknown) {
      constructed += 1;
      return { chat: { completions: { parse: () => Promise.resolve({}) } } };
    } as unknown as AzureOpenAICtor;
    const versions = ['2024-08-01-preview', '2024-10-21', 'v1'] as const;
    for (const apiVersion of versions) {
      expect(() => createAzureOpenAiClient({ ...CONFIG, apiVersion }, FakeCtor)).not.toThrow();
    }
    expect(constructed).toBe(versions.length); // each allowlisted version built a client
  });

  it('defaults to the real AzureOpenAI constructor (lazy; no network at build)', () => {
    // 不傳 Ctor → 走預設 AzureOpenAI；建構為 lazy（不打網路），回傳具 chat.completions.parse 的 client。
    const client = createAzureOpenAiClient(CONFIG);
    expect(typeof client.chat.completions.parse).toBe('function');
  });
});
