import { Injectable, NotImplementedException } from '@nestjs/common';

/** 最小使用者投影（絕不含 passwordHash，AC-24.1/24.2）。 */
export interface AuthUser {
  id: string;
  email: string;
}

/**
 * 認證服務（T10.3，FR-24）——skeleton（RED）：待 GREEN 實作 register/login/me。
 * 憑證/使用者邏輯集中於此（session 生命週期由 controller 經 `SessionService` 處理）。
 */
@Injectable()
export class AuthService {
  register(_email: string, _password: string): Promise<AuthUser> {
    throw new NotImplementedException();
  }

  login(_email: string, _password: string): Promise<AuthUser> {
    throw new NotImplementedException();
  }

  me(_userId: string): Promise<AuthUser> {
    throw new NotImplementedException();
  }
}
