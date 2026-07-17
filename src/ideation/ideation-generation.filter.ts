import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ErrorResponse } from '../common/dto/error-response';
import { scrubSecrets } from '../logger/redaction';
import { IdeationGenerationError } from './ideation-generation.error';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): void };
}
interface HttpRequestLike {
  url: string;
}

/**
 * HTTP 邊界映射（T12.10，FR-35 / AC-35.1）：把服務層 HTTP-agnostic 的 {@link IdeationGenerationError}
 * （LLM refusal / malformed / 傳輸錯）映射成 **502 Bad Gateway**——本端點作為上游 LLM（Azure OpenAI）的閘道，
 * 上游未能產出可用結果＝閘道失敗；**不回半成品冒充 200**（鏡像 ai-insight T12.4）。回應沿用統一 {@link ErrorResponse}
 * （`code: IDEATION_GENERATION_FAILED`）；完整錯誤只進 server log（`scrubSecrets` 清洗，NFR-5）。`@Catch` 只匹配
 * `IdeationGenerationError`，故 400/401 等 `HttpException` 不受影響、仍由全域 `HttpExceptionFilter` 處理。
 */
@Catch(IdeationGenerationError)
export class IdeationGenerationFilter implements ExceptionFilter {
  private readonly logger = new Logger(IdeationGenerationFilter.name);

  catch(exception: IdeationGenerationError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponseLike>();
    const request = ctx.getRequest<HttpRequestLike>();

    this.logger.error(
      `AI ideation generation failed: ${scrubSecrets(exception.stack ?? exception.message)}`,
    );

    const status = HttpStatus.BAD_GATEWAY;
    const body: ErrorResponse = {
      statusCode: status,
      code: 'IDEATION_GENERATION_FAILED',
      message: 'AI ideation generation failed upstream; please retry',
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(body);
  }
}
