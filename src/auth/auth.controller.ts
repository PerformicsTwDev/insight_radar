import { Controller, Get, NotImplementedException, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/public.decorator';
import type { AuthUser } from './auth.service';

/**
 * 認證 HTTP 入口（T10.3，FR-24）——skeleton（RED）。掛 `/api/v1/auth`（全域前綴）。
 * register/login `@Public`（免認證，AC-25.4）；logout/me 亦 `@Public`（T10.4 CompositeAuthGuard 前），
 * 由 controller 讀 session cookie 自行把關（無效 → 401）。
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Public()
  @Post('register')
  register(): Promise<{ user: AuthUser }> {
    throw new NotImplementedException();
  }

  @Public()
  @Post('login')
  login(): Promise<{ user: AuthUser }> {
    throw new NotImplementedException();
  }

  @Public()
  @Post('logout')
  logout(): Promise<void> {
    throw new NotImplementedException();
  }

  @Public()
  @Get('me')
  me(): Promise<AuthUser> {
    throw new NotImplementedException();
  }
}
