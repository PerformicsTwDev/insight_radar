import type { INestApplication } from '@nestjs/common';
import { configureApp, DEFAULT_API_PREFIX, resolveApiPrefix } from './bootstrap';
import { clearRegisteredSecrets, REDACT_CENSOR, scrubSecrets } from './logger/redaction';

describe('resolveApiPrefix', () => {
  afterEach(() => {
    delete process.env.API_PREFIX;
  });

  it('defaults to /api/v1 when API_PREFIX is unset', () => {
    delete process.env.API_PREFIX;
    expect(resolveApiPrefix()).toBe(DEFAULT_API_PREFIX);
  });

  it('honours the API_PREFIX override', () => {
    process.env.API_PREFIX = 'api/v2';
    expect(resolveApiPrefix()).toBe('api/v2');
  });
});

describe('configureApp', () => {
  /**
   * app 替身：`setGlobalPrefix` + `enableCors` + `use`（helmet）+ `useBodyParser`（body 上限）
   * + `get(ConfigService)` 回一個 `{ get(key) }` 的 ConfigService 替身。
   */
  const makeApp = (config: Record<string, unknown> = {}) => ({
    setGlobalPrefix: jest.fn(),
    enableCors: jest.fn(),
    use: jest.fn(),
    useBodyParser: jest.fn(),
    get: jest.fn(() => ({ get: (key: string) => config[key] })),
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

  it('enables CORS with the config origin whitelist + credentials (NFR-14; reflected origin, not *)', () => {
    const app = makeApp({ 'app.allowedOrigins': ['http://localhost:5173'] });
    configureApp(app as unknown as INestApplication);

    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['http://localhost:5173'],
      credentials: true,
    });
  });

  it('defaults to an empty CORS whitelist (blocks all cross-origin) when unset', () => {
    const app = makeApp();
    configureApp(app as unknown as INestApplication);

    expect(app.enableCors).toHaveBeenCalledWith({ origin: [], credentials: true });
  });

  it('applies helmet when HELMET_ENABLED is on (NFR-14)', () => {
    const app = makeApp({ 'app.helmetEnabled': true });
    configureApp(app as unknown as INestApplication);

    expect(app.use).toHaveBeenCalledTimes(1);
    expect(typeof (app.use.mock.calls[0] as unknown[])[0]).toBe('function'); // helmet middleware
  });

  it('skips helmet when HELMET_ENABLED is off (NFR-14)', () => {
    const app = makeApp({ 'app.helmetEnabled': false });
    configureApp(app as unknown as INestApplication);

    expect(app.use).not.toHaveBeenCalled();
  });

  it('raises the JSON body limit to BODY_LIMIT_MB (NFR-14; over-limit → 413)', () => {
    const app = makeApp({ 'app.bodyLimitMb': 2 });
    configureApp(app as unknown as INestApplication);

    expect(app.useBodyParser).toHaveBeenCalledWith('json', { limit: '2mb' });
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
