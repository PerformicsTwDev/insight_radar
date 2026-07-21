// OpenAPI contract *version lock* (T6.5 / NFR-2 / TC-38).
//
// openapi-typescript strips `info.version` from schema.d.ts, so shape drift
// (`openapi:check`) alone can't catch a backend contract *version* bump that
// leaves the generated types byte-identical. This script pins the backend
// `openapi.json` info.version into a committed artifact
// (src/api/openapi.version.json) next to the generated schema.d.ts:
//   - `--write` (chained from `openapi:gen`) regenerates the lock.
//   - `--check` (`openapi:lock-check`, run in `verify` + frontend.yml) fails
//     when the committed lock drifts from the live contract version.
// Kept dependency-free node tooling, like scripts/check-node.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Repo-root single-source contract + committed lock beside the generated schema.
const OPENAPI_PATH = resolve(HERE, '../../openapi.json');
const LOCK_PATH = resolve(HERE, '../src/api/openapi.version.json');

// ---- Pure helpers (unit-tested) ----

/** Extract the required non-empty string `info.version` from an OpenAPI doc. */
export function extractVersion(openapiDoc) {
  const version = openapiDoc?.info?.version;
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error(
      'openapi.json is missing a non-empty string `info.version` — cannot lock the contract version.',
    );
  }
  return version;
}

/** Compare the committed lock against the live contract version. */
export function compareVersionLock(lockedVersion, actualVersion) {
  if (lockedVersion === actualVersion) {
    return { ok: true, message: `openapi version lock ok ('${actualVersion}').` };
  }
  return {
    ok: false,
    message:
      `openapi version drift — committed lock is '${lockedVersion}' but ` +
      `../openapi.json is '${actualVersion}'. Run \`pnpm openapi:gen\` and commit ` +
      `src/api/schema.d.ts + src/api/openapi.version.json.`,
  };
}

// ---- Thin I/O wrappers (integration-tested over fixtures) ----

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Check the committed lock against the live contract version. */
export function runCheck({ openapiPath = OPENAPI_PATH, lockPath = LOCK_PATH } = {}) {
  const actualVersion = extractVersion(readJson(openapiPath));
  const lockedVersion = readJson(lockPath)?.version;
  return compareVersionLock(lockedVersion, actualVersion);
}

/** (Re)write the committed lock from the live contract version. */
export function runWrite({ openapiPath = OPENAPI_PATH, lockPath = LOCK_PATH } = {}) {
  const version = extractVersion(readJson(openapiPath));
  // 2-space indent + trailing newline == prettier canonical (survives format:check).
  writeFileSync(lockPath, `${JSON.stringify({ version }, null, 2)}\n`);
  return version;
}

// ---- CLI (`--write` from openapi:gen, `--check` from openapi:lock-check) ----

function main(argv) {
  const mode = argv[2];
  if (mode === '--write') {
    const version = runWrite();
    console.log(`openapi.version.json locked to '${version}'.`);
    return 0;
  }
  if (mode === '--check') {
    const { ok, message } = runCheck();
    if (!ok) {
      console.error(`::error::${message}`);
      return 1;
    }
    console.log(message);
    return 0;
  }
  console.error(`Unknown mode '${mode ?? ''}'. Usage: openapi-version-lock.mjs --write|--check`);
  return 2;
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
