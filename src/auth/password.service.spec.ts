import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { authConfig } from '../config/auth.config';
import { PasswordService } from '.'; // 經 barrel 匯入（測公開入口，亦覆蓋 index re-export）

const CFG = {
  argon2MemoryKib: 19456,
  argon2TimeCost: 2,
  argon2Parallelism: 1,
  minPasswordLen: 10,
} satisfies ConfigType<typeof authConfig>;

const build = (): PasswordService => new PasswordService(CFG);

/**
 * TC-59 部分（FR-24/AC-24.1、NFR-15、S7）：`PasswordService` argon2id 雜湊/驗證。
 * 參數自 config（PHC 字串內含 m=/t=/p=）；明文與 hash **不出現在 log/回應**；弱密碼（過短）→ 驗證錯。
 */
describe('PasswordService (TC-59 部分, FR-24/NFR-15)', () => {
  const PW = 'Str0ngP@ssw0rd!';

  it('hashes with argon2id using config params, and verifies correct vs wrong', async () => {
    const service = build();
    const hash = await service.hash(PW);

    expect(hash.startsWith('$argon2id$')).toBe(true); // 演算法 = argon2id
    expect(hash).toContain('m=19456'); // 記憶體成本自 config
    expect(hash).toContain('t=2'); // 迭代數自 config
    expect(hash).toContain('p=1'); // 並行度自 config
    expect(hash).not.toContain(PW); // 明文不落 hash
    expect(await service.verify(hash, PW)).toBe(true);
    expect(await service.verify(hash, 'wrong-password')).toBe(false);
  });

  it('rejects a password below the configured minimum length (S7/AC-24.1)', async () => {
    await expect(build().hash('short')).rejects.toThrow(/minimum length/i);
  });

  it('does not expose the plaintext or the hash in any log (NFR-5/S7)', async () => {
    const logs: string[] = [];
    for (const level of ['log', 'debug', 'error', 'warn', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => logs.push(args.map(String).join(' ')));
    }
    const service = build();
    const hash = await service.hash(PW);
    await service.verify(hash, PW);

    const joined = logs.join('\n');
    expect(joined).not.toContain(PW);
    expect(joined).not.toContain(hash);
  });

  it('verify returns false (does not throw) for a malformed hash', async () => {
    expect(await build().verify('not-a-valid-hash', PW)).toBe(false);
  });
});
