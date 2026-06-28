import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule, PrismaService } from 'src/prisma';

/**
 * 為 integration 測試啟動含 `PrismaModule` 的 Nest app（連 Testcontainers Postgres）。
 * `app.init()` 觸發 `PrismaService.onModuleInit`（$connect）；回傳已連線的 PrismaService。
 *
 * 呼叫端負責在 `afterAll` 收掉 `await app.close()`（onModuleDestroy → $disconnect，避免 Jest hang）。
 */
export async function createPrismaTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [PrismaModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}
