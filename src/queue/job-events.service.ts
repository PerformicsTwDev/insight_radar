import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { scrubSecrets } from '../logger/redaction';
import { JOB_QUEUE_EVENTS } from './job-events.constants';

/** 統一的 job 事件（type + data）；progress→AnalysisProgress、completed→returnvalue、failed→reason。 */
export type JobEventType = 'progress' | 'completed' | 'failed';
export interface JobEvent {
  type: JobEventType;
  data: unknown;
}

/**
 * `bullmq` `QueueEvents` 的最小介面（DI 可注入真實 QueueEvents、測試可注入 fake EventEmitter）。
 * BullMQ listener 收 `(args, id)`；本服務只取 `args`，故簽名以單一 `args` 表示。
 */
export interface QueueEventsLike {
  on(event: string, listener: (args: unknown) => void): unknown;
  close(): Promise<void>;
}

/** BullMQ QueueEvents 各事件 payload 的子集（皆含 `jobId`）。 */
interface QueueEventArgs {
  jobId?: unknown;
  data?: unknown;
  returnvalue?: unknown;
  failedReason?: unknown;
}

/**
 * JobEventsService（T3.8，FR-9）：以**單一** `QueueEvents('keyword-analysis')` 橋接 BullMQ 事件到
 * 以 analysisId（= jobId，見 T3.2 `add({jobId})`）為 key 的 RxJS Subject。`forJob(analysisId)`
 * 只回該 job 的事件流；收到 `completed`/`failed` 後 `complete()`（終結串流、釋放 Subject）。
 *
 * 避免每 job 一個 QueueEvents（重構重點）；`onModuleDestroy` 關閉連線並結束所有開啟串流（NFR-8、防 hang）。
 * SSE 串流（T3.9）與輪詢（FR-8）皆建於此之上。
 */
/** 已終結 Subject 的保留上限（FIFO 驅逐）；防無界成長，同時讓 race/late forJob 立即 complete。 */
const MAX_RETAINED_TERMINATED = 1024;

@Injectable()
export class JobEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly subjects = new Map<string, Subject<JobEvent>>();
  /** 已終結 jobId 的插入序（FIFO）；只驅逐**已完成**的 Subject，不動進行中的。 */
  private readonly terminatedOrder: string[] = [];

  constructor(@Inject(JOB_QUEUE_EVENTS) private readonly queueEvents: QueueEventsLike) {}

  onModuleInit(): void {
    this.queueEvents.on('progress', (args) => this.route('progress', args));
    this.queueEvents.on('completed', (args) => this.route('completed', args));
    this.queueEvents.on('failed', (args) => this.route('failed', args));
  }

  async onModuleDestroy(): Promise<void> {
    for (const subject of this.subjects.values()) {
      subject.complete();
    }
    this.subjects.clear();
    this.terminatedOrder.length = 0;
    await this.queueEvents.close();
  }

  /**
   * 該 analysisId 的事件流（只收自己；收到 completed/failed 後串流 `complete()`）。
   *
   * 已終結的 job：對應 Subject 被**保留為已完成**（FIFO 上限驅逐），故**對已完成 job 呼叫 `forJob`
   * 會立即收到 `complete()`**（不 replay 既往 next 值）——避免 SSE 在「getStatus 與 forJob 之間 job
   * 完成」的 race 下開出永不完成的串流。仍建議 `@Sse` 先查 GET 狀態取終態快照資料（T3.4 為真實來源），
   * 本保留僅保證**不 hang**。
   */
  forJob(analysisId: string): Observable<JobEvent> {
    return this.subjectFor(analysisId).asObservable();
  }

  /** 把單一 QueueEvents 事件路由到對應 job 的 Subject；終結事件後 complete 並保留（FIFO 驅逐）。 */
  private route(type: JobEventType, args: unknown): void {
    const { jobId, data, returnvalue, failedReason } = (args ?? {}) as QueueEventArgs;
    if (typeof jobId !== 'string') {
      return; // 防呆：缺 jobId 的事件不路由。
    }
    const payload =
      type === 'progress'
        ? data
        : type === 'completed'
          ? parseReturnValue(returnvalue) // BullMQ 把 returnvalue 序列化為字串 → 還原
          : // failed：failedReason 為上游錯誤訊息（BullMQ 恆為字串），可夾帶連線字串密碼 / bearer token。live SSE
            // 為 client-facing sink（M7-R1/NFR-5）：在此**出站點**統一遮罩，涵蓋所有失敗來源（終態 UnrecoverableError
            // + 重試耗盡的原始錯誤），而非散落各拋出點——DB error 欄與 pino log 另於 onFailed 已遮罩。非字串（防呆）原樣過。
            typeof failedReason === 'string'
            ? scrubSecrets(failedReason)
            : failedReason;
    const subject = this.subjectFor(jobId);
    subject.next({ type, data: payload });
    if (type === 'completed' || type === 'failed') {
      subject.complete();
      this.retainTerminated(jobId);
    }
  }

  /** 保留已完成 Subject 供 late/racing forJob 立即 complete；逾上限驅逐最舊（只驅逐已終結者）。 */
  private retainTerminated(jobId: string): void {
    this.terminatedOrder.push(jobId);
    while (this.terminatedOrder.length > MAX_RETAINED_TERMINATED) {
      const evicted = this.terminatedOrder.shift();
      if (evicted !== undefined) {
        this.subjects.delete(evicted);
      }
    }
  }

  private subjectFor(analysisId: string): Subject<JobEvent> {
    let subject = this.subjects.get(analysisId);
    if (!subject) {
      subject = new Subject<JobEvent>();
      this.subjects.set(analysisId, subject);
    }
    return subject;
  }
}

/** BullMQ QueueEvents 的 `returnvalue` 為**序列化字串**；還原為結構化物件（空/非 JSON 原樣回）。 */
function parseReturnValue(returnvalue: unknown): unknown {
  if (typeof returnvalue !== 'string' || returnvalue.length === 0) {
    return returnvalue;
  }
  try {
    return JSON.parse(returnvalue);
  } catch {
    return returnvalue;
  }
}
