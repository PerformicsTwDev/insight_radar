import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/public.decorator';
import { AuthService, type AuthUser } from './auth.service';
import { parseCookies } from './cookie.util';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SessionService, type SessionCookieOptions } from './session.service';

/** logout/me 缺/失效 session cookie 時的通用未認證訊息。 */
const NOT_AUTHENTICATED = 'Authentication required';

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
 * register/login `@Public`（免認證，AC-25.4）；logout/me 亦 `@Public`（於 T10.4 CompositeAuthGuard 之前），
 * 由 controller 讀 session cookie 自行把關——無效/失效 → 401（真理在 Redis session，AC-24.6）。
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

  /** 登出（AC-24.4）：撤銷 Redis session + 清 cookie；無有效 session → 401。 */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<void> {
    const { sid } = await this.requireSession(req);
    await this.sessions.revoke(sid);
    const { httpOnly, sameSite, secure, path } = this.sessions.cookieOptions();
    res.clearCookie(this.sessions.cookieName, { httpOnly, sameSite, secure, path });
  }

  /** 取當前使用者（AC-24.5/24.6）：有效 session → `{id,email}`；無/失效 session → 401。 */
  @Public()
  @Get('me')
  async me(@Req() req: CookieRequest): Promise<AuthUser> {
    const { userId } = await this.requireSession(req);
    return this.auth.me(userId);
  }

  /**
   * 讀 session cookie → 驗 Redis session。缺 cookie 或 session 失效（Redis TTL 到期/已撤銷）→ 401。
   * **真理在 Redis session**（AC-24.6）：cookie 僅載 opaque sid，session 不在即未認證，與 DB 是否有 User 無關。
   */
  private async requireSession(req: CookieRequest): Promise<{ sid: string; userId: string }> {
    const sid = parseCookies(req.headers.cookie)[this.sessions.cookieName];
    const userId = sid ? await this.sessions.verify(sid) : null;
    if (!sid || !userId) {
      throw new UnauthorizedException(NOT_AUTHENTICATED);
    }
    return { sid, userId };
  }
}
