import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as argon2 from 'argon2';
import { authConfig } from '../config/auth.config';

/**
 * 密碼服務（T10.1，FR-24/AC-24.1、NFR-15）：argon2id 雜湊/驗證，參數自 `auth` config（OWASP 下限）。
 * **明文與 hash 絕不進 log/回應**（S7）——本服務不 log 任何密碼素材；弱密碼（< `minPasswordLen`）於 hash 前即拒。
 */
@Injectable()
export class PasswordService {
  constructor(@Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>) {}

  /** 以 argon2id 雜湊明文密碼；弱密碼（過短）→ 拋錯。回傳 PHC 字串（`$argon2id$...`，自帶參數/salt）。 */
  async hash(plain: string): Promise<string> {
    if (plain.length < this.config.minPasswordLen) {
      throw new Error(`password below minimum length (${this.config.minPasswordLen})`);
    }
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: this.config.argon2MemoryKib,
      timeCost: this.config.argon2TimeCost,
      parallelism: this.config.argon2Parallelism,
    });
  }

  /** 驗證明文是否符合既有 hash。格式不符/損壞的 hash → **false**（不拋；spec-mandated，非吞錯）。 */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
