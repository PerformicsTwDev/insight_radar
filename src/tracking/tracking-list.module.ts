import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { trackingConfig } from '../config/tracking.config';
import { TopicsModule } from '../topics/topics.module';
import { TrackingListController } from './tracking-list.controller';
import { TrackingListService } from './tracking-list.service';

/**
 * Tracking 模組（T11.2 CRUD + T11.3 加成員）。`PrismaService` 為全域模組（@Global），無需在此 import。
 * 加成員的主題列展開（AC-28.4）複用 {@link TopicsModule} 匯出的 `TopicRepository`（讀 TopicRun/Cluster/
 * Assignment）；成員上限（AC-28.7）自 `trackingConfig`（`ConfigModule.forFeature` 提供 KEY token）。
 * 無新佇列（HTTP + DB only）；搜量刷新排程/時序讀取為 T11.5+（另模組/服務）。
 */
@Module({
  imports: [TopicsModule, ConfigModule.forFeature(trackingConfig)],
  controllers: [TrackingListController],
  providers: [TrackingListService],
  exports: [TrackingListService],
})
export class TrackingListModule {}
