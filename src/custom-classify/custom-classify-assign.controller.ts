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
import type { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { CurrentActor } from '../common/current-actor.decorator';
import { appConfig } from '../config/app.config';
import { JobEventsService } from '../queue/job-events.service';
import { CUSTOM_CLASSIFY_JOB_EVENTS } from '../queue/custom-classify-job-events.constants';
import { CustomClassifyAssignDto } from './custom-classify-assign.dto';
import {
  CustomClassifyRunService,
  type CustomClassifyStatusResponse,
} from './custom-classify-run.service';
import { TERMINAL_CUSTOM_CLASSIFY_STATUSES } from './custom-classify-run.types';
import { materializeSsePlan, planSseResponse } from './custom-classify-assign-sse';

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
    // 決策 + 物化皆下放至 gate 內（{@link planSseResponse}/{@link materializeSsePlan}）；此 handler 零分支純委派。
    const plan = planSseResponse(ref, TERMINAL_CUSTOM_CLASSIFY_STATUSES);
    return materializeSsePlan(plan, this.events, this.config.sseHeartbeatMs);
  }
}
