import pino from 'pino';
import {
  clearRegisteredSecrets,
  errSerializer,
  REDACT_CENSOR,
  registerSecretValues,
  scrubSecrets,
} from './redaction';

describe('scrubSecrets (M0-R3: free-string secret scrubbing)', () => {
  it('masks the password in a postgres connection string embedded in a message', () => {
    const out = scrubSecrets('connect failed: postgresql://app:DB_PW_SECRET@db:5432/insight');
    expect(out).not.toContain('DB_PW_SECRET');
    expect(out).toContain(REDACT_CENSOR);
    // host / db name preserved (only the credential segment masked)
    expect(out).toContain('db:5432/insight');
  });

  it('masks the password in a redis connection string', () => {
    const out = scrubSecrets('redis://default:REDIS_PW_SECRET@cache:6379');
    expect(out).not.toContain('REDIS_PW_SECRET');
    expect(out).toContain(REDACT_CENSOR);
  });

  it('masks a Bearer token embedded in a string', () => {
    const out = scrubSecrets('Authorization: Bearer TOKEN_SECRET_VALUE retrying');
    expect(out).not.toContain('TOKEN_SECRET_VALUE');
    expect(out).toContain(REDACT_CENSOR);
  });

  it('returns non-string input unchanged and leaves clean strings intact', () => {
    expect(scrubSecrets('nothing to hide here')).toBe('nothing to hide here');
    expect(scrubSecrets(undefined)).toBeUndefined();
  });
});

describe('errSerializer (M0-R3: scrub message + stack)', () => {
  function captureErr(err: Error): string {
    const chunks: string[] = [];
    const stream: pino.DestinationStream = {
      write: (chunk: string) => {
        chunks.push(chunk);
      },
    };
    const logger = pino({ base: undefined, serializers: { err: errSerializer } }, stream);
    logger.error({ err }, 'boom');
    return chunks.join('');
  }

  it('scrubs a connection-string password leaked through err.message', () => {
    const output = captureErr(new Error('ECONNREFUSED postgresql://u:STACK_PW_SECRET@h:5432/d'));
    expect(output).not.toContain('STACK_PW_SECRET');
    expect(output).toContain(REDACT_CENSOR);
  });

  it('preserves the error type and a clean message', () => {
    const output = captureErr(new TypeError('plain failure'));
    expect(output).toContain('TypeError');
    expect(output).toContain('plain failure');
  });

  it('scrubs a registered raw secret value leaked through err.message (value-based, T7.3)', () => {
    registerSecretValues(['LEAKED_TOKEN_12345678']);
    try {
      const output = captureErr(new Error('Ads failed with LEAKED_TOKEN_12345678'));
      expect(output).not.toContain('LEAKED_TOKEN_12345678');
      expect(output).toContain(REDACT_CENSOR);
    } finally {
      clearRegisteredSecrets();
    }
  });
});

/**
 * T7.3 / TC-29 value-based redaction：原始祕密**值**若內嵌於任意自由文字（非 keyed、非連線字串、非 Bearer）
 * 亦須遮蔽——涵蓋 developer token / API key / OAuth refresh / Azure key 四類洩漏。
 */
describe('scrubSecrets value-based redaction (T7.3 / TC-29)', () => {
  afterEach(() => clearRegisteredSecrets());

  it('redacts a registered secret value embedded anywhere in free text', () => {
    registerSecretValues(['SuperSecretDevToken123XYZ']);
    const out = scrubSecrets('rejected: developer token SuperSecretDevToken123XYZ is invalid');
    expect(out).not.toContain('SuperSecretDevToken123XYZ');
    expect(out).toContain(REDACT_CENSOR);
  });

  it('redacts all four named secret types wherever they appear (TC-29)', () => {
    const secrets = [
      'DEV_TOKEN_aaaaaaaa',
      'API_KEY_bbbbbbbb',
      'REFRESH_cccccccc',
      'AZURE_dddddddd',
    ];
    registerSecretValues(secrets);
    const out = scrubSecrets(`leak ${secrets.join(' ')}`);
    for (const s of secrets) {
      expect(out).not.toContain(s);
    }
  });

  it('handles secret values containing regex metacharacters (split/join, not regex)', () => {
    registerSecretValues(['a.b*c+d($x)?']);
    expect(scrubSecrets('token=a.b*c+d($x)? end')).not.toContain('a.b*c+d($x)?');
  });

  it('does not register too-short values (avoids over-scrubbing common strings)', () => {
    registerSecretValues(['abc', '']); // 皆 < MIN_SECRET_LENGTH
    expect(scrubSecrets('abc is a common string')).toBe('abc is a common string');
  });
});
