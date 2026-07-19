import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Job, Queue, Worker } from 'bullmq';
import { trackingConfig } from '../config/tracking.config';
import { scrubSecrets } from '../logger/redaction';
import { PrismaService } from '../prisma/prisma.service';
import { TRACKING_REFRESH_QUEUE } from '../queue/queue.constants';
import { SweepLeaseService } from './sweep-lease.service';
import { VolumeRefreshService } from './volume-refresh.service';

/** BullMQ job scheduler id（repeatable 排程刷新；upsert 冪等、重啟不重複註冊，AC-29.2）。 */
export const TRACKING_REFRESH_SCHEDULER_ID = 'tracking-refresh-daily';
/** 排程刷新 job 名稱（scheduler 產出的 job；payload 無 `listId` → 遍歷全部清單）。 */
export const SCHEDULED_REFRESH_JOB = 'scheduled-refresh';
/** 手動刷新 job 名稱（payload 帶 `listId` → 只刷新該清單，AC-29.6）。 */
export const MANUAL_REFRESH_JOB = 'manual-refresh';

/** job payload：`listId` 有值＝手動單清單刷新；無值＝排程遍歷全部清單（AC-29.2/29.6 共用 worker）。 */
export interface TrackingRefreshJobPayload {
  listId?: string;
}

/** 刷新 job 摘要（供測試/觀測斷言；partial 韌性 = failed 計數而不整批失敗，AC-29.5）。 */
export interface TrackingRefreshJobResult {
  total: number;
  refreshed: number;
  failed: number;
  /** 排程 sweep 因 single-flight 租約未搶到而跳過（#470；手動刷新不出現此旗標）。 */
  skipped?: boolean;
}

/**
 * TrackingRefreshProcessor（T11.6，FR-29 AC-29.2/29.5 · NFR-16）——排程 + 手動刷新的 BullMQ worker。
 *
 * - **排程（AC-29.2）**：`onApplicationBootstrap` 以 `TRACKING_REFRESH_CRON` 註冊 repeatable job scheduler
 *   （`upsertJobScheduler` 冪等、重啟不重複註冊）；觸發時（payload 無 `listId`）遍歷**所有**追蹤清單、逐一
 *   `VolumeRefreshService.refreshList`（各清單以自身 geo/language 刷新——refreshList 已處理；沿用既有
 *   `AdsRateLimiter` + exact 模式、不新增限流器、不放大 QPS，ADR-0001/NFR-16）。
 * - **手動（AC-29.6）**：payload 帶 `listId` → 只刷新該清單（owner 守門已於入列端 `TrackingRefreshService`
 *   完成，FR-27）。
 * - **降級不阻斷（AC-29.5）**：單一清單失敗只記數 + log，**不**中止其他清單（整批不 throw）。
 * - **graceful shutdown（NFR-9）**：`onModuleDestroy` 排空 worker（防 Jest hang）。
 *
 * `autorun:false`（同 keyword-analysis/topics processor，M3-R2）：BullExplorer 以 decorator 的**靜態**
 * WorkerOptions 建 worker（不受 provider override 影響）；若 autorun，測試以 ioredis-mock 會立即 busy-loop
 * （BullMQ `moveToActive` 需 `cmsgpack`，mock 不支援 → unhandled error 卡住 event loop）。故停用 autostart，
 * 待 `onApplicationBootstrap`（生產＝真 Redis）才 `run()`；stub 掉 processor 的測試不呼叫 bootstrap → worker 不跑。
 */
