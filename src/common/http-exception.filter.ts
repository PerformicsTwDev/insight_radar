import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): void };
}

/**
 * T0.6 red stub：回非統一格式（缺 statusCode/code/path/timestamp），讓 filter spec 與 e2e 轉紅。
 * green 階段補上 ErrorResponse 統一格式 + 驗證 fields + 非 HttpException 不洩漏細節。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponseLike>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    response.status(status).json({ message: 'not implemented' });
  }
}
