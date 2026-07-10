import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function mockHost(url = '/api/v1/x') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('serialises an HttpException into the uniform ErrorResponse shape', () => {
    const { host, status, json } = mockHost('/api/v1/foo');
    filter.catch(new NotFoundException('nope'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'nope',
        path: '/api/v1/foo',
      }),
    );
    const body = (json.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(typeof body.timestamp).toBe('string');
  });

  it('handles an HttpException with a plain string response', () => {
    const { host, status, json } = mockHost();
    filter.catch(new HttpException('plain text error', HttpStatus.FORBIDDEN), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN', message: 'plain text error' }),
    );
  });

  it('falls back to a generic message when the response object omits one', () => {
    const { host, json } = mockHost();
    filter.catch(new BadRequestException({ code: 'CUSTOM', fields: { a: ['x'] } }), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'CUSTOM',
        message: 'Internal server error',
        fields: { a: ['x'] },
      }),
    );
  });

  it('surfaces field-level errors from a validation exception', () => {
    const { host, json } = mockHost();
    filter.catch(
      new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        fields: { name: ['name must be a string'] },
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        fields: { name: ['name must be a string'] },
      }),
    );
  });

  // —— M0-R2：array-form message（NestJS 預設 ValidationPipe / BadRequestException([...])）——
  it('surfaces an array-form HttpException message on a 4xx (not the generic 500 text)', () => {
    const { host, status, json } = mockHost();
    filter.catch(new BadRequestException(['a must be an integer', 'b is required']), host);

    expect(status).toHaveBeenCalledWith(400);
    const body = (json.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(body.statusCode).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
    // 不得退回通用 500 文字
    expect(body.message).not.toBe('Internal server error');
    // 陣列中每筆訊息都要可見（join 或 fields 任一）
    const serialised = JSON.stringify(body);
    expect(serialised).toContain('a must be an integer');
    expect(serialised).toContain('b is required');
  });

  // —— T9.8/NFR-14：http-errors 形狀的 4xx（body-parser 等框架 middleware）不遮成 500 ——
  it('surfaces an http-errors 4xx (body-parser PayloadTooLargeError → 413, expose msg)', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, status, json } = mockHost();
    // 仿 body-parser 的 PayloadTooLargeError（http-errors：帶 numeric status/statusCode + expose=true）。
    const err = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      expose: true,
      type: 'entity.too.large',
    });
    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(413);
    const body = (json.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(body.statusCode).toBe(413);
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.message).toBe('request entity too large');
  });

  it('honours an exposed error carrying only statusCode (no status alias)', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, status } = mockHost();
    const err = Object.assign(new Error('unsupported charset'), {
      statusCode: 415,
      expose: true,
    });
    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(415);
  });

  it('surfaces an exposed 4xx status not in HttpStatus enum (code falls back to ERROR)', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, status, json } = mockHost();
    const err = Object.assign(new Error('nonstandard'), { status: 499, expose: true });
    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(499);
    const body = (json.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(body.code).toBe('ERROR'); // HttpStatus[499] undefined → 通用 code fallback
  });

  it('does NOT honour an exposed 5xx (only 4xx client errors are surfaced) → 500', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status, json } = mockHost();
    const err = Object.assign(new Error('boom'), { status: 503, expose: true });
    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(500);
    const body = (json.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(body.message).toBe('Internal server error');
  });

  it('does NOT honour an exposed error with no numeric status/statusCode → 500', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status } = mockHost();
    filter.catch(Object.assign(new Error('exposed but statusless'), { expose: true }), host);

    expect(status).toHaveBeenCalledWith(500);
  });

  it('treats a non-object thrown value as a generic 500 (no crash)', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status, json } = mockHost();
    filter.catch('a bare string error', host);

    expect(status).toHaveBeenCalledWith(500);
    const body = (json.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(body.message).toBe('Internal server error');
  });

  it('does NOT honour a non-exposed error status (axios-like upstream status stays 500)', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status, json } = mockHost();
    // axios/上游錯誤：帶 status 但無 expose → 不得把上游狀態外洩；一律通用 500。
    const err = Object.assign(new Error('upstream 404 from Google Ads'), { status: 404 });
    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(500);
    const body = (json.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal server error');
  });

  it('does not leak internals for a non-HttpException (generic 500)', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status, json } = mockHost();
    filter.catch(new Error('postgres://user:pass@db/secret'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = (json.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('postgres://');
  });
});
