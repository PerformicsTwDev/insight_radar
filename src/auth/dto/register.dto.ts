import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * 密碼最小長度（AC-24.1 / Design §14）。= env `AUTH_MIN_PASSWORD_LEN` 的 Joi 下限/預設（10）。
 * class-validator 裝飾器須為編譯期常數（無法注入 config），故以此常數對齊；執行期真值仍由
 * `PasswordService.hash`（讀 config `minPasswordLen`）二次把關。
 */
export const AUTH_MIN_PASSWORD_LEN = 10;

/**
 * email 上界（AC-24.1，DoS 護欄）。RFC 5321 §4.5.3.1.3 收件位址（forward-path）上限 254 字元。
 */
export const AUTH_MAX_EMAIL_LEN = 254;

/**
 * 密碼上界（AC-24.1，DoS 護欄 NFR-14/S7）。無界密碼（可達 `BODY_LIMIT_MB`）會把多 MB 字串餵進
 * 19 MiB-cost argon2id → DoS 放大。1024 容長 passphrase 又界定 argon2id 輸入。
 */
export const AUTH_MAX_PASSWORD_LEN = 1024;

/**
 * `POST /auth/register` 入參（AC-24.1）。全域 ValidationPipe（whitelist + forbidNonWhitelisted +
 * transform）驗證：非 email → 400；密碼 < `AUTH_MIN_PASSWORD_LEN` 或逾 `AUTH_MAX_*` 上界 → 400；
 * 未宣告欄位 → 400。`@ApiProperty` 顯式標註（不依賴 swagger CLI plugin，與 OpenAPI 產出一致，FR-22）。
 */
export class RegisterDto {
  @ApiProperty({ format: 'email', maxLength: AUTH_MAX_EMAIL_LEN, example: 'user@example.com' })
  @IsEmail()
  @MaxLength(AUTH_MAX_EMAIL_LEN)
  email!: string;

  @ApiProperty({
    minLength: AUTH_MIN_PASSWORD_LEN,
    maxLength: AUTH_MAX_PASSWORD_LEN,
    example: 'correct-horse-battery',
  })
  @IsString()
  @MinLength(AUTH_MIN_PASSWORD_LEN)
  @MaxLength(AUTH_MAX_PASSWORD_LEN)
  password!: string;
}
