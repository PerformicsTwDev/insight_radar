import 'reflect-metadata'; // 裝飾器 metadata（Nest app 於 bootstrap 匯入；unit 測試須自帶）
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

/**
 * AC-24.1/AC-24.2（輸入上界 DoS 護欄，NFR-14/S7；Issue #351 子項 1）：
 * 登入同樣對 dummy/實際 hash 跑 argon2 verify（AC-24.3 常數時間），無界密碼一樣造成 DoS 放大。
 * email `@MaxLength(254)`、password `@MaxLength(1024)`；逾界一律 400（不涉憑證真偽、不洩帳號存在性）。
 * 登入**不**驗密碼下限（MinLength）——憑證錯誤走 401（AC-24.3），只加上界。
 */
describe('LoginDto @MaxLength caps (AC-24.1/24.2, #351)', () => {
  async function constraintsFor(
    field: 'email' | 'password',
    payload: { email: unknown; password: unknown },
  ): Promise<string[]> {
    const dto = plainToInstance(LoginDto, payload);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    const err = errors.find((e) => e.property === field);
    return Object.keys(err?.constraints ?? {});
  }

  const validEmail = 'user@example.com';
  const validPassword = 'correct-horse-battery';

  it('rejects an email longer than 254 chars', async () => {
    const oversizedEmail = `${'a'.repeat(255)}@example.com`;
    const keys = await constraintsFor('email', {
      email: oversizedEmail,
      password: validPassword,
    });
    expect(keys).toContain('maxLength');
  });

  it('rejects a password longer than 1024 chars', async () => {
    const keys = await constraintsFor('password', {
      email: validEmail,
      password: 'a'.repeat(1025),
    });
    expect(keys).toContain('maxLength');
  });

  it('does not impose a MinLength floor on login (short password is not a maxLength/minLength error)', async () => {
    // 短密碼於登入不因長度被擋（憑證錯誤走 401，非 400）——只驗形狀 + 上界。
    const keys = await constraintsFor('password', { email: validEmail, password: 'short' });
    expect(keys).not.toContain('minLength');
    expect(keys).not.toContain('maxLength');
  });

  it('accepts a normal in-bounds payload (no errors)', async () => {
    const dto = plainToInstance(LoginDto, { email: validEmail, password: validPassword });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });
});
