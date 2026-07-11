import {
  ConflictException,
  Injectable,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import { PasswordService } from './password.service';

/** 最小使用者投影（絕不含 passwordHash，AC-24.1/24.2）。 */
export interface AuthUser {
  id: string;
  email: string;
}

/** 憑證錯誤的**單一通用訊息**（AC-24.3 反枚舉：不區分「email 不存在」與「密碼錯」）。 */
export const INVALID_CREDENTIALS = 'Invalid email or password';

/**
 * 反枚舉用的常數 dummy 密碼（長度 ≥ `AUTH_MIN_PASSWORD_LEN`，供 `PasswordService.hash` 於 boot 產生
 * 一個真實 argon2id hash）；不存在的 email 亦對此 hash 執行一次 verify，使耗時與真實登入相近。
 */
const DUMMY_PASSWORD = 'anti-enumeration-constant-dummy-password';

/**
 * 認證服務（T10.3，FR-24）：register / login / me 的憑證與使用者邏輯。
 * session 生命週期（建立/驗證/撤銷/cookie）由 controller 經 `SessionService` 處理——本服務不碰 HTTP。
 * **明文密碼與 argon2id hash 絕不進 log/回應**（S7）；本服務不 log 任何憑證素材。
 */
@Injectable()
export class AuthService implements OnModuleInit {
  /** boot 時預先產生的 dummy argon2id hash（反枚舉 verify 目標，AC-24.3）。 */
  private dummyHash!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 於 boot 預算 dummy hash（用 config argon2 參數）——讓「首個不存在 email 的登入」也只付一次 verify，
    // 與真實登入耗時對齊（否則首次 miss 會多付一次 hash → timing 洩漏帳號存在與否）。
    this.dummyHash = await this.passwords.hash(DUMMY_PASSWORD);
  }

  /** 建帳號：argon2id 雜湊 → 落 `User.passwordHash`；email 重複（DB unique P2002）→ 409（AC-24.1）。 */
  async register(email: string, password: string): Promise<AuthUser> {
    const passwordHash = await this.passwords.hash(password);
    try {
      return await this.prisma.user.create({
        data: { email, passwordHash },
        select: { id: true, email: true },
      });
    } catch (error) {
      // race-safe：以 DB unique constraint 為唯一權威（不做 TOCTOU 的先查後建），撞 P2002 → 409。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }

  /** 驗證憑證（AC-24.2/24.3）：成功回 `{id,email}`；不存在 email 或密碼錯 → 皆 401、同一訊息、耗時相近。 */
  async login(email: string, password: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const matched = await this.verifyPassword(user, password);
    if (!user || !matched) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return { id: user.id, email: user.email };
  }

  /**
   * 反枚舉 verify 助手（AC-24.3/S7）：無論帳號是否存在，都對**一個真實 argon2id hash** 執行**一次** verify——
   * 帳號不存在時改用 boot 預算的 `dummyHash`，使「email 不存在」與「密碼錯」耗時相近、不由 timing 洩漏帳號存在與否。
   * **不 log** 任何 hash/密碼素材。
   */
  private verifyPassword(
    user: { passwordHash: string } | null,
    password: string,
  ): Promise<boolean> {
    return this.passwords.verify(user?.passwordHash ?? this.dummyHash, password);
  }

  /** 依 session 解出的 userId 取使用者（AC-24.5/24.6）；User 不存在 → 401（真理在 session，不因 DB 放行）。 */
  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return user;
  }
}
