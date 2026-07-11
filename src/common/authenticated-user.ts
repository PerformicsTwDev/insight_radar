/**
 * 已認證 actor（FR-25 / AC-25.1·25.2）：`CompositeAuthGuard` 通過後附掛於 `request.user`，供下游
 * （T10.6 owner 過濾，FR-27）依 `kind` 分流——**session** actor 帶 `{ id, email }`（人類使用者、受 owner
 * 過濾）；**apiKey** actor 無身分（機器 actor、不套 owner 過濾，行為與 M9 前完全相容）。以 discriminated
 * union（`kind` 為判別子）精確表達「session 有 id/email、apiKey 無」的結構差異（Design §18，`request.user =
 * { id?, email?, kind:'session'|'apiKey' }`）。
 */
export interface SessionActor {
  kind: 'session';
  id: string;
  email: string;
}

export interface ApiKeyActor {
  kind: 'apiKey';
}

export type AuthenticatedUser = SessionActor | ApiKeyActor;

/**
 * 最小結構化 request 表面（避免直接相依 express 型別，與 `CookieRequest`/`HttpExceptionFilter` 的 `*Like`
 * 慣例一致）：守衛只需讀 `headers`（`cookie` / `x-api-key`）並寫回 `user`。
 */
export interface AuthenticatedRequest {
  headers: Record<string, string | undefined>;
  user?: AuthenticatedUser;
}

/**
 * 可組合的認證策略（session / x-api-key…）。`CompositeAuthGuard` 依序試各 resolver：命中回 actor、
 * **未命中回 `null`（不拋）**——讓守衛續試下一策略，僅在全部落空時才 401（Task §T10.4 重構重點）。
 */
export interface AuthResolver {
  resolve(
    request: AuthenticatedRequest,
  ): Promise<AuthenticatedUser | null> | AuthenticatedUser | null;
}
