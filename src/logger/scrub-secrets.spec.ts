import pino from 'pino';
import { errSerializer, REDACT_CENSOR, scrubSecrets } from './redaction';

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
});
