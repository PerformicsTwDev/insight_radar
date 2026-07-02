import type { EmbedContentParameters, EmbedContentResponse } from '@google/genai';
import { GeminiEmbeddingService } from './gemini-embedding.service';
import type { GeminiEmbedClient, GeminiEmbedConfig } from './gemini-embed.port';

const CONFIG: GeminiEmbedConfig = {
  model: 'gemini-embedding-001',
  taskType: 'CLUSTERING',
  dim: 3072,
  batchSize: 100,
  concurrency: 2,
  maxRetries: 3,
};

/** length-n 向量：第 0 位為 `head`、其餘 0（用於驗證 pass-through / normalize）。 */
function vec(head: number, n: number): number[] {
  const arr = new Array<number>(n).fill(0);
  arr[0] = head;
  return arr;
}

/** fake client：記錄每次 embedContent 參數，依 `respond` 回應（可拋錯模擬 429/5xx）。 */
function fakeClient(
  respond: (params: EmbedContentParameters, callIndex: number) => EmbedContentResponse | Error,
): { client: GeminiEmbedClient; calls: EmbedContentParameters[] } {
  const calls: EmbedContentParameters[] = [];
  const client: GeminiEmbedClient = {
    models: {
      embedContent: (params) => {
        const result = respond(params, calls.length);
        calls.push(params);
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
    },
  };
  return { client, calls };
}

function response(vectors: number[][]): EmbedContentResponse {
  return { embeddings: vectors.map((values) => ({ values })) };
}

describe('GeminiEmbeddingService (T8.2b / TC-40)', () => {
  it('sends taskType + outputDimensionality in the config object (not deprecated top-level)', async () => {
    const { client, calls } = fakeClient((p) =>
      response((p.contents as string[]).map(() => vec(1, 3072))),
    );
    const service = new GeminiEmbeddingService(client, CONFIG);

    await service.embed(['coffee']);

    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('gemini-embedding-001');
    expect(calls[0].contents).toEqual(['coffee']);
    expect(calls[0].config?.taskType).toBe('CLUSTERING');
    expect(calls[0].config?.outputDimensionality).toBe(3072);
  });

  it('returns native 3072 embeddings unchanged (already unit-length → NO manual normalize)', async () => {
    // 回一個**非單位**的 3072 向量：若服務錯誤地 normalize，head 會被縮放 → 用它證明「未 normalize」。
    const { client } = fakeClient(() => response([vec(2, 3072)]));
    const service = new GeminiEmbeddingService(client, CONFIG);

    const [embedding] = await service.embed(['coffee']);

    expect(embedding).toHaveLength(3072);
    expect(embedding[0]).toBe(2); // 原樣（未被 normalize 成 1）
  });

  it('manually L2-normalizes truncated (<3072) outputs', async () => {
    const truncated: GeminiEmbedConfig = { ...CONFIG, dim: 768 };
    const raw = new Array<number>(768).fill(0);
    raw[0] = 3;
    raw[1] = 4; // norm 5
    const { client, calls } = fakeClient(() => response([raw]));
    const service = new GeminiEmbeddingService(client, truncated);

    const [embedding] = await service.embed(['coffee']);

    expect(calls[0].config?.outputDimensionality).toBe(768);
    expect(embedding[0]).toBeCloseTo(0.6, 6); // 3/5 → 已 normalize
    expect(embedding[1]).toBeCloseTo(0.8, 6);
  });

  it('batches at batchSize and keeps output aligned with input order', async () => {
    const small: GeminiEmbedConfig = { ...CONFIG, batchSize: 2 };
    const { client, calls } = fakeClient((p) =>
      // 每個輸入回一個以其序號標記 head 的向量，驗證順序對齊。
      response((p.contents as string[]).map((c) => vec(Number(c), 3072))),
    );
    const service = new GeminiEmbeddingService(client, small);

    const out = await service.embed(['0', '1', '2', '3', '4']);

    expect(calls).toHaveLength(3); // 5 inputs / batchSize 2 → 3 批
    expect(out).toHaveLength(5);
    expect(out.map((v) => v[0])).toEqual([0, 1, 2, 3, 4]); // 順序對齊
  });

  it('throws on an embedding count mismatch (wire-shape guard, no silent truncation)', async () => {
    const { client } = fakeClient(() => response([vec(1, 3072)])); // 回 1 筆，但要 2 筆
    const service = new GeminiEmbeddingService(client, CONFIG);

    await expect(service.embed(['a', 'b'])).rejects.toThrow(/count mismatch/);
  });

  it('throws on a dim mismatch (guards pgvector halfvec(3072) from bad shapes)', async () => {
    const { client } = fakeClient(() => response([vec(1, 100)])); // 100 != 3072
    const service = new GeminiEmbeddingService(client, CONFIG);

    await expect(service.embed(['a'])).rejects.toThrow(/dim mismatch/);
  });

  it('retries a 429 with backoff then succeeds', async () => {
    jest.useFakeTimers();
    try {
      const { client, calls } = fakeClient((_p, i) =>
        i === 0
          ? Object.assign(new Error('rate limited'), { status: 429 })
          : response([vec(1, 3072)]),
      );
      const service = new GeminiEmbeddingService(client, CONFIG);

      const promise = service.embed(['coffee']);
      await jest.advanceTimersByTimeAsync(500); // 退避一輪
      const out = await promise;

      expect(calls).toHaveLength(2); // 429 一次 + 成功一次
      expect(out).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not retry a non-retryable error (e.g. 400) — throws immediately', async () => {
    const { client, calls } = fakeClient(() =>
      Object.assign(new Error('bad request'), { status: 400 }),
    );
    const service = new GeminiEmbeddingService(client, CONFIG);

    await expect(service.embed(['coffee'])).rejects.toThrow(/bad request/);
    expect(calls).toHaveLength(1); // 未重試
  });

  it('classifies retryability by `code` when `status` is absent (non-retryable code → no retry)', async () => {
    // status 缺 → 退回讀 code；code=400 非可重試 → 立即拋、不重試（覆蓋 code-fallback 分支）。
    const { client, calls } = fakeClient(() => Object.assign(new Error('invalid'), { code: 400 }));
    const service = new GeminiEmbeddingService(client, CONFIG);

    await expect(service.embed(['coffee'])).rejects.toThrow(/invalid/);
    expect(calls).toHaveLength(1);
  });

  it('retries a 5xx (server error) with backoff then succeeds', async () => {
    jest.useFakeTimers();
    try {
      const { client, calls } = fakeClient((_p, i) =>
        i === 0
          ? Object.assign(new Error('server error'), { status: 503 })
          : response([vec(1, 3072)]),
      );
      const service = new GeminiEmbeddingService(client, CONFIG);

      const promise = service.embed(['coffee']);
      await jest.advanceTimersByTimeAsync(500);
      const out = await promise;

      expect(calls).toHaveLength(2); // 5xx 一次 + 成功一次
      expect(out).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('throws when the response has no embeddings array (wire-shape guard)', async () => {
    const { client } = fakeClient(() => ({})); // 缺 embeddings
    const service = new GeminiEmbeddingService(client, CONFIG);

    await expect(service.embed(['a'])).rejects.toThrow(/count mismatch/);
  });

  it('throws when an embedding has no values (wire-shape guard)', async () => {
    const { client } = fakeClient(() => ({ embeddings: [{}] }));
    const service = new GeminiEmbeddingService(client, CONFIG);

    await expect(service.embed(['a'])).rejects.toThrow(/dim mismatch/);
  });

  it('returns [] for empty input without calling the client', async () => {
    const { client, calls } = fakeClient(() => response([]));
    const service = new GeminiEmbeddingService(client, CONFIG);

    expect(await service.embed([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
