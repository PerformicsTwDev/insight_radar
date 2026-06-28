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
