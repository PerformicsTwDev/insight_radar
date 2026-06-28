import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 全域 Prisma 模組（Design §5）。提供/匯出 `PrismaService`。
 *
 * T0.9 為骨架：以整合測試（Testcontainers Postgres）獨立驗證；待 M1 有消費者
 * 且 e2e 改接 Testcontainers 後再掛進 `AppModule`。
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
