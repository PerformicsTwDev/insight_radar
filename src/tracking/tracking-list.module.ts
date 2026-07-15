import { Module } from '@nestjs/common';
import { TrackingListController } from './tracking-list.controller';
import { TrackingListService } from './tracking-list.service';

/**
 * Tracking 模組（T11.2，FR-28）——追蹤清單 CRUD。`PrismaService` 為全域模組（@Global），無需在此 import。
 * 無新佇列（HTTP + DB only）；搜量刷新排程/時序讀取為 T11.5+（另模組/服務）。
 */
@Module({
  controllers: [TrackingListController],
  providers: [TrackingListService],
  exports: [TrackingListService],
})
export class TrackingListModule {}
