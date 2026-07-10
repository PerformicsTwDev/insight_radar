import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorResponse } from './dto/error-response';
import { scrubSecrets } from '../logger/redaction';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): void };
}
interface HttpRequestLike {
  url: string;
}

/**
 * 判定是否為 **http-errors 形狀的 client 錯誤**（body-parser 等框架 middleware 拋出，如
 * `PayloadTooLargeError` 413、JSON parse 失敗 400）。以 `expose === true` 為判別鍵——http-errors 對
 * 4xx 設 `expose=true`（訊息為安全通用字串），藉此**排除** axios/上游錯誤等同樣帶 `status` 但不該把上游
 * 狀態外洩給 client 的例外。回傳 4xx status（否則 undefined → 走通用 500）。
 */
function httpErrorsClientStatus(exception: unknown): number | undefined {
  if (!exception || typeof exception !== 'object') return undefined;
  const e = exception as { status?: unknown; statusCode?: unknown; expose?: unknown };
  if (e.expose !== true) return undefined;
  const raw =
    typeof e.status === 'number'
      ? e.status
      : typeof e.statusCode === 'number'
        ? e.statusCode
        : undefined;
  return raw !== undefined && raw >= 400 && raw < 500 ? raw : undefined;
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
    // 非 HttpException 時：先看是否為 http-errors 的 4xx（body-parser PayloadTooLargeError→413 等）——
    // 尊重其 client 狀態、不遮成 500（NFR-14「body 逾限 → 413」、濫用面收斂）。其餘一律 500。
    const clientStatus = isHttp ? undefined : httpErrorsClientStatus(exception);
    const status = isHttp
      ? exception.getStatus()
      : (clientStatus ?? HttpStatus.INTERNAL_SERVER_ERROR);

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
        } else if (Array.isArray(r.message) && r.message.length > 0) {
          // NestJS 預設 ValidationPipe / `BadRequestException([...])` 帶 string[]——
          // 串成單一可讀訊息，避免退回通用 500 文字（M0-R2）。
          message = r.message.map(String).join('; ');
        }
        if (typeof r.code === 'string') {
          code = r.code;
        }
        if (r.fields) {
          fields = r.fields as Record<string, string[]>;
        }
      }
    } else if (clientStatus !== undefined) {
      // http-errors 4xx（框架 middleware，如 body-parser）：其 `expose=true` 訊息為安全通用字串
      // （如「request entity too large」）——可安全外露；仍記 server log（scrub）便於觀測。
      code = HttpStatus[clientStatus] ?? code;
      const safeMessage = (exception as { message?: unknown }).message;
      if (typeof safeMessage === 'string') {
        message = safeMessage;
      }
      this.logger.warn(scrubSecrets(`Client error ${clientStatus}: ${message}`));
    } else {
      // 不洩漏細節：完整錯誤只進 server log，回應給通用訊息。
      // stack 以 scrubSecrets 清洗內嵌的連線字串密碼／bearer token（M0-R3；此處走原始字串
      // log，不經 pino serializers.err，故須自行遮罩）。
      this.logger.error(
        'Unhandled exception',
        scrubSecrets(exception instanceof Error ? exception.stack : String(exception)),
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
