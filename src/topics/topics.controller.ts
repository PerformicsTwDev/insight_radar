import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  type MessageEvent,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import { EMPTY, type Observable, of } from 'rxjs';
import { map, takeWhile } from 'rxjs/operators';
import { type JobEvent, JobEventsService } from '../queue/job-events.service';
import { TOPIC_JOB_EVENTS } from '../queue/topic-job-events.constants';
import type { TopicsResponse } from './build-topics-response';
import { CreateTopicRunDto } from './dto/create-topic-run.dto';
import { TERMINAL_TOPIC_STATUSES, type TopicRunStatus } from './topic-run.types';
import { TopicsService } from './topics.service';

function isTerminalEvent(event: JobEvent): boolean {
  return event.type === 'completed' || event.type === 'failed';
}

/** 即時事件 → `MessageEvent`（type=event 名、data=payload；failed 字串理由包成 `{error}`）。 */
function toMessageEvent(event: JobEvent): MessageEvent {
  if (event.type === 'failed') {
    return { type: 'failed', data: { error: event.data } };
  }
  return { type: event.type, data: event.data as MessageEvent['data'] };
}

/** 已終態 run 的單筆快照事件：completed/partial→completed（有結果，經 GET 取）；failed/canceled→failed。 */
function terminalSnapshot(ref: { runId: string; status: string }): MessageEvent {
  if (ref.status === 'completed' || ref.status === 'partial') {
    return { type: 'completed', data: { runId: ref.runId, status: ref.status } };
  }
  return { type: 'failed', data: { error: ref.status } };
}

/**
 * Topics HTTP 入口（T8.10，FR-15/18）。掛 `/api/v1/keyword-analyses/:id/topics`（巢狀於既有分析）。
 * 全域 `ApiKeyGuard`（缺/錯 key → 401）與 `ValidationPipe`（未宣告欄位 → 400）已套用。`create` 為
 * **enqueue-only**：委派 service 入列即回 202，路徑不呼叫任何外部 API（NFR-1）。
 */
@Controller('keyword-analyses')
export class TopicsController {
  constructor(
    private readonly service: TopicsService,
    @Inject(TOPIC_JOB_EVENTS) private readonly events: JobEventsService,
  ) {}

  /** 觸發分群 run（enqueue-only）。未知分析 → 404；snapshot 未 ready → 425/409（service 拋）。 */
  @Post(':id/topics')
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Param('id') id: string, @Body() dto: CreateTopicRunDto): Promise<{ topicJobId: string }> {
    return this.service.create(id, dto);
  }

  /** 取分群結果（clusters + 每字 labels）。無 run → 404（service 拋）。 */
  @Get(':id/topics')
  getTopics(@Param('id') id: string): Promise<TopicsResponse> {
    return this.service.getTopics(id);
  }

  /**
   * SSE 分群進度串流（FR-18；藍本 = keyword-analysis `@Sse`）。SSE key = runId（queue.add jobId=runId），
   * URL 為 analysisId → 先解析最新 run。**handler 必永遠 resolve**（NestJS SSE 對 reject 無 catch → hang，
   * 且 Node≥22 未處理 rejection 殺 process）：
   * - 無 run（含未知 analysis）→ 空串流即完成（正確 404 由 `GET` 負責）；
   * - 已終態 → 回終態快照並完成；
   * - 進行中 → 訂閱 `forJob(runId)`，收到 completed/failed 後 complete。
   *
   * failedReason 的祕密遮罩已於 {@link JobEventsService.route}（NFR-5）。
   */
  @Sse(':id/topics/stream')
  async stream(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    const ref = await this.service.getRunRef(id).catch(() => null); // 不可 reject
    if (!ref) {
      return EMPTY;
    }
    if (TERMINAL_TOPIC_STATUSES.has(ref.status as TopicRunStatus)) {
      return of(terminalSnapshot(ref));
    }
    return this.events.forJob(ref.runId).pipe(
      takeWhile((event) => !isTerminalEvent(event), true), // inclusive：發終態事件後才 complete
      map(toMessageEvent),
    );
  }
}
