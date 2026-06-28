import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 連線封裝（Design §5）。**Lazy connect**：不在 `onModuleInit` 急切 `$connect`，
 * 改於首次查詢時連線——使 app 在無 DB 時仍能啟動、由 `/health`（terminus）回報 DB 狀態，
 * 而非啟動即崩潰。`onModuleDestroy` `$disconnect` 收連線（搭配 main.ts `enableShutdownHooks`，防 Jest hang）。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
