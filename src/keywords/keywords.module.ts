import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { KeywordsController } from './keywords.controller';
import { QueryViewService } from './query-view.service';
import { SnapshotQueryService } from './snapshot-query.service';
import { ViewRegistry, createViewRegistry } from './views';

/**
 * 讀取層模組（T5.5，FR-14/NFR-10）：`ViewRegistry`（內建 view）+ `QueryViewService`（view-router 白名單）+
 * `SnapshotQueryService`（loadSnapshot + query）。queryConfig 由全域 ConfigModule 提供。M6 的 `POST /query`
 * controller 注入 `SnapshotQueryService`。新增 dashboard 表 = 多註冊一個 ViewDefinition（免改此模組）。
 */
@Module({
  imports: [PrismaModule],
  controllers: [KeywordsController],
  providers: [
    { provide: ViewRegistry, useFactory: createViewRegistry },
    QueryViewService,
    SnapshotQueryService,
  ],
  exports: [SnapshotQueryService],
})
export class KeywordsModule {}
