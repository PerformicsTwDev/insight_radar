import type { ConfigService } from '@nestjs/config';
import { ApiKeyAuthResolver } from './api-key-auth.resolver';
import type { AuthenticatedRequest } from './authenticated-user';

const API_KEY = 'test-api-key';

function req(headers: Record<string, string | undefined>): AuthenticatedRequest {
  return { headers, user: undefined };
}

/**
 * TC-60（FR-25 · AC-25.2；folds the former ApiKeyGuard credential check, ex-TC-12）：x-api-key 認證策略。
 * 常數時間比對 `x-api-key` 與 `app.apiKey`。逐分支：正確 key / 缺 header / 錯 key / 伺服器未設定 key。
 */
describe('ApiKeyAuthResolver (TC-60)', () => {
  let resolver: ApiKeyAuthResolver;
  let config: { get: jest.Mock };

  beforeEach(() => {
    config = { get: jest.fn().mockReturnValue(API_KEY) };
    resolver = new ApiKeyAuthResolver(config as unknown as ConfigService);
  });

  it('resolves { kind:apiKey } for the correct x-api-key (AC-25.2)', () => {
    expect(resolver.resolve(req({ 'x-api-key': API_KEY }))).toEqual({ kind: 'apiKey' });
  });

  it('returns null when the x-api-key header is missing', () => {
    expect(resolver.resolve(req({}))).toBeNull();
  });

  it('returns null for a wrong x-api-key', () => {
    expect(resolver.resolve(req({ 'x-api-key': 'not-the-key' }))).toBeNull();
  });

  it('returns null when no api key is configured on the server', () => {
    config.get.mockReturnValue(undefined);
    expect(resolver.resolve(req({ 'x-api-key': API_KEY }))).toBeNull();
  });
});
