import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { authConfig } from '../config/auth.config';
import { PasswordService } from './password.service';

/**
 * 認證模組（M10，FR-24）。T10.1 起提供 `PasswordService`（argon2id）；後續 T10.2/T10.3 併入
 * SessionService、auth endpoints、CompositeAuthGuard。
 */
@Module({
  imports: [ConfigModule.forFeature(authConfig)],
  providers: [PasswordService],
  exports: [PasswordService],
})
export class AuthModule {}
