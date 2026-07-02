import type { HttpService } from '@nestjs/axios';
import type { ConfigType } from '@nestjs/config';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { NEVER, type Observable, of, throwError } from 'rxjs';
import type { clusteringConfig } from '../config/clustering.config';
import { ClusterClient } from './cluster.client';
import { ClusteringContractError, ClusteringUnavailableError } from './clustering.errors';
import type { ClusterResult } from './clustering.types';

const CONFIG: ConfigType<typeof clusteringConfig> = {
  serviceUrl: 'http://cluster:8000',
  timeoutMs: 90000,
  retries: 2,
  backoffBaseMs: 1000,
};

const VECTORS: number[][] = [
  [0.1, 0.2],
  [0.3, 0.4],
  [0.5, 0.6],
];

/** 契約合法的回應（n 個向量）：labels 含 -1 noise（合法）；exemplar_indices 對齊 cluster_ids。 */
function makeResult(n: number, over: Partial<ClusterResult> = {}): ClusterResult {
  return {
    labels: Array.from({ length: n }, (_, i) => (i === 0 ? -1 : 0)),
    probabilities: Array.from({ length: n }, (_, i) => (i === 0 ? 0 : 0.9)),
    cluster_ids: [0],
    exemplar_indices: [[1]],
    meta: { n_clusters: 1, n_noise: 1, reduced_dim: 10, seed: 42, lib_versions: { umap: '0.5.7' } },
    ...over,
  };
}

function axiosOk(data: ClusterResult): AxiosResponse<ClusterResult> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
}

/** HTTP 狀態錯誤（axios 形狀：error.response.status）。 */
function httpError(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status },
  });
}

/** 傳輸層暫時錯（node 系統碼）。 */
function transportError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

type PostMock = jest.Mock<Observable<AxiosResponse<ClusterResult>>, [string, unknown]>;

function makeClient(): { client: ClusterClient; post: PostMock } {
  const post = jest.fn<Observable<AxiosResponse<ClusterResult>>, [string, unknown]>();
  const http = { post } as unknown as HttpService;
  return { client: new ClusterClient(http, CONFIG), post };
}