@Processor(TRACKING_REFRESH_QUEUE, { autorun: false })
export class TrackingRefreshProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TrackingRefreshProcessor.name);

  constructor(
    @InjectQueue(TRACKING_REFRESH_QUEUE) private readonly queue: Queue,
    private readonly volumeRefresh: VolumeRefreshService,
    private readonly prisma: PrismaService,
    private readonly sweepLease: SweepLeaseService,
    @Inject(trackingConfig.KEY) private readonly config: ConfigType<typeof trackingConfig>,
  ) {
    super();
  }

  /**
   * 註冊 repeatable 排程刷新（AC-29.2）並啟動 worker（`autorun:false` → 於此才 `run()`）。
   *
   * `upsertJobScheduler` 為冪等 upsert，每次啟動安全重註冊、不產生重複 scheduler。**best-effort**：註冊失敗
   * （如啟動瞬間 Redis 短暫不可用）只記 error、不讓整個 app 啟動失敗（NFR-5：訊息經 `scrubSecrets`，
   * ioredis 錯誤可夾帶 REDIS_URL 密碼）。`worker.run()` 為 fire-and-forget（在 worker close 前不 resolve）；
   * 其 rejection 以 catch 吞掉、不擋 bootstrap（同 keyword-analysis processor）。
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        TRACKING_REFRESH_SCHEDULER_ID,
        { pattern: this.config.refreshCron },
        { name: SCHEDULED_REFRESH_JOB },
      );
    } catch (error) {
      this.logger.error(`refresh scheduler registration failed: ${scrubSecrets(String(error))}`);
    }
    // autorun:false → 於此啟動 worker（run() 在 close 前不 resolve → fire-and-forget）。
    void this.worker.run().catch((error: unknown) => {
      this.logger.error(`worker run() failed: ${scrubSecrets(String(error))}`);
    });
  }

  /**
   * Graceful shutdown（NFR-9）：排空 in-flight job。讀 backing `_worker`（非 `this.worker` getter——後者在
   * worker 未初始化時擲錯），未初始化時安全 no-op（同 keyword-analysis/topics processor）。
   */
  async onModuleDestroy(): Promise<void> {
    const worker = (this as unknown as { _worker?: Worker })._worker;
    if (worker) {
      await worker.close();
    }
  }

  /**
   * 處理刷新 job：
   * - **手動（帶 `listId`）**：只刷該清單（owner 守門已於入列端）；per-list single-flight 由 `jobId` 保證。
   * - **排程 sweep（無 `listId`）**：進場先搶 **single-flight 租約**（#470）——搶到才遍歷全清單刷新、`finally`
   *   釋放；搶不到（已有進行中 sweep：排程堆積於 cron > sweep 時、或跨實例）→ **跳過**（回 `skipped:true`），
   *   避免重複刷新 + 雙耗 Ads 配額（NFR-16）。
   *
   * **partial 韌性（AC-29.5）**：單一清單失敗只記 `failed` + warn、續刷其餘（整批不 throw）；回摘要供觀測/測試斷言。
   */
  async process(job: Job<TrackingRefreshJobPayload>): Promise<TrackingRefreshJobResult> {
    if (typeof job.data.listId === 'string') {
      return this.refreshLists([job.data.listId]);
    }
    // 排程 sweep：single-flight 租約守門（#470，NFR-16）。搶不到 → 跳過（不重複刷新、不雙耗 Ads 配額）。
    const acquired = await this.sweepLease.acquire();
    if (!acquired) {
      this.logger.log('scheduled sweep skipped: another sweep is already in progress');
      return { total: 0, refreshed: 0, failed: 0, skipped: true };
    }
    try {
      const lists = await this.prisma.trackingList.findMany({ select: { id: true } });
      return await this.refreshLists(lists.map((list) => list.id));
    } finally {
      await this.sweepLease.release();
    }
  }

  /**
   * 逐一刷新指定清單（partial 韌性 AC-29.5）：單清單失敗只記 `failed` + warn、續刷其餘（整批不 throw）；
   * 表面化 per-member partial（`result.failed>0` → warn，M11-R2）。手動 / 排程 sweep 共用此迴圈。
   */
  private async refreshLists(listIds: string[]): Promise<TrackingRefreshJobResult> {
    let refreshed = 0;
    let failed = 0;
    for (const listId of listIds) {
      try {
        const result = await this.volumeRefresh.refreshList(listId);
        refreshed += 1;
        // 表面化 per-member partial 失敗（AC-29.5 / M11-R2）：否則系統性 Ads 故障與零星失敗不可辨。
        if (result.failed > 0) {
          this.logger.warn(
            `refreshList(${listId}) partial: ${result.failed}/${result.memberCount} members failed`,
          );
        }
      } catch (error) {
        // 降級不阻斷（AC-29.5）：一個清單失敗不中止其他清單；訊息 scrubSecrets（NFR-5）。
        failed += 1;
        this.logger.warn(
          `refreshList(${listId}) failed (continuing): ${scrubSecrets(String(error))}`,
        );
      }
    }
    return { total: listIds.length, refreshed, failed };
  }
}
