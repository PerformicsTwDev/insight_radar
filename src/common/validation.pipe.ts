import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/**
 * 全域 ValidationPipe（T0.6）：whitelist + forbidNonWhitelisted + transform；
 * 失敗時丟出結構化 `BadRequestException`（`code`/`message`/`fields`），由 HttpExceptionFilter 序列化。
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        fields: buildFieldErrors(errors),
      }),
  });
}

/** 把 class-validator 的 ValidationError[] 攤平成 property → 訊息陣列。 */
export function buildFieldErrors(errors: ValidationError[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const error of errors) {
    if (error.constraints) {
      out[error.property] = Object.values(error.constraints);
    }
  }
  return out;
}
