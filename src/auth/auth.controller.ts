import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/public.decorator';
import { AuthService, type AuthUser } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SessionService, type SessionCookieOptions } from './session.service';

/**
 * 最小結構型別（避免直接相依 express 型別，與 `HttpExceptionFilter` 的 `*Like` 同慣例）：
 * 只宣告本 controller 用到的 Express req/res 表面（`headers.cookie` / `cookie` / `clearCookie`）。
 */
interface CookieRequest {
  headers: { cookie?: string };
}
interface CookieResponse {
  cookie(name: string, value: string, options: SessionCookieOptions): void;
  clearCookie(name: string, options: Omit<SessionCookieOptions, 'maxAge'>): void;
}

/**
 * 認證 HTTP 入口（T10.3，FR-24）。掛 `/api/v1/auth`（全域前綴）。
 * register/login `@Public`（免認證，AC-25.4）；`me` `@Public`（GET、唯讀，`SessionService.authenticate` 讀
 * cookie 把關）；**`logout` 非 `@Public`**——是 session 狀態變更，由 `CompositeAuthGuard`+`CsrfGuard` 保護
 * （AC-26.1，防跨站強制登出）。無效/失效 session → 401（真理在 Redis session，AC-24.6）。
 *
 * **純路由 shell**：所有 handler 皆直線委派（session 認證的唯一真實分支已下放至 `SessionService.authenticate`，
 * 於 gate 內單元測試）；本檔剩餘覆蓋率缺口全屬 `emitDecoratorMetadata` 對 class-typed 參數/回傳型別生成的
 * 不可測 phantom branch，故 `jest.config.ts` 將本檔比照 `*.module.ts` 排除於覆蓋率（見該檔註記）。
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /** 建帳號（AC-24.1）：201 + `{ user:{id,email} }`；重複 409、弱格式 400（DTO）。密碼/hash 不回應。 */
  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<{ user: AuthUser }> {
    const user = await this.auth.register(dto.email, dto.password);
    return { user };
  }

  /** 登入（AC-24.2）：驗證成功 → 建 Redis session、設 httpOnly+SameSite=Lax+Secure+Path cookie；回 200 + user。 */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<{ user: AuthUser }> {
    const user = await this.auth.login(dto.email, dto.password);
    const sid = await this.sessions.create(user.id);
    res.cookie(this.sessions.cookieName, sid, this.sessions.cookieOptions());
    return { user }; // body 只回 user；opaque sid 只在 Set-Cookie（不入 body）
  }

  /**
   * 登出（AC-24.4）：撤銷 Redis session + 清 cookie；無有效 session → 401。
   * **非 `@Public`**（M9-R/T10.5）：logout 是 session-cookie 認證的狀態變更請求 → 由 `CompositeAuthGuard`
   * 保護（session 必要）並經 `CsrfGuard` 檢查 Origin（AC-26.1）；否則 `@Public` 會令 `request.user` 未設、
   * 讓 CsrfGuard 略過 → 可被跨站強制登出（CSRF）。
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<void> {
    const { sid } = await this.sessions.authenticate(req.headers.cookie);
    await this.sessions.revoke(sid);
    const { httpOnly, sameSite, secure, path } = this.sessions.cookieOptions();
    res.clearCookie(this.sessions.cookieName, { httpOnly, sameSite, secure, path });
  }

  /** 取當前使用者（AC-24.5/24.6）：有效 session → `{id,email}`；無/失效 session → 401。 */
  @Public()
  @Get('me')
  async me(@Req() req: CookieRequest): Promise<AuthUser> {
    const { userId } = await this.sessions.authenticate(req.headers.cookie);
    return this.auth.me(userId);
  }
}
