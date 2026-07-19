import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { AUTH_MAX_EMAIL_LEN, AUTH_MAX_PASSWORD_LEN } from './register.dto';

/**
 * `POST /auth/login` 入參（AC-24.2/24.3）。僅驗 email 形狀與 password 為字串——**不**驗密碼下限：
 * 憑證錯誤一律走 `401`（不區分「不存在」與「密碼錯」，避免帳號枚舉，AC-24.3）。
 * 但仍套用與註冊相同的**輸入上界**（`@MaxLength`，DoS 護欄，AC-24.1）：逾界一律 `400`——
 * 不涉憑證真偽、不洩帳號存在性（>1024 字元密碼註冊時本就無法建立，故不構成枚舉面）。
 */
export class LoginDto {
  @ApiProperty({ format: 'email', maxLength: AUTH_MAX_EMAIL_LEN, example: 'user@example.com' })
  @IsEmail()
  @MaxLength(AUTH_MAX_EMAIL_LEN)
  email!: string;

  @ApiProperty({ maxLength: AUTH_MAX_PASSWORD_LEN, example: 'correct-horse-battery' })
  @IsString()
  @MaxLength(AUTH_MAX_PASSWORD_LEN)
  password!: string;
}
