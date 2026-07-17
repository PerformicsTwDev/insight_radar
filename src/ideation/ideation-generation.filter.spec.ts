import { type ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import type { ErrorResponse } from '../common/dto/error-response';
import { IdeationGenerationError } from './ideation-generation.error';
import { IdeationGenerationFilter } from './ideation-generation.filter';

function build(): {
  filter: IdeationGenerationFilter;
  host: ArgumentsHost;
  status: jest.Mock<{ json: jest.Mock }, [number]>;
  json: jest.Mock<void, [ErrorResponse]>;
} {
  const json = jest.fn<void, [ErrorResponse]>();
  const status = jest.fn<{ json: jest.Mock }, [number]>(() => ({ json }));
  const response = { status };
  const request = { url: '/api/v1/ai-ideation' };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { filter: new IdeationGenerationFilter(), host, status, json };
}

describe('IdeationGenerationFilter (T12.10 / FR-35 / AC-35.1)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps IdeationGenerationError to 502 with the unified ErrorResponse shape', () => {
    const { filter, host, status, json } = build();
    filter.catch(new IdeationGenerationError('LLM refused sk-secret'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY); // 502
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(502);
    expect(body.code).toBe('IDEATION_GENERATION_FAILED');
    expect(body.path).toBe('/api/v1/ai-ideation');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(body.message).not.toContain('LLM refused');
    expect(body.message).not.toContain('sk-secret');
  });

  it('logs a scrubbed message even when the error has no stack (fallback to message)', () => {
    const { filter, host, status, json } = build();
    const error = new IdeationGenerationError('boom');
    error.stack = undefined;
    filter.catch(error, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    expect(json.mock.calls[0][0].code).toBe('IDEATION_GENERATION_FAILED');
  });
});
