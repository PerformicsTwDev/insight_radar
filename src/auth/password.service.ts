import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { authConfig } from '../config/auth.config';

/**
 * 密碼服務（T10.1，FR-24/AC-24.1、NFR-15）：argon2id 雜湊/驗證，參數自 `auth` config（OWASP 下限）。
 * **明文與 hash 絕不進 log/回應**（S7）；弱密碼（< `minPasswordLen`）於 hash 前即拒。
 */
@Injectable()
export class PasswordService {
  constructor(@Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>) {}

  /** 以 argon2id 雜湊明文密碼；弱密碼（過短）→ 拋錯。回傳 PHC 字串（含參數/salt，可自我描述）。 */
  hash(_plain: string): Promise<string> {
    throw new Error('PasswordService.hash not implemented');
  }

  /** 驗證明文密碼是否符合既有 hash（錯誤/格式不符 → false，不拋）。 */
  verify(_hash: string, _plain: string): Promise<boolean> {
    throw new Error('PasswordService.verify not implemented');
  }
}
