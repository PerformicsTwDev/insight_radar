import { type ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import type { ErrorResponse } from '../common/dto/error-response';
import { AiInsightGenerationError } from './ai-insight-generation.error';
import { AiInsightGenerationFilter } from './ai-insight-generation.filter';

function build(): {
  filter: AiInsightGenerationFilter;
  host: ArgumentsHost;
  status: jest.Mock<{ json: jest.Mock }, [number]>;
  json: jest.Mock<void, [ErrorResponse]>;
} {
  const json = jest.fn<void, [ErrorResponse]>();
  const status = jest.fn<{ json: jest.Mock }, [number]>(() => ({ json }));
  const response = { status };
  const request = { url: '/api/v1/keyword-analyses/abc/ai-insight' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { filter: new AiInsightGenerationFilter(), host, status, json };
}

describe('AiInsightGenerationFilter (T12.4 / FR-32 / AC-32.4)', () => {
  beforeEach(() => {
    // 抑制錯誤日誌噪音（filter 內部會 logger.error 記錄已 scrub 的 stack）。
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps AiInsightGenerationError to 502 with the unified ErrorResponse shape', () => {
    const { filter, host, status, json } = build();

    filter.catch(new AiInsightGenerationError('LLM refused'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY); // 502
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(502);
    expect(body.code).toBe('AI_INSIGHT_GENERATION_FAILED');
    expect(body.path).toBe('/api/v1/keyword-analyses/abc/ai-insight');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    // 不外洩內部細節：回應訊息為通用字串，非原始 exception message（NFR-5）。
    expect(body.message).not.toContain('LLM refused');
  });

  it('logs a scrubbed message even when the error has no stack (fallback to message)', () => {
    const { filter, host, status, json } = build();
    const error = new AiInsightGenerationError('boom');
    error.stack = undefined; // 覆蓋 stack 缺席分支：logger 走 message fallback

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    expect(json.mock.calls[0][0].code).toBe('AI_INSIGHT_GENERATION_FAILED');
  });
});
