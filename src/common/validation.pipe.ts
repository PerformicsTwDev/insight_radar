import { ValidationPipe } from '@nestjs/common';

/**
 * T0.6 red stub：plain ValidationPipe（無 whitelist/forbidNonWhitelisted/transform、無結構化
 * exceptionFactory），故「拒未知欄位」「結構化 fields」測試會紅。green 補完整設定。
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe();
}
