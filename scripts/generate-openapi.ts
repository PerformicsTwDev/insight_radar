/**
 * 離線產出 `openapi.json`（不啟 HTTP server、不連 Redis/DB/外部服務——preview app 只反射路由）。
 * 由 `pnpm openapi:generate` 呼叫；CI 重跑後 `git diff --exit-code openapi.json` 做 drift check。
 *
 * NODE_ENV=test（package.json script 設定）→ 載入 committed dummy `.env.test` 通過 Joi 驗證；
 * 產出的 openapi.json **與 env 值無關**（只含路由/DTO 契約），故用 test 設定產出與正式一致。
 */
import { writeFileSync } from 'node:fs';
import { buildOpenApiDocument, serializeOpenApi } from '../src/openapi/build-openapi';
import { createOpenApiApp } from '../src/openapi/create-openapi-app';

const OUTPUT = 'openapi.json';

async function main(): Promise<void> {
  const app = await createOpenApiApp();
  try {
    writeFileSync(OUTPUT, serializeOpenApi(buildOpenApiDocument(app)));
    process.stdout.write(`${OUTPUT} generated\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`openapi generation failed: ${String(error)}\n`);
  process.exitCode = 1;
});
