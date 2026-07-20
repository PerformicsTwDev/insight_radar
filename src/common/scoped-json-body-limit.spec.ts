import zlib from 'node:zlib';
import { scopedJsonBodyLimit } from './scoped-json-body-limit';

/** middleware 的 request 參數型別（結構化替身經此收斂，免相依 express 型別）。 */
type ReqArg = Parameters<ReturnType<typeof scopedJsonBodyLimit>>[0];

/**
 * 極簡 request 替身：記錄 stream listeners、可手動 emit；帶 headers / _body / resume。
 * `extraHeaders` 讓測試補 `content-encoding` / `content-length` 等（gzip / 預檢用）。
 */
function makeReq(
  contentType?: string,
  alreadyParsed = false,
  extraHeaders: Record<string, string> = {},
) {
  const listeners: Record<string, Array<(arg?: unknown) => void>> = {};
  const req = {
    headers: {
      ...(contentType ? { 'content-type': contentType } : {}),
      ...extraHeaders,
    } as Record<string, string | string[] | undefined>,
    _body: alreadyParsed || undefined,
    body: undefined as unknown,
    resume: jest.fn(),
    on(event: string, cb: (arg?: unknown) => void) {
      (listeners[event] ??= []).push(cb);
      return req;
    },
    emit(event: string, arg?: unknown): void {
      for (const cb of listeners[event] ?? []) {
        cb(arg);
      }
    },
  };
  return req;
}

/**
 * 執行 middleware 並回傳一個 Promise，於 `next` 被呼叫時 resolve 其錯誤引數（無錯 → undefined）。
 * gzip/deflate/br inflate 走 zlib 非同步串流，`next` 為非同步觸發，故測試需 await。
 */
function runAndAwaitNext(limitBytes: number, req: ReturnType<typeof makeReq>): Promise<unknown> {
  return new Promise((resolve) => {
    scopedJsonBodyLimit(limitBytes)(req as unknown as ReqArg, {}, (err?: unknown) => resolve(err));
  });
}

type ClientErr = Error & { status?: number; statusCode?: number; expose?: boolean };

