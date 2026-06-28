import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';

const API_KEY = 'test-api-key';

function mockContext(apiKeyHeader?: string): ExecutionContext {
  const request = {
    headers: apiKeyHeader === undefined ? {} : { 'x-api-key': apiKeyHeader },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard (TC-12)', () => {
  let guard: ApiKeyGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    config = { get: jest.fn().mockReturnValue(API_KEY) };
    guard = new ApiKeyGuard(reflector as unknown as Reflector, config as unknown as ConfigService);
  });

  it('allows a request carrying the correct x-api-key', () => {
    expect(guard.canActivate(mockContext(API_KEY))).toBe(true);
  });

  it('rejects a missing x-api-key with 401', () => {
    expect(() => guard.canActivate(mockContext(undefined))).toThrow(UnauthorizedException);
  });

  it('rejects a wrong x-api-key with 401', () => {
    expect(() => guard.canActivate(mockContext('wrong-key'))).toThrow(UnauthorizedException);
  });

  it('rejects when no API key is configured', () => {
    config.get.mockReturnValue(undefined);
    expect(() => guard.canActivate(mockContext(API_KEY))).toThrow(UnauthorizedException);
  });

  it('bypasses the guard for @Public handlers (no key needed)', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(mockContext(undefined))).toBe(true);
  });
});
