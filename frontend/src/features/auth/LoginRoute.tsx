import { useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { login } from '../../api/auth';
import { authProvider } from '../../api/client';
import { setApiKey, type AuthProvider } from '../../lib/auth/authProvider';
import { consumePendingRedirect } from './unauthorizedRedirect';

/**
 * Login page (T1.4, FR-12; TC-23). Renders the credential form for the active
 * {@link AuthProvider}: `session` → email + password (→ httpOnly cookie);
 * `apiKey` → a transitional key stored in sessionStorage (C9 write via
 * {@link setApiKey}; never localStorage — NFR-5). Switching provider changes only
 * this page — business components are untouched.
 *
 * On success it returns the user to the URL captured before the 401 (or `/`). A
 * 401 shows a **generic** error (never enumerates whether email or password was
 * wrong).
 */

const GENERIC_LOGIN_ERROR = '登入失敗，請確認電子郵件與密碼';
const EMPTY_KEY_ERROR = '請輸入 API 金鑰';

export function LoginRoute({ provider = authProvider }: { provider?: AuthProvider } = {}) {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKeyValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Return to the captured deep link, or `/` when there is none. */
  function goAfterLogin(): void {
    const target = consumePendingRedirect();
    if (target) router.history.push(target);
    else void router.navigate({ to: '/' });
  }

  async function onSessionSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await login({ email, password });
    setSubmitting(false);
    if (result.ok) goAfterLogin();
    else setError(GENERIC_LOGIN_ERROR);
  }

  function onApiKeySubmit(e: FormEvent): void {
    e.preventDefault();
    const key = apiKey.trim();
    if (!key) {
      setError(EMPTY_KEY_ERROR);
      return;
    }
    setApiKey(key); // C9 single write point (sessionStorage only)
    goAfterLogin();
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center gap-6">
      <h1 className="text-xl font-semibold text-brand">登入 Insight Radar</h1>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {provider.kind === 'apiKey' ? (
        <form onSubmit={onApiKeySubmit} className="flex flex-col gap-4" aria-label="API 金鑰登入">
          <label className="flex flex-col gap-1 text-sm">
            <span>API 金鑰</span>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKeyValue(e.target.value)}
              className="rounded-lg border border-white/15 bg-transparent px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-black"
          >
            登入
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => void onSessionSubmit(e)}
          className="flex flex-col gap-4"
          aria-label="電子郵件登入"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span>電子郵件</span>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-white/15 bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>密碼</span>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-white/15 bg-transparent px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            登入
          </button>
        </form>
      )}
    </div>
  );
}
