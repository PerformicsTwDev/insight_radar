import type { INestApplication } from '@nestjs/common';
import { configureApp, DEFAULT_API_PREFIX } from './bootstrap';
import { clearRegisteredSecrets, REDACT_CENSOR, scrubSecrets } from './logger/redaction';

describe('configureApp', () => {
  /** app 替身：`setGlobalPrefix` + `get(ConfigService)` 回一個 `{ get(key) }` 的 ConfigService 替身。 */
  const makeApp = (secrets: Record<string, string | undefined> = {}) => ({
    setGlobalPrefix: jest.fn(),
    get: jest.fn(() => ({ get: (key: string) => secrets[key] })),
  });

  afterEach(() => {
    delete process.env.API_PREFIX;
    clearRegisteredSecrets();
  });

  it('applies the default /api/v1 prefix with /health excluded', () => {
    const app = makeApp();
    configureApp(app as unknown as INestApplication);

    expect(app.setGlobalPrefix).toHaveBeenCalledWith(DEFAULT_API_PREFIX, { exclude: ['health'] });
  });

  it('honours the API_PREFIX override', () => {
    process.env.API_PREFIX = 'api/v2';
    const app = makeApp();
    configureApp(app as unknown as INestApplication);

    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api/v2', { exclude: ['health'] });
  });

  it('registers config secret values for redaction so they never surface in logs (T7.3/TC-29)', () => {
    const secrets = {
      'app.apiKey': 'API_KEY_VALUE_xxxx',
      'googleAds.developerToken': 'DEV_TOKEN_VALUE_yy',
      'googleAds.refreshToken': 'REFRESH_TOKEN_zzz',
      'googleAds.clientSecret': 'CLIENT_SECRET_www',
      'azure.apiKey': 'AZURE_KEY_VALUE_vv',
    };
    configureApp(makeApp(secrets) as unknown as INestApplication);

    // 四類祕密（developer token / API key / OAuth refresh / Azure key）+ client secret 皆從自由文字遮蔽。
    const out = scrubSecrets(`leak ${Object.values(secrets).join(' ')}`);
    for (const value of Object.values(secrets)) {
      expect(out).not.toContain(value);
    }
    expect(out).toContain(REDACT_CENSOR);
  });
});
