import {
  Body,
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
import { CUSTOM_CLASSIFY_JOB_EVENTS } from '../queue/custom-classify-job-events.constants';
import { CustomClassifyAssignDto } from './custom-classify-assign.dto';
import {
  CustomClassifyRunService,
  type CustomClassifyStatusResponse,
} from './custom-classify-run.service';
import {
  TERMINAL_CUSTOM_CLASSIFY_STATUSES,
  type CustomClassifyRunStatus,
} from './custom-classify-run.types';

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

/** 已終態 run 的單筆快照事件：completed→completed（有結果，經 GET/query 取）；failed→failed。 */
function terminalSnapshot(ref: { runId: string; status: string }): MessageEvent {
  if (ref.status === 'completed') {
    return { type: 'completed', data: { runId: ref.runId, status: ref.status } };
  }
  return { type: 'failed', data: { error: ref.status } };
}

/**
 * 自訂分類**階段二** HTTP 入口（T12.8，FR-34/AC-34.2）。掛
 * `/api/v1/keyword-analyses/:id/custom-classifications/:cid/assignments`（巢狀於階段一的分類定義）。全域
 * `CompositeAuthGuard`（缺/錯 key → 401）已套用；`:id`/`:cid` 經 `ParseUUIDPipe`（非 UUID → 400）。`create`
 * 為 **enqueue-only**：委派 service 入列即回 202（NFR-1，不呼叫外部 API）。label 表經 `POST /query
 * {view:'custom:{cid}'}`（view-router，免專屬端點，T12.9）。狀態映射沿用 service 單點（owner/存在性 404、空標籤
 * 409、超量 413）。
 */
@ApiTags('custom-classify')
@Controller('keyword-analyses')
export class CustomClassifyAssignController {
  constructor(
    private readonly service: CustomClassifyRunService,
    @Inject(CUSTOM_CLASSIFY_JOB_EVENTS) private readonly events: JobEventsService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  /** 觸發整批歸類 run（enqueue-only）。未知/他人 cid / cid 不屬 :id→404；空確認標籤→409；keyword 超上限→413。 */
  @Post(':id/custom-classifications/:cid/assignments')
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cid', ParseUUIDPipe) cid: string,
    @Body() dto: CustomClassifyAssignDto,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<{ jobId: string }> {
    return this.service.create(id, cid, dto.labels, actor);
  }

  /** 取最新 run 狀態（輪詢）。無 run→404（service 拋）。 */
  @Get(':id/custom-classifications/:cid/assignments')
  getStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cid', ParseUUIDPipe) cid: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<CustomClassifyStatusResponse> {
    return this.service.getStatus(id, cid, actor);
  }

  /**
   * SSE 進度串流。SSE key = runId（queue.add jobId=runId），URL 為 (analysisId, cid) → 先解析最新 run。
   * **handler 必永遠 resolve**（NestJS SSE 對 reject 無 catch → hang）：無 run（含未知/他人/cid 不屬 :id）→ 空串流；
   * 已終態 → 終態快照並完成；進行中 → 訂閱 `forJob(runId)`，收到 completed/failed 後 complete。
   */
  @Sse(':id/custom-classifications/:cid/assignments/stream')
  async stream(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cid', ParseUUIDPipe) cid: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<Observable<MessageEvent>> {
    const ref = await this.service.getRunRef(id, cid, actor).catch(() => null); // 不可 reject
    if (!ref) {
      return EMPTY;
    }
    if (TERMINAL_CUSTOM_CLASSIFY_STATUSES.has(ref.status as CustomClassifyRunStatus)) {
      return of(terminalSnapshot(ref));
    }
    const events$ = this.events.forJob(ref.runId).pipe(
      takeWhile((event) => !isTerminalEvent(event), true), // inclusive：發終態事件後才 complete
      map(toMessageEvent),
    );
    return withHeartbeat(events$, this.config.sseHeartbeatMs);
  }
}
