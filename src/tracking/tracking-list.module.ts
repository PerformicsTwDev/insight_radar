import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { trackingConfig } from '../config/tracking.config';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { QueueModule } from '../queue/queue.module';
import { TRACKING_REFRESH_QUEUE } from '../queue/queue.constants';
import { TopicsModule } from '../topics/topics.module';
import { SweepLeaseService } from './sweep-lease.service';
import { TrackingListController } from './tracking-list.controller';
import { TrackingListService } from './tracking-list.service';
import { TrackingRefreshProcessor } from './tracking-refresh.processor';
import { TrackingRefreshService } from './tracking-refresh.service';
import { VolumeRefreshService } from './volume-refresh.service';

/**
 * Tracking 模組（T11.2 CRUD + T11.3 加成員 + T11.5 搜量刷新服務 + T11.6 排程/手動刷新）。`PrismaService`
 * 為全域模組（@Global），無需在此 import。加成員的主題列展開（AC-28.4）複用 {@link TopicsModule} 匯出的
 * `TopicRepository`；成員/清單上限（AC-28.7）與刷新 cron 自 `trackingConfig`。
 *
 * 搜量刷新（FR-29）：{@link VolumeRefreshService} 經 {@link GoogleAdsModule} 匯出的 `GoogleAdsService`
 * （既有 adapter + AdsRateLimiter，不新增限流器）批次取數；`tracking-refresh` BullMQ queue 由 {@link QueueModule}
 * 的共享連線承載，{@link TrackingRefreshProcessor} 排程遍歷刷新、{@link TrackingRefreshService} 手動入列（owner 守門）。
 */
@Module({
  imports: [
    TopicsModule,
    GoogleAdsModule,
    QueueModule,
    BullModule.registerQueue({ name: TRACKING_REFRESH_QUEUE }),
    ConfigModule.forFeature(trackingConfig),
  ],
  controllers: [TrackingListController],
  providers: [
    TrackingListService,
    VolumeRefreshService,
    TrackingRefreshService,
    TrackingRefreshProcessor,
    SweepLeaseService,
  ],
  exports: [TrackingListService],
})
export class TrackingListModule {}
