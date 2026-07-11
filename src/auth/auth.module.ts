import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { authConfig } from '../config/auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

/**
 * 認證模組（M10，FR-24）。提供 `PasswordService`（argon2id，T10.1）+ `SessionService`（Redis session +
 * cookie，T10.2）+ `AuthController`/`AuthService`（register/login/logout/me，T10.3）；後續 T10.4 併入
 * CompositeAuthGuard。PrismaService/CacheService 由全域模組供給（無需在此 import）。
 */
@Module({
  imports: [ConfigModule.forFeature(authConfig)],
  controllers: [AuthController],
  providers: [PasswordService, SessionService, AuthService],
  exports: [PasswordService, SessionService],
})
export class AuthModule {}
