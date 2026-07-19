import { scopedJsonBodyLimit } from './scoped-json-body-limit';

/** middleware 的 request 參數型別（結構化替身經此收斂，免相依 express 型別）。 */
type ReqArg = Parameters<ReturnType<typeof scopedJsonBodyLimit>>[0];

/** 極簡 request 替身：記錄 stream listeners、可手動 emit；帶 headers / _body / resume。 */
function makeReq(contentType?: string, alreadyParsed = false) {
  const listeners: Record<string, Array<(arg?: unknown) => void>> = {};
  const req = {
    headers: contentType ? { 'content-type': contentType } : {},
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
});