describe('scopedJsonBodyLimit (T13.2 · AC-36.5 獨立 body 上限)', () => {
  const LIMIT = 16; // bytes

  it('passes through non-JSON requests without touching body (交回全域 parser)', () => {
    const next = jest.fn();
    const req = makeReq('text/plain');
    scopedJsonBodyLimit(LIMIT)(req as unknown as ReqArg, {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(req._body).toBeUndefined();
  });

  it('passes through when content-type header is absent', () => {
    const next = jest.fn();
    const req = makeReq(); // 無 content-type
    scopedJsonBodyLimit(LIMIT)(req as unknown as ReqArg, {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(req._body).toBeUndefined();
  });

  it('passes through when body already parsed (req._body=true)', () => {
    const next = jest.fn();
    const req = makeReq('application/json', true);
    scopedJsonBodyLimit(LIMIT)(req as unknown as ReqArg, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('parses JSON under the limit → sets req.body + req._body, next() no error', () => {
    const next = jest.fn();
    const req = makeReq('application/json');
    scopedJsonBodyLimit(LIMIT)(req as unknown as ReqArg, {}, next);
    req.emit('data', Buffer.from('{"a":1}'));
    req.emit('end');
    expect(req.body).toEqual({ a: 1 });
    expect(req._body).toBe(true);
    expect(next).toHaveBeenCalledWith();
  });

  it('empty JSON body → req.body {} + req._body, next() no error', () => {
    const next = jest.fn();
    const req = makeReq('application/json');
    scopedJsonBodyLimit(LIMIT)(req as unknown as ReqArg, {}, next);
    req.emit('end');
    expect(req.body).toEqual({});
    expect(req._body).toBe(true);
    expect(next).toHaveBeenCalledWith();
  });

  it('over-limit → next(http-errors 413) exactly once, drains via resume()', () => {
    const next = jest.fn();
    const req = makeReq('application/json');
    scopedJsonBodyLimit(LIMIT)(req as unknown as ReqArg, {}, next);
    req.emit('data', Buffer.from('x'.repeat(LIMIT + 1)));
    req.emit('data', Buffer.from('more')); // 後續 chunk 被忽略
    req.emit('end'); // settled 後不再 next

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next.mock.calls[0] as unknown[])[0] as ClientErr;
    expect(err.status).toBe(413);
    expect(err.statusCode).toBe(413);
    expect(err.expose).toBe(true);
    expect(req.resume).toHaveBeenCalled();
  });

  it('malformed JSON → next(http-errors 400)', () => {
    const next = jest.fn();
    const req = makeReq('application/json');
    scopedJsonBodyLimit(LIMIT)(req as unknown as ReqArg, {}, next);
    req.emit('data', Buffer.from('{bad'));
    req.emit('end');
    const err = (next.mock.calls[0] as unknown[])[0] as ClientErr;
    expect(err.status).toBe(400);
    expect(err.expose).toBe(true);
  });

  it('propagates stream errors to next()', () => {
    const next = jest.fn();
    const req = makeReq('application/json');
    scopedJsonBodyLimit(LIMIT)(req as unknown as ReqArg, {}, next);
    const boom = new Error('socket boom');
    req.emit('error', boom);
    expect(next).toHaveBeenCalledWith(boom);
  });

  it('ignores a late error after already settled (413) → next() still called exactly once', () => {
    const next = jest.fn();
    const req = makeReq('application/json');
    scopedJsonBodyLimit(LIMIT)(req as unknown as ReqArg, {}, next);
    req.emit('data', Buffer.from('x'.repeat(LIMIT + 1))); // settle(413)
    req.emit('error', new Error('late socket error')); // settled → 忽略（不二次 next）
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── M13-R3 parity（與全域 useBodyParser('json') 對齊）────────────────────────
  const BIG = 4096; // bytes：解壓後仍在限額內

  describe('[5] content-type matched case-insensitively (parity with global)', () => {
    it('treats Application/JSON as JSON (not passthrough) → parses under scoped limit', async () => {
      const req = makeReq('Application/JSON');
      const done = runAndAwaitNext(BIG, req);
      req.emit('data', Buffer.from('{"a":1}'));
      req.emit('end');
      expect(await done).toBeUndefined();
      expect(req.body).toEqual({ a: 1 });
      expect(req._body).toBe(true); // 被此 parser 認領，不落到較小全域上限
    });

    it('parses application/json with charset param (media-type before ";")', async () => {
      const req = makeReq('application/json; charset=utf-8');
      const done = runAndAwaitNext(BIG, req);
      req.emit('data', Buffer.from('{"a":1}'));
      req.emit('end');
      expect(await done).toBeUndefined();
      expect(req.body).toEqual({ a: 1 });
    });
  });

  describe('[1] Content-Encoding inflation (parity: inflate=true)', () => {
    it('inflates gzip body → parses decoded JSON', async () => {
      const req = makeReq('application/json', false, { 'content-encoding': 'gzip' });
      const done = runAndAwaitNext(BIG, req);
      req.emit('data', zlib.gzipSync(Buffer.from('{"a":1,"b":"deep"}')));
      req.emit('end');
      expect(await done).toBeUndefined();
      expect(req.body).toEqual({ a: 1, b: 'deep' });
      expect(req._body).toBe(true);
    });

    it('inflates deflate body → parses decoded JSON', async () => {
      const req = makeReq('application/json', false, { 'content-encoding': 'deflate' });
      const done = runAndAwaitNext(BIG, req);
      req.emit('data', zlib.deflateSync(Buffer.from('{"z":9}')));
      req.emit('end');
      expect(await done).toBeUndefined();
      expect(req.body).toEqual({ z: 9 });
    });

    it('inflates brotli (br) body → parses decoded JSON', async () => {
      const req = makeReq('application/json', false, { 'content-encoding': 'br' });
      const done = runAndAwaitNext(BIG, req);
      req.emit('data', zlib.brotliCompressSync(Buffer.from('{"b":2}')));
      req.emit('end');
      expect(await done).toBeUndefined();
      expect(req.body).toEqual({ b: 2 });
    });

    it('enforces the limit against DECODED size (decompression bomb → 413)', async () => {
      // 高度可壓縮的大 payload：壓縮後小、解壓後遠超小限額 → 必須以「解壓後大小」計限。
      const decoded = `{"x":"${'a'.repeat(2000)}"}`;
      const req = makeReq('application/json', false, { 'content-encoding': 'gzip' });
      const done = runAndAwaitNext(64, req); // 64 bytes 限額
      req.emit('data', zlib.gzipSync(Buffer.from(decoded)));
      req.emit('end');
      const err = (await done) as ClientErr;
      expect(err.status).toBe(413);
      expect(err.expose).toBe(true);
    });

    it('malformed gzip stream → surfaces an explicit 4xx (not swallowed, not 500)', async () => {
      const req = makeReq('application/json', false, { 'content-encoding': 'gzip' });
      const done = runAndAwaitNext(BIG, req);
      req.emit('data', Buffer.from('not-a-valid-gzip-stream'));
      req.emit('end');
      const err = (await done) as ClientErr;
      expect(err.expose).toBe(true);
      expect(err.status).toBeGreaterThanOrEqual(400);
      expect(err.status).toBeLessThan(500);
    });

    it('unsupported content-encoding → 415 (parity)', () => {
      const next = jest.fn();
      const req = makeReq('application/json', false, { 'content-encoding': 'compress' });
      scopedJsonBodyLimit(BIG)(req as unknown as ReqArg, {}, next);
      const err = (next.mock.calls[0] as unknown[])[0] as ClientErr;
      expect(err.status).toBe(415);
      expect(err.expose).toBe(true);
    });
  });

  describe('[8] charset decode from content-type (parity: not hardcoded utf8)', () => {
    it('decodes a utf-16le body per its charset param', async () => {
      const req = makeReq('application/json; charset=utf-16le');
      const done = runAndAwaitNext(BIG, req);
      req.emit('data', Buffer.from('{"u":"é"}', 'utf16le')); // é
      req.emit('end');
      expect(await done).toBeUndefined();
      expect(req.body).toEqual({ u: 'é' });
    });

    it('rejects a non-utf charset with 415 (JSON is utf-* only, parity)', () => {
      const next = jest.fn();
      const req = makeReq('application/json; charset=iso-8859-1');
      scopedJsonBodyLimit(BIG)(req as unknown as ReqArg, {}, next);
      const err = (next.mock.calls[0] as unknown[])[0] as ClientErr;
      expect(err.status).toBe(415);
    });
  });

  describe('[11] Content-Length pre-check (reject before buffering)', () => {
    it('oversized declared Content-Length → 413 without reading the body', () => {
      const next = jest.fn();
      const req = makeReq('application/json', false, {
        'content-length': String(LIMIT + 1000),
      });
      scopedJsonBodyLimit(LIMIT)(req as unknown as ReqArg, {}, next);
      // 未 emit 任何 data：預檢即拒。
      expect(next).toHaveBeenCalledTimes(1);
      const err = (next.mock.calls[0] as unknown[])[0] as ClientErr;
      expect(err.status).toBe(413);
      expect(err.expose).toBe(true);
      expect(req.resume).toHaveBeenCalled(); // 排空、不切 socket
    });

    it('does not pre-check Content-Length for compressed bodies (it is the compressed size)', async () => {
      // Content-Length（壓縮大小）雖小，但這裡只確認「不因壓縮大小預檢誤拒」——合法小 payload → 過。
      const gz = zlib.gzipSync(Buffer.from('{"a":1}'));
      const req = makeReq('application/json', false, {
        'content-encoding': 'gzip',
        'content-length': String(gz.length),
      });
      const done = runAndAwaitNext(BIG, req);
      req.emit('data', gz);
      req.emit('end');
      expect(await done).toBeUndefined();
      expect(req.body).toEqual({ a: 1 });
    });
  });

  describe('[12] abort / premature close finalize (no hang, resources released)', () => {
    it('premature close before end → settles once with a 4xx, ignores late events', async () => {
      const req = makeReq('application/json');
      const done = runAndAwaitNext(BIG, req);
      req.emit('data', Buffer.from('{"a":')); // 部分 body
      req.emit('close'); // 未 end 即關閉 → 視為 abort
      const err = (await done) as ClientErr;
      expect(err.status).toBeGreaterThanOrEqual(400);
      expect(err.status).toBeLessThan(500);
      // 晚到事件在 settle 後被忽略（不二次 next / 不 throw）。
      expect(() => {
        req.emit('data', Buffer.from('1}'));
        req.emit('end');
      }).not.toThrow();
    });

    it('deprecated aborted event also finalizes exactly once', () => {
      const next = jest.fn();
      const req = makeReq('application/json');
      scopedJsonBodyLimit(BIG)(req as unknown as ReqArg, {}, next);
      req.emit('aborted');
      req.emit('close'); // settled → 忽略
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('normal close AFTER end does not clobber a successful parse', async () => {
      const req = makeReq('application/json');
      const done = runAndAwaitNext(BIG, req);
      req.emit('data', Buffer.from('{"ok":true}'));
      req.emit('end');
      req.emit('close'); // 正常收束的 close（end 之後）→ 不得覆寫成 abort
      expect(await done).toBeUndefined();
      expect(req.body).toEqual({ ok: true });
    });
  });
});
