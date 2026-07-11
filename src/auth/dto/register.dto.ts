import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * 密碼最小長度（AC-24.1 / Design §14）。= env `AUTH_MIN_PASSWORD_LEN` 的 Joi 下限/預設（10）。
 * class-validator 裝飾器須為編譯期常數（無法注入 config），故以此常數對齊；執行期真值仍由
 * `PasswordService.hash`（讀 config `minPasswordLen`）二次把關。
 */
export const AUTH_MIN_PASSWORD_LEN = 10;

/**
 * `POST /auth/register` 入參（AC-24.1）。全域 ValidationPipe（whitelist + forbidNonWhitelisted +
 * transform）驗證：非 email → 400；密碼 < `AUTH_MIN_PASSWORD_LEN` → 400；未宣告欄位 → 400。
 * `@ApiProperty` 顯式標註（不依賴 swagger CLI plugin，與 OpenAPI 產出一致，FR-22）。
 */
export class RegisterDto {
  @ApiProperty({ format: 'email', example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: AUTH_MIN_PASSWORD_LEN, example: 'correct-horse-battery' })
  @IsString()
  @MinLength(AUTH_MIN_PASSWORD_LEN)
  password!: string;
}
