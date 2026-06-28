import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 連線封裝（Design §5）。`onModuleInit` 連線、`onModuleDestroy` 斷線
 * （搭配 main.ts 的 `enableShutdownHooks`，優雅關機、防 Jest hang）。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
