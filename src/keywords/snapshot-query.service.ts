import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { queryConfig } from '../config/query.config';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import { PrismaService } from '../prisma';
import { QueryViewService } from './query-view.service';
import type { QueryRequest, ViewResult } from './views';

/**
 * 讀取層入口（T5.5，FR-14，Design §6.5）：載入分析的**不可變** snapshot → 交 view-router 查詢。
 * `loadSnapshot` 讀 DB（真實來源）；`query` = load + route（白名單/上限違反 → 400 由 QueryViewService 拋）。
 */
@Injectable()
export class SnapshotQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly viewService: QueryViewService,
    @Inject(queryConfig.KEY) private readonly config: ConfigType<typeof queryConfig>,
  ) {}

  /** 讀分析的 snapshot 列（依 `rowIndex` 序）；未完成 / 未知 id / 無 snapshot → 空陣列（404/partial 由 controller 決定）。 */
  async loadSnapshot(analysisId: string): Promise<SnapshotRowData[]> {
    const analysis = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { resultSnapshotId: true },
    });
    if (!analysis?.resultSnapshotId) {
      return [];
    }
    const rows = await this.prisma.snapshotRow.findMany({
      where: { snapshotId: analysis.resultSnapshotId },
      orderBy: { rowIndex: 'asc' },
      select: { data: true },
    });
    return rows.map((row) => row.data as unknown as SnapshotRowData);
  }

  /** 載入 snapshot → 經 view-router 查詢（limits 取自 queryConfig）。 */
  async query(analysisId: string, request: QueryRequest): Promise<ViewResult> {
    const rows = await this.loadSnapshot(analysisId);
    return this.viewService.query(rows, request, {
      maxPageSize: this.config.maxPageSize,
      aggMaxBuckets: this.config.aggMaxBuckets,
      aggMaxGroups: this.config.aggMaxGroups,
    });
  }
}
