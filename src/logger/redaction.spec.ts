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
});
