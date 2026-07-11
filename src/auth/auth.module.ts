import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { authConfig } from '../config/auth.config';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

/**
 * 認證模組（M10，FR-24）。提供 `PasswordService`（argon2id，T10.1）+ `SessionService`（Redis session +
 * cookie，T10.2）；後續 T10.3/T10.4 併入 auth endpoints、CompositeAuthGuard。CacheService 由全域 CacheModule 供給。
 */
@Module({
  imports: [ConfigModule.forFeature(authConfig)],
  providers: [PasswordService, SessionService],
  exports: [PasswordService, SessionService],
})
export class AuthModule {}
