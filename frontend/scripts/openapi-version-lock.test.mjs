/**
 * TC-38 (strengthened) — T6.5 / NFR-2: OpenAPI contract *version lock*.
 *
 * The backend contract version (`openapi.json` info.version) is locked into a
 * committed codegen artifact (frontend/src/api/openapi.version.json) alongside
 * the generated schema.d.ts. This suite proves the drift gate goes RED when the
 * backend contract version drifts from the committed lock and GREEN when in sync,
 * plus a live gate: the real committed lock must match the real openapi.json.
 *
 * Logic under test is the node build-tooling script `openapi-version-lock.mjs`
 * (out of app/browser + coverage scope, like scripts/check-node.mjs) — exercised
 * under the same `pnpm test` gate so version drift also fails CI's test job.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compareVersionLock,
  extractVersion,
  runCheck,
  runWrite,
} from './openapi-version-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_OPENAPI = resolve(HERE, '../../openapi.json');
const REAL_LOCK = resolve(HERE, '../src/api/openapi.version.json');

describe('compareVersionLock (pure)', () => {
  it('is ok when locked === actual', () => {
    const r = compareVersionLock('1', '1');
    expect(r.ok).toBe(true);
  });

  it('is NOT ok (drift → red) when locked !== actual, naming both versions', () => {
    const r = compareVersionLock('1', '2');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/drift/i);
    expect(r.message).toContain("'1'");
    expect(r.message).toContain("'2'");
  });
});

describe('extractVersion (pure)', () => {
  it('returns the info.version string', () => {
    expect(extractVersion({ info: { version: '3' } })).toBe('3');
  });

  it('throws when info.version is missing', () => {
    expect(() => extractVersion({ info: {} })).toThrow();
    expect(() => extractVersion({})).toThrow();
    expect(() => extractVersion(null)).toThrow();
  });

  it('throws when info.version is empty or not a string', () => {
    expect(() => extractVersion({ info: { version: '' } })).toThrow();
    expect(() => extractVersion({ info: { version: 2 } })).toThrow();
  });
});

describe('runCheck (fixtures) — TC-38 version drift gate', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'openapi-lock-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeFixtures = (openapiVersion, lockedVersion) => {
    const openapiPath = join(dir, 'openapi.json');
    const lockPath = join(dir, 'openapi.version.json');
    writeFileSync(openapiPath, JSON.stringify({ info: { version: openapiVersion } }));
    writeFileSync(lockPath, JSON.stringify({ version: lockedVersion }));
    return { openapiPath, lockPath };
  };

  it('GREEN when committed lock matches openapi.json version', () => {
    const r = runCheck(writeFixtures('7', '7'));
    expect(r.ok).toBe(true);
  });

  it('RED when backend bumped the version but the lock was not regenerated', () => {
    const r = runCheck(writeFixtures('2', '1'));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/drift/i);
  });
});

describe('runWrite (I/O) — regenerates the lock artifact', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'openapi-lock-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a canonical, prettier-compatible lock JSON pinned to the openapi version', () => {
    const openapiPath = join(dir, 'openapi.json');
    const lockPath = join(dir, 'openapi.version.json');
    writeFileSync(openapiPath, JSON.stringify({ info: { version: '9' } }));

    const written = runWrite({ openapiPath, lockPath });
    expect(written).toBe('9');

    const raw = readFileSync(lockPath, 'utf8');
    // 2-space indent + trailing newline == prettier canonical (survives format:check).
    expect(raw).toBe('{\n  "version": "9"\n}\n');
    expect(JSON.parse(raw).version).toBe('9');
  });
});

describe('live gate — committed lock is in sync with the real backend contract', () => {
  it('src/api/openapi.version.json matches ../../openapi.json info.version', () => {
    const r = runCheck({ openapiPath: REAL_OPENAPI, lockPath: REAL_LOCK });
    expect(r.ok).toBe(true);
  });
});
