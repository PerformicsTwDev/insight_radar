import { type ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import type { ErrorResponse } from '../common/dto/error-response';
import { CustomClassifyGenerationError } from './custom-classify.error';
import { CustomClassifyGenerationFilter } from './custom-classify.filter';

function build(): {
  filter: CustomClassifyGenerationFilter;
  host: ArgumentsHost;
  status: jest.Mock<{ json: jest.Mock }, [number]>;
  json: jest.Mock<void, [ErrorResponse]>;
} {
  const json = jest.fn<void, [ErrorResponse]>();
  const status = jest.fn<{ json: jest.Mock }, [number]>(() => ({ json }));
  const response = { status };
  const request = { url: '/api/v1/keyword-analyses/abc/custom-classifications' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { filter: new CustomClassifyGenerationFilter(), host, status, json };
}

describe('CustomClassifyGenerationFilter (T12.7 / FR-34 / AC-34.1)', () => {
  beforeEach(() => {
    // 抑制錯誤日誌噪音（filter 內部會 logger.error 記錄已 scrub 的 stack）。
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps CustomClassifyGenerationError to 502 with the unified ErrorResponse shape', () => {
    const { filter, host, status, json } = build();

    filter.catch(new CustomClassifyGenerationError('LLM refused sk-secret'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY); // 502
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(502);
    expect(body.code).toBe('CUSTOM_CLASSIFY_GENERATION_FAILED');
    expect(body.path).toBe('/api/v1/keyword-analyses/abc/custom-classifications');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    // 不外洩內部細節：回應訊息為通用字串，非原始 exception message（NFR-5）。
    expect(body.message).not.toContain('LLM refused');
    expect(body.message).not.toContain('sk-secret');
  });

  it('logs a scrubbed message even when the error has no stack (fallback to message)', () => {
    const { filter, host, status, json } = build();
    const error = new CustomClassifyGenerationError('boom');
    error.stack = undefined; // 覆蓋 stack 缺席分支：logger 走 message fallback

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    expect(json.mock.calls[0][0].code).toBe('CUSTOM_CLASSIFY_GENERATION_FAILED');
  });
});