describe('ClusterClient (T8.5 / TC-42 契約 · TC-51 降級)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('request/response contract (TC-42, mock)', () => {
    it('POSTs vectors + merged params to {url}/cluster and returns the result', async () => {
      const { client, post } = makeClient();
      const result = makeResult(3);
      post.mockReturnValue(of(axiosOk(result)));

      const out = await client.cluster(VECTORS, { top_k: 5, umap: { n_neighbors: 10 } });

      expect(post).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith('http://cluster:8000/cluster', {
        vectors: VECTORS,
        top_k: 5,
        umap: { n_neighbors: 10 },
      });
      expect(out).toEqual(result);
    });

    it('omits params → posts only { vectors } (service applies defaults)', async () => {
      const { client, post } = makeClient();
      post.mockReturnValue(of(axiosOk(makeResult(3))));

      await client.cluster(VECTORS);

      expect(post).toHaveBeenCalledWith('http://cluster:8000/cluster', { vectors: VECTORS });
    });

    it('accepts -1 noise labels as legal (does not reject)', async () => {
      const { client, post } = makeClient();
      post.mockReturnValue(of(axiosOk(makeResult(3))));

      const out = await client.cluster(VECTORS);

      expect(out.labels).toContain(-1);
    });

    it('rejects a labels-length mismatch with ClusteringContractError (no retry)', async () => {
      const { client, post } = makeClient();
      // n=2 labels for 3 vectors → 形狀漂移
      post.mockReturnValue(of(axiosOk(makeResult(2))));

      await expect(client.cluster(VECTORS)).rejects.toBeInstanceOf(ClusteringContractError);
      expect(post).toHaveBeenCalledTimes(1); // 驗證在成功回應之後、不重試
    });

    it('rejects a probabilities-length mismatch with ClusteringContractError', async () => {
      const { client, post } = makeClient();
      post.mockReturnValue(of(axiosOk(makeResult(3, { probabilities: [0.1, 0.2] }))));

      await expect(client.cluster(VECTORS)).rejects.toBeInstanceOf(ClusteringContractError);
    });

    it('rejects exemplar_indices not aligned to cluster_ids', async () => {
      const { client, post } = makeClient();
      post.mockReturnValue(
        of(axiosOk(makeResult(3, { cluster_ids: [0, 1], exemplar_indices: [[1]] }))),
      );

      await expect(client.cluster(VECTORS)).rejects.toBeInstanceOf(ClusteringContractError);
    });
  });

  describe('retry + exponential backoff (TC-51)', () => {
    it('retries a transient 5xx with exponential backoff, then succeeds', async () => {
      jest.useFakeTimers();
      const { client, post } = makeClient();
      const result = makeResult(3);
      post
        .mockReturnValueOnce(throwError(() => httpError(503)))
        .mockReturnValueOnce(throwError(() => httpError(503)))
        .mockReturnValueOnce(of(axiosOk(result)));

      const promise = client.cluster(VECTORS);
      await jest.advanceTimersByTimeAsync(1000); // 1st backoff = base
      await jest.advanceTimersByTimeAsync(2000); // 2nd backoff = base*2

      await expect(promise).resolves.toEqual(result);
      expect(post).toHaveBeenCalledTimes(3);
    });

    it('does not retry before the backoff delay elapses (verifies exponential timing)', async () => {
      jest.useFakeTimers();
      const { client, post } = makeClient();
      post.mockReturnValue(throwError(() => httpError(503)));

      const settled = client.cluster(VECTORS).catch((e: unknown) => e);
      expect(post).toHaveBeenCalledTimes(1); // 初次同步嘗試

      await jest.advanceTimersByTimeAsync(999);
      expect(post).toHaveBeenCalledTimes(1); // base=1000 未到 → 尚未重試
      await jest.advanceTimersByTimeAsync(1);
      expect(post).toHaveBeenCalledTimes(2); // t=1000 → 第 1 次重試

      await jest.advanceTimersByTimeAsync(1999);
      expect(post).toHaveBeenCalledTimes(2); // base*2=2000 未到
      await jest.advanceTimersByTimeAsync(1);
      expect(post).toHaveBeenCalledTimes(3); // t=3000 → 第 2 次重試

      const err = await settled;
      expect(err).toBeInstanceOf(ClusteringUnavailableError);
      expect(post).toHaveBeenCalledTimes(3); // retries=2 用盡、不再重試
    });

    it('times out each attempt, backs off, then signals unavailable after the retry cap (TC-51)', async () => {
      jest.useFakeTimers();
      const { client, post } = makeClient();
      post.mockReturnValue(NEVER); // 永不回應 → 每次嘗試都逾時

      const settled = client.cluster(VECTORS).catch((e: unknown) => e);
      expect(post).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(CONFIG.timeoutMs); // 第 1 次逾時
      await jest.advanceTimersByTimeAsync(CONFIG.backoffBaseMs); // 退避 → 第 2 次嘗試
      expect(post).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(CONFIG.timeoutMs); // 第 2 次逾時
      await jest.advanceTimersByTimeAsync(CONFIG.backoffBaseMs * 2); // 退避 → 第 3 次嘗試
      expect(post).toHaveBeenCalledTimes(3);

      await jest.advanceTimersByTimeAsync(CONFIG.timeoutMs); // 第 3 次逾時 → 用盡

      const err = await settled;
      expect(err).toBeInstanceOf(ClusteringUnavailableError);
    });

    it('retries a transient transport error (ECONNRESET)', async () => {
      jest.useFakeTimers();
      const { client, post } = makeClient();
      post
        .mockReturnValueOnce(throwError(() => transportError('ECONNRESET')))
        .mockReturnValueOnce(of(axiosOk(makeResult(3))));

      const promise = client.cluster(VECTORS);
      await jest.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBeDefined();
      expect(post).toHaveBeenCalledTimes(2);
    });

    it('retries a 429 (rate limit) with backoff', async () => {
      jest.useFakeTimers();
      const { client, post } = makeClient();
      post
        .mockReturnValueOnce(throwError(() => httpError(429)))
        .mockReturnValueOnce(of(axiosOk(makeResult(3))));

      const promise = client.cluster(VECTORS);
      await jest.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBeDefined();
      expect(post).toHaveBeenCalledTimes(2);
    });

    it('treats a top-level status (no .response wrapper) as retryable when 5xx', async () => {
      jest.useFakeTimers();
      const { client, post } = makeClient();
      const err = Object.assign(new Error('upstream 502'), { status: 502 });
      post
        .mockReturnValueOnce(throwError(() => err))
        .mockReturnValueOnce(of(axiosOk(makeResult(3))));

      const promise = client.cluster(VECTORS);
      await jest.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBeDefined();
      expect(post).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry a non-retryable 4xx; fails fast as unavailable (single call)', async () => {
      const { client, post } = makeClient();
      post.mockReturnValue(throwError(() => httpError(400)));

      await expect(client.cluster(VECTORS)).rejects.toBeInstanceOf(ClusteringUnavailableError);
      expect(post).toHaveBeenCalledTimes(1); // 4xx 非暫時性 → 不重試
    });

    it('does NOT retry an unknown transport error (no status, code not transient)', async () => {
      const { client, post } = makeClient();
      post.mockReturnValue(throwError(() => transportError('EACCES')));

      await expect(client.cluster(VECTORS)).rejects.toBeInstanceOf(ClusteringUnavailableError);
      expect(post).toHaveBeenCalledTimes(1); // 非暫時性碼 → 不重試
    });
  });
});
