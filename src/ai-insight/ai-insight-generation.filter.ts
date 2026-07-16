import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ErrorResponse } from '../common/dto/error-response';
import { scrubSecrets } from '../logger/redaction';
import { AiInsightGenerationError } from './ai-insight-generation.error';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): void };
}
interface HttpRequestLike {
  url: string;
}

/**
 * HTTP 邊界映射（T12.4，FR-32 / AC-32.4）：把服務層 HTTP-agnostic 的 {@link AiInsightGenerationError}
 * （LLM refusal / malformed / 傳輸錯）映射成 **502 Bad Gateway**——本端點作為上游 LLM（Azure OpenAI）的閘道，
 * 上游未能產出可用結果＝閘道失敗；**不回半截摘要冒充 200**。回應沿用統一 {@link ErrorResponse} 形狀
 * （`code: AI_INSIGHT_GENERATION_FAILED`）。完整錯誤只進 server log（`scrubSecrets` 清洗內嵌連線字串／token，
 * NFR-5），回應給通用訊息、不外洩 stack/祕密。掛於 `AiInsightController`（`@UseFilters`）：`@Catch` 只匹配
 * `AiInsightGenerationError`，故 400/404/409/401 等 `HttpException` 不受影響，仍由全域 `HttpExceptionFilter` 處理。
 */
@Catch(AiInsightGenerationError)
export class AiInsightGenerationFilter implements ExceptionFilter {
  private readonly logger = new Logger(AiInsightGenerationFilter.name);

  catch(exception: AiInsightGenerationError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponseLike>();
    const request = ctx.getRequest<HttpRequestLike>();

    // 完整錯誤（stack；stack 缺席 fallback message）進 server log，scrub 內嵌祕密（NFR-5）。
    this.logger.error(
      `AI insight generation failed: ${scrubSecrets(exception.stack ?? exception.message)}`,
    );

    const status = HttpStatus.BAD_GATEWAY;
    const body: ErrorResponse = {
      statusCode: status,
      code: 'AI_INSIGHT_GENERATION_FAILED',
      message: 'AI insight generation failed upstream; please retry',
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(body);
  }
}
