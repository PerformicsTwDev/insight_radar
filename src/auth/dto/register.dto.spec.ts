import 'reflect-metadata'; // 裝飾器 metadata（Nest app 於 bootstrap 匯入；unit 測試須自帶）
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AUTH_MIN_PASSWORD_LEN, RegisterDto } from './register.dto';

/**
 * AC-24.1（輸入上界 DoS 護欄，NFR-14/S7；Issue #351 子項 1）：
 * 無界密碼（可達 `BODY_LIMIT_MB`）會把多 MB 字串餵進 19 MiB-cost argon2id → DoS 放大。
 * email `@MaxLength(254)`（RFC 5321）、password `@MaxLength(1024)`；逾界 → 400（validation）。
 */
describe('RegisterDto @MaxLength caps (AC-24.1, #351)', () => {
  async function constraintsFor(
    field: 'email' | 'password',
    payload: { email: unknown; password: unknown },
  ): Promise<string[]> {
    const dto = plainToInstance(RegisterDto, payload);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    const err = errors.find((e) => e.property === field);
    return Object.keys(err?.constraints ?? {});
  }

  const validEmail = 'user@example.com';
  const validPassword = 'correct-horse-battery'; // ≥ AUTH_MIN_PASSWORD_LEN, ≤ 1024

  it('rejects an email longer than 254 chars (RFC 5321 cap)', async () => {
    // 255-char local part → 267-char address, exceeds the 254 cap.
    const oversizedEmail = `${'a'.repeat(255)}@example.com`;
    expect(oversizedEmail.length).toBeGreaterThan(254);
    const keys = await constraintsFor('email', {
      email: oversizedEmail,
      password: validPassword,
    });
    expect(keys).toContain('maxLength');
  });

  it('rejects a password longer than 1024 chars (argon2 DoS cap)', async () => {
    const oversizedPassword = 'a'.repeat(1025);
    const keys = await constraintsFor('password', {
      email: validEmail,
      password: oversizedPassword,
    });
    expect(keys).toContain('maxLength');
  });

  it('accepts email at 254 chars and password at 1024 chars (boundary, in-bounds)', async () => {
    // Genuinely valid 254-char address: 64-char local part (RFC 5321 local-part max)
    // + '@' + 189-char domain of ≤63-char labels — passes isEmail AND the 254 cap.
    const emailAt254 = `${'a'.repeat(64)}@${'a'.repeat(63)}.${'a'.repeat(63)}.${'a'.repeat(61)}`;
    expect(emailAt254.length).toBe(254);
    const passwordAt1024 = 'a'.repeat(1024);
    const dto = plainToInstance(RegisterDto, {
      email: emailAt254,
      password: passwordAt1024,
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });

  it('accepts a normal in-bounds payload (no errors)', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: validEmail,
      password: validPassword,
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });

  it('still enforces the existing MinLength floor', async () => {
    const keys = await constraintsFor('password', {
      email: validEmail,
      password: 'a'.repeat(AUTH_MIN_PASSWORD_LEN - 1),
    });
    expect(keys).toContain('minLength');
  });
});
