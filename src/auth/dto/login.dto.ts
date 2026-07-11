import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

/**
 * `POST /auth/login` 入參（AC-24.2/24.3）。僅驗 email 形狀與 password 為字串——**不**驗密碼長度：
 * 憑證錯誤一律走 `401`（不區分「不存在」與「密碼錯」，避免帳號枚舉，AC-24.3）。
 */
export class LoginDto {
  @ApiProperty({ format: 'email', example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery' })
  @IsString()
  password!: string;
}
