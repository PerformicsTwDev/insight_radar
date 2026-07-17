import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ErrorResponse } from '../common/dto/error-response';
import { scrubSecrets } from '../logger/redaction';
import { CustomClassifyGenerationError } from './custom-classify.error';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): void };
}
interface HttpRequestLike {
  url: string;
}

/**
 * HTTP 邊界映射（T12.7，FR-34 / AC-34.1）：把服務層 HTTP-agnostic 的 {@link CustomClassifyGenerationError}
 * （LLM refusal / malformed / 傳輸錯）映射成 **502 Bad Gateway**——本端點作為上游 LLM（Azure OpenAI）的閘道，
 * 上游未能產出可用標籤＝閘道失敗；**不回半成品冒充 201**（與 ai-insight T12.4 同構）。回應沿用統一
 * {@link ErrorResponse}（`code: CUSTOM_CLASSIFY_GENERATION_FAILED`）；完整錯誤只進 server log（`scrubSecrets`
 * 清洗內嵌連線字串／token，NFR-5）。`@Catch` 只匹配 `CustomClassifyGenerationError`，故 400/404/409/401 等
 * `HttpException` 不受影響，仍由全域 `HttpExceptionFilter` 處理。
 */
@Catch(CustomClassifyGenerationError)
export class CustomClassifyGenerationFilter implements ExceptionFilter {
  private readonly logger = new Logger(CustomClassifyGenerationFilter.name);

  catch(exception: CustomClassifyGenerationError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponseLike>();
    const request = ctx.getRequest<HttpRequestLike>();

    this.logger.error(
      `Custom classification label generation failed: ${scrubSecrets(
        exception.stack ?? exception.message,
      )}`,
    );

    const status = HttpStatus.BAD_GATEWAY;
    const body: ErrorResponse = {
      statusCode: status,
      code: 'CUSTOM_CLASSIFY_GENERATION_FAILED',
      message: 'Custom classification label generation failed upstream; please retry',
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(body);
  }
}
