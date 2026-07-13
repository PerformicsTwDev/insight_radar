import pino from 'pino';
import { REDACT_CENSOR, REDACT_PATHS } from './redaction';

function captureLog(obj: Record<string, unknown>, msg: string): string {
  const chunks: string[] = [];
  const stream: pino.DestinationStream = {
    write: (chunk: string) => {
      chunks.push(chunk);
    },
  };
  const logger = pino(
    { base: undefined, redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } },
    stream,
  );
  logger.info(obj, msg);
  return chunks.join('');
}

describe('log redaction (TC-29)', () => {
  it('redacts developer token / API key / OAuth refresh token / Azure key (top-level + nested)', () => {
    const secrets = {
      developerToken: 'DEV_TOKEN_SECRET',
      apiKey: 'API_KEY_SECRET',
      refreshToken: 'REFRESH_TOKEN_SECRET',
      azureApiKey: 'AZURE_KEY_SECRET',
      clientSecret: 'CLIENT_SECRET_VALUE',
      payload: { apiKey: 'NESTED_API_SECRET', developerToken: 'NESTED_DEV_SECRET' },
    };

    const output = captureLog(secrets, 'sensitive');

    for (const secret of [
      'DEV_TOKEN_SECRET',
      'API_KEY_SECRET',
      'REFRESH_TOKEN_SECRET',
      'AZURE_KEY_SECRET',
      'CLIENT_SECRET_VALUE',
      'NESTED_API_SECRET',
      'NESTED_DEV_SECRET',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain(REDACT_CENSOR);
  });

  it('redacts password / passwordHash / sessionSecret — plaintext, argon2id hash, session secret never logged (M10/S6/S7)', () => {
    const output = captureLog(
      {
        email: 'user@example.com', // 非祕密：不遮
        password: 'PLAINTEXT_PW_SECRET', // req body 明文
        user: { passwordHash: '$argon2id$v=19$HASH_MATERIAL_SECRET' }, // User 物件（巢狀 1 層）
        row: { password_hash: 'SNAKE_HASH_SECRET' }, // DB 欄位命名
        sessionSecret: 'SESSION_SIGNING_SECRET', // top-level（NFR-15）
        auth: { sessionSecret: 'NESTED_SESSION_SECRET' }, // config namespace（巢狀 1 層）
      },
      'auth',
    );
    for (const secret of [
      'PLAINTEXT_PW_SECRET',
      'HASH_MATERIAL_SECRET',
      'SNAKE_HASH_SECRET',
      'SESSION_SIGNING_SECRET',
      'NESTED_SESSION_SECRET',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('user@example.com'); // 非祕密欄位不受影響
    expect(output).toContain(REDACT_CENSOR);
  });

  it('redacts the x-api-key / authorization request headers', () => {
    const output = captureLog(
      {
        req: {
          headers: { 'x-api-key': 'HEADER_API_SECRET', authorization: 'Bearer TOKEN_SECRET' },
        },
      },
      'request',
    );

    expect(output).not.toContain('HEADER_API_SECRET');
    expect(output).not.toContain('TOKEN_SECRET');
  });

  it('redacts the session cookie (Cookie / Set-Cookie headers) — sid is a bearer credential (M10, NFR-15)', () => {
    // pino-http 預設 req/res serializer 會輸出完整 headers 物件：req 含 `cookie`、login res 含 `set-cookie`。
    // M10 起 opaque `sid` 是唯一人類 bearer 憑證 → 明文入 log = session 劫持/帳號接管（httpOnly/Secure 全失效）。
    const output = captureLog(
      {
        req: { headers: { cookie: 'sid=SID_REQ_SECRET; theme=dark' } }, // 每個認證請求的 Cookie
        res: {
          headers: { 'set-cookie': ['sid=SID_RES_SECRET; HttpOnly; SameSite=Lax; Secure; Path=/'] },
        }, // login 回應的 Set-Cookie（Node getHeaders 為陣列）
        headers: { cookie: 'sid=BARE_COOKIE_SECRET' }, // 頂層 headers 變體（與既有 x-api-key 同慣例）
      },
      'request',
    );

    for (const secret of ['SID_REQ_SECRET', 'SID_RES_SECRET', 'BARE_COOKIE_SECRET']) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain(REDACT_CENSOR);
  });

  it('redacts config-namespace shapes, connection-string passwords, and OAuth access tokens', () => {
    const output = captureLog(
      {
        googleAds: { developerToken: 'NS_DEV_SECRET', clientSecret: 'NS_CLIENT_SECRET' },
        azure: { apiKey: 'NS_AZURE_SECRET' },
        app: { apiKey: 'NS_APP_SECRET' },
        database: { url: 'postgresql://user:DB_PW_SECRET@host:5432/db' },
        redis: { url: 'redis://user:REDIS_PW_SECRET@host:6379' },
        tokens: { access_token: 'ACCESS_TOKEN_SECRET' },
      },
      'config',
    );

    for (const secret of [
      'NS_DEV_SECRET',
      'NS_CLIENT_SECRET',
      'NS_AZURE_SECRET',
      'NS_APP_SECRET',
      'DB_PW_SECRET',
      'REDIS_PW_SECRET',
      'ACCESS_TOKEN_SECRET',
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});
