import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow } from '../common/owner-scope';
import { PrismaService } from '../prisma/prisma.service';
import { TRACKING_REFRESH_QUEUE } from '../queue/queue.constants';
import { MANUAL_REFRESH_JOB, type TrackingRefreshJobPayload } from './tracking-refresh.processor';

/** 手動刷新入列回應（AC-29.6）：最小 202 body。 */
export interface EnqueueRefreshResult {
  status: 'queued';
  listId: string;
}

/**
 * per-list single-flight 的 BullMQ jobId（由 `listId` 導出，T11.5 review 要求）：同清單並發手動入列時，
 * BullMQ 對「既有 jobId」不重複入列（等待/執行中者去重）；job 完成即 `removeOnComplete` 釋放此 jobId、
 * 下一次手動刷新可再入列（否則首個已完成 job 會永久佔用該 id、後續入列全被忽略）。
 */
export function manualRefreshJobId(listId: string): string {
  return `refresh:${listId}`;
}

/**
 * TrackingRefreshService（T11.6，FR-29 AC-29.6 · NFR-16）——手動即時刷新的**入列生產者**。owner-scope 唯一
 * 強制點在此 service 層（FR-27）：入列前先 `assertOwnedRow`（載入清單、非 owner/不存在 → 同一 404），
 * **不**由 controller 或請求參數繞過。排程遍歷刷新與 worker 端在 {@link TrackingRefreshProcessor}。
 */
@Injectable()
export class TrackingRefreshService {
  constructor(
    @InjectQueue(TRACKING_REFRESH_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 手動即時刷新入列（AC-29.6，【should】）：owner 守門後入列一次即時刷新 job（沿用同一批次刷新路徑 +
   * 限流器）；回 `{ status:'queued', listId }`（controller 202）。per-list single-flight 由 jobId dedup 保證。
   *
   * owner-scope（FR-27）：只讀 `id/ownerId` 判定——非 owner / 不存在皆丟**同一** 404（不洩漏存在性），且
   * **先於入列**（不對他人資源觸發刷新）。apiKey 機器 actor 不套 owner 過濾（AC-27.5，`assertOwnedRow` 內建）。
   */
  async enqueueManualRefresh(
    listId: string,
    actor: AuthenticatedUser,
  ): Promise<EnqueueRefreshResult> {
    const list = await this.prisma.trackingList.findUnique({
      where: { id: listId },
      select: { id: true, ownerId: true },
    });
    assertOwnedRow(list, actor, notFoundMessage(listId));

    const payload: TrackingRefreshJobPayload = { listId };
    // per-list single-flight：jobId 由 listId 導出（等待/執行中的同清單 job 去重）；removeOnComplete/Fail 讓
    // job 終結後釋放 jobId、下一次手動刷新可再入列（否則已完成 job 的 jobId 永久佔位、後續 add 全被忽略）。
    await this.queue.add(MANUAL_REFRESH_JOB, payload, {
      jobId: manualRefreshJobId(listId),
      removeOnComplete: true,
      removeOnFail: true,
    });
    return { status: 'queued', listId };
  }
}

/** 越權/不存在的**同一** 404 訊息（不洩漏存在性，FR-27；比照 `TrackingListService`）。 */
function notFoundMessage(listId: string): string {
  return `Tracking list ${listId} not found`;
}
