import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';

/** 預設對外前綴；對齊 src/main.ts（可由 `API_PREFIX` 覆寫，NFR-10）。 */
const DEFAULT_API_PREFIX = 'api/v1';

/**
 * 為 e2e 測試啟動完整 Nest app，**鏡像 `src/main.ts` 的 bootstrap**
 * （全域 `/api/v1` 前綴、`/health` 排除）。
 *
 * 呼叫端負責在 `afterAll` 收掉 `await app.close()`（TC-26，避免 Jest hang）。
 */
export async function createTestApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication<App> = moduleRef.createNestApplication();
  app.setGlobalPrefix(process.env.API_PREFIX ?? DEFAULT_API_PREFIX, { exclude: ['health'] });
  await app.init();
  return app;
}
