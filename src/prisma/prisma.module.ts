import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 全域 Prisma 模組（Design §5）。提供/匯出 `PrismaService`。
 *
 * 已掛進 `AppModule`（T0.7，供 `/health` DB 探針）；PrismaService 採 **lazy connect**，
 * 故 app 在無 DB 時仍能啟動（首次查詢才連線）。
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
