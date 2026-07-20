import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
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
import { scrubSecrets } from '../logger/redaction';
import { type JobEvent, JobEventsService } from '../queue/job-events.service';
import { AI_SEARCH_JOB_EVENTS } from '../queue/ai-search-job-events.constants';
import { CreateAiSearchAnalysisDto } from './ai-search.dto';
import { AiSearchRunService } from './ai-search-run.service';
import type { AiSearchStatusResponse } from './ai-search-run.types';
import { TERMINAL_AI_SEARCH_STATUSES, type AiSearchRunStatus } from './ai-search-run.types';

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

/** 已終態 run 的單筆快照事件：completed/partial→completed（有結果）；failed/canceled→failed。 */
function terminalSnapshot(ref: { runId: string; status: string }): MessageEvent {
  if (ref.status === 'completed' || ref.status === 'partial') {
    return { type: 'completed', data: { runId: ref.runId, status: ref.status } };
  }
  return { type: 'failed', data: { error: ref.status } };
}

/**
 * AI Search 抓取 HTTP 入口（T14.6，FR-41/AC-41.x）。掛 `/api/v1/ai-search-analyses`（全域前綴）。全域
 * `CompositeAuthGuard`（缺/錯 key → 401）與 `ValidationPipe`（空 keywords/channels、未知渠道、非 UUID brandProfileId → 400）
 * 已套用。`create` 為 **enqueue-only**：委派 service 入列即回 202（`{jobId}`），路徑不呼叫任何外部 API（NFR-1）。`:id`
 * 經 `ParseUUIDPipe`（非 UUID → 400，避免 Prisma UUID 欄位 P2023 → 500，比照 siblings）。
 */
@ApiTags('ai-search-analyses')
@Controller('ai-search-analyses')
export class AiSearchController {
  private readonly logger = new Logger(AiSearchController.name);

  constructor(
    private readonly service: AiSearchRunService,
    @Inject(AI_SEARCH_JOB_EVENTS) private readonly events: JobEventsService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  /** 觸發抓取 job（enqueue-only）。回 202 `{jobId}`；idempotency 命中回同一 jobId（service）。 */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Body() dto: CreateAiSearchAnalysisDto,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<{ jobId: string }> {
    return this.service.create(dto, actor);
  }

  /** 輪詢抓取 run 狀態。未知 id / 非 owner → 404（service 拋 NotFoundException，FR-27）。 */
  @Get(':id')
  getStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<AiSearchStatusResponse> {
    return this.service.getStatus(id, actor);
  }

  /**
   * SSE 進度串流（藍本 = keyword-analysis `@Sse`）。SSE key = runId（= :id）。handler **必永遠 resolve**（NestJS SSE
   * 對 reject 無 catch → hang）：未知/他人 run → 空串流；已終態 → 終態快照並完成；進行中 → 訂閱 `forJob(runId)`
   * （heartbeat + inclusive takeWhile）。祕密遮罩於 `JobEventsService.route`。
   */
  @Sse(':id/stream')
  async stream(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<Observable<MessageEvent>> {
    const ref = await this.fetchRef(id, actor);
    if (!ref) {
      return EMPTY;
    }
    if (TERMINAL_AI_SEARCH_STATUSES.has(ref.status as AiSearchRunStatus)) {
      return of(terminalSnapshot(ref));
    }
    const events$ = this.events.forJob(ref.runId).pipe(
      takeWhile((event) => !isTerminalEvent(event), true), // inclusive：發終態事件後才 complete
      map(toMessageEvent),
    );
    return withHeartbeat(events$, this.config.sseHeartbeatMs);
  }

  /**
   * 查 run 參照（`getRunRef` 已把未知/他人收斂為 null，不拋）；僅餘非預期基礎設施錯 → 記錄日誌後降級 null
   * （SSE handler 不可 reject → 空串流；不靜默吞、祕密遮罩，NFR-5/6）。
   */
  private async fetchRef(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ runId: string; status: string } | null> {
    try {
      return await this.service.getRunRef(id, actor);
    } catch (error) {
      this.logger.error(
        `SSE ref lookup failed for ${id}`,
        scrubSecrets(error instanceof Error ? error.stack : String(error)),
      );
      return null;
    }
  }
}
