// RED stub (T6.5 / TC-38) — real implementation lands in the green commit.
// The OpenAPI contract *version lock* pairs with the generated schema.d.ts: it
// pins the backend `openapi.json` info.version that the committed codegen was
// produced from, so a backend contract version bump that isn't re-synced fails
// the drift gate (not just the existing shape diff in `openapi:check`).

export function extractVersion() {
  throw new Error('not implemented');
}

export function compareVersionLock() {
  throw new Error('not implemented');
}

export function runCheck() {
  throw new Error('not implemented');
}

export function runWrite() {
  throw new Error('not implemented');
}
