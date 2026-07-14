/**
 * Auth provider abstraction (T1.4, FR-12; Design §7 C9). — RED STUB —
 */

export type AuthProviderKind = 'session' | 'apiKey';

export interface AuthProvider {
  readonly kind: AuthProviderKind;
  getAuthHeaders(): Record<string, string>;
  onUnauthorized(): void;
}

export function getApiKey(): string | null {
  throw new Error('not implemented');
}
export function setApiKey(_key: string): void {
  throw new Error('not implemented');
}
export function clearApiKey(): void {
  throw new Error('not implemented');
}

export class SessionAuthProvider implements AuthProvider {
  readonly kind = 'session' as const;
  getAuthHeaders(): Record<string, string> {
    throw new Error('not implemented');
  }
  onUnauthorized(): void {
    throw new Error('not implemented');
  }
}

export class ApiKeyAuthProvider implements AuthProvider {
  readonly kind = 'apiKey' as const;
  getAuthHeaders(): Record<string, string> {
    throw new Error('not implemented');
  }
  onUnauthorized(): void {
    throw new Error('not implemented');
  }
}

export function createAuthProvider(_kind: AuthProviderKind): AuthProvider {
  throw new Error('not implemented');
}
