import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorResponse } from './dto/error-response';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): void };
}
interface HttpRequestLike {
  url: string;
}

/**
 * 全域例外過濾器（T0.6）：把所有例外序列化成統一的 {@link ErrorResponse}。
 *
 * - HttpException：用其 status/message；驗證例外另帶 `code` 與欄位級 `fields`。
 * - 非 HttpException：server-side 記錄完整錯誤，但回應只回通用 500 訊息
 *   （**不洩漏 stack/連線字串/祕密**，NFR-5）。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponseLike>();
    const request = ctx.getRequest<HttpRequestLike>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let code = HttpStatus[status] ?? 'ERROR';
    let message = 'Internal server error';
    let fields: Record<string, string[]> | undefined;

    if (isHttp) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else {
        const r = res as { message?: unknown; code?: unknown; fields?: unknown };
        if (typeof r.message === 'string') {
          message = r.message;
        }
        if (typeof r.code === 'string') {
          code = r.code;
        }
        if (r.fields) {
          fields = r.fields as Record<string, string[]>;
        }
      }
    } else {
      // 不洩漏細節：完整錯誤只進 server log，回應給通用訊息。
      this.logger.error(
        'Unhandled exception',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponse = {
      statusCode: status,
      code,
      message,
      ...(fields ? { fields } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(body);
  }
}
