import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  type MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { EMPTY, type Observable, of } from 'rxjs';
import { map, takeWhile } from 'rxjs/operators';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { CurrentActor } from '../common/current-actor.decorator';
import { withHeartbeat } from '../common/sse-heartbeat';
import { appConfig } from '../config/app.config';
import { type JobEvent, JobEventsService } from '../queue/job-events.service';
import { JOURNEY_JOB_EVENTS } from '../queue/journey-job-events.constants';
import { JourneyRunService, type JourneyStatusResponse } from './journey-run.service';
import { TERMINAL_JOURNEY_STATUSES, type JourneyRunStatus } from './journey-run.types';

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

/** 已終態 run 的單筆快照事件：completed/partial→completed（有結果，經 GET/query 取）；failed/canceled→failed。 */
function terminalSnapshot(ref: { runId: string; status: string }): MessageEvent {
  if (ref.status === 'completed' || ref.status === 'partial') {
    return { type: 'completed', data: { runId: ref.runId, status: ref.status } };
  }
  return { type: 'failed', data: { error: ref.status } };
}

/**
 * 購買歷程分類 HTTP 入口（T12.6，FR-33/AC-33.6）。掛 `/api/v1/keyword-analyses/:id/journey`（巢狀於既有分析）。
 * 全域 `CompositeAuthGuard`（缺/錯 key → 401）已套用。`:id` 經 `ParseUUIDPipe`（**非 UUID → 400**，避免 Prisma
 * UUID 欄位 P2023 → 500，與 ai-insight/custom-classify/topics siblings 一致，M12-R6）。`create` 為 **enqueue-only**：
 * 委派 service 入列即回 202（NFR-1，不呼叫外部 API）。stage 表 / 漏斗經 `POST /query {view:'journey'|'journey_funnel'}`
 * （view-router，免專屬端點）。
 */
@ApiTags('journey')
@Controller('keyword-analyses')
export class JourneyController {
  constructor(
    private readonly service: JourneyRunService,
    @Inject(JOURNEY_JOB_EVENTS) private readonly events: JobEventsService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  /** 觸發整批分類 run（enqueue-only）。未知/他人分析→404；snapshot 未 ready→425/409；keyword 超上限→413（service 拋）。 */
  @Post(':id/journey')
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<{ journeyJobId: string }> {
    return this.service.create(id, actor);
  }

  /** 取最新 run 狀態（輪詢）。無 run→404（service 拋）。 */
  @Get(':id/journey')
  getStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<JourneyStatusResponse> {
    return this.service.getStatus(id, actor);
  }

  /**
   * SSE 進度串流（藍本 = topics `@Sse`）。SSE key = runId（queue.add jobId=runId），URL 為 analysisId → 先解析最新 run。
   * **handler 必永遠 resolve**（NestJS SSE 對 reject 無 catch → hang）：無 run（含未知/他人 analysis）→ 空串流；
   * 已終態 → 終態快照並完成；進行中 → 訂閱 `forJob(runId)`，收到 completed/failed 後 complete。祕密遮罩於 `JobEventsService.route`。
   */
  @Sse(':id/journey/stream')
  async stream(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<Observable<MessageEvent>> {
    const ref = await this.service.getRunRef(id, actor).catch(() => null); // 不可 reject
    if (!ref) {
      return EMPTY;
    }
    if (TERMINAL_JOURNEY_STATUSES.has(ref.status as JourneyRunStatus)) {
      return of(terminalSnapshot(ref));
    }
    const events$ = this.events.forJob(ref.runId).pipe(
      takeWhile((event) => !isTerminalEvent(event), true), // inclusive：發終態事件後才 complete
      map(toMessageEvent),
    );
    return withHeartbeat(events$, this.config.sseHeartbeatMs);
  }
}
