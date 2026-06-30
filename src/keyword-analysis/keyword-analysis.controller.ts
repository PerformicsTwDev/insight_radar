import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { EMPTY, type Observable, of } from 'rxjs';
import { map, takeWhile } from 'rxjs/operators';
import { JobEventsService } from '../queue/job-events.service';
import type { JobEvent } from '../queue/job-events.service';
import { CreateKeywordAnalysisDto } from './dto/create-keyword-analysis.dto';
import { KeywordAnalysisService } from './keyword-analysis.service';
import type {
  AnalysisParams,
  AnalysisStatus,
  AnalysisStatusResponse,
} from './keyword-analysis.service';

/** 終態（§6.8 狀態機）：到此不再有後續事件。 */
const TERMINAL_STATUSES: ReadonlySet<AnalysisStatus> = new Set<AnalysisStatus>([
  'completed',
  'failed',
  'canceled',
]);

function isTerminalEvent(event: JobEvent): boolean {
  return event.type === 'completed' || event.type === 'failed';
}

/**
 * KeywordAnalysis HTTP 入口（T3.3/T3.4/T3.9，FR-1/8/9）。掛 `/api/v1/keyword-analyses`（全域前綴）。
 * 全域 `ApiKeyGuard`（缺/錯 key → 401）與 `ValidationPipe`（空 seeds/缺 geo·language/非法 mode → 400）
 * 已套用。`create` 為 **enqueue-only**：委派 service 入列即回 202，路徑不呼叫任何外部 API（NFR-1）。
 */
@Controller('keyword-analyses')
export class KeywordAnalysisController {
  private readonly logger = new Logger(KeywordAnalysisController.name);

  constructor(
    private readonly service: KeywordAnalysisService,
    private readonly events: JobEventsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() dto: CreateKeywordAnalysisDto): Promise<{ analysisId: string }> {
    const params: AnalysisParams = {
      geo: dto.geo,
      language: dto.language,
      mode: dto.mode ?? 'expand',
      includeAdult: dto.includeAdult ?? false,
      network: dto.network ?? 'GOOGLE_SEARCH',
    };
    return this.service.create({ seeds: dto.seeds, params });
  }

  /** 輪詢分析狀態（T3.4，FR-8）。不存在的 id → 404（service 拋 NotFoundException）。 */
  @Get(':id')
  getStatus(@Param('id') id: string): Promise<AnalysisStatusResponse> {
    return this.service.getStatus(id);
  }

  /**
   * SSE 進度串流（T3.9，FR-9）：把 {@link JobEventsService.forJob} 的事件映射成 `MessageEvent`
   * （`type`=event 名、`data`=payload，wire 為 `event: progress` / `data: {...}`，Design §6.3），
   * 收到 `completed`/`failed` 後 `complete()`（`takeWhile` inclusive）；多 client 同 job 互不干擾。
   *
   * 先查狀態（DB 真實來源）以避免 race-hang：
   * - **不存在** → 回空串流即完成（正確 404 由 `GET :id` 負責；SSE 回應已送 200 header 無法改碼）；
   * - **已終態** → 回一筆終態快照並完成（forJob 對已終結 job 亦保證立即 complete，見其保留機制）；
   * - **進行中** → 訂閱 forJob 即時串流。輪詢（FR-8）為 SSE 的後備。
   *
   * handler **必須永遠 resolve**（NestJS SSE 對 reject 的 handler promise 無 catch → 會 hang，且
   * Node ≥22 未處理 rejection 會殺 process）：未知 id 與非預期錯誤皆**降級為空串流並記錄日誌**（NFR-6），
   * 不靜默吞亦不拖垮連線；真實狀態由 `GET :id`（FR-8）取得。
   */
  @Sse(':id/stream')
  async stream(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    const status = await this.fetchStatus(id);
    if (!status) {
      return EMPTY;
    }
    if (TERMINAL_STATUSES.has(status.status)) {
      return of(terminalSnapshot(status));
    }
    return this.events.forJob(id).pipe(
      takeWhile((event) => !isTerminalEvent(event), true), // inclusive：發出終態事件後才 complete
      map(toMessageEvent),
    );
  }

  /** 查狀態；不存在或非預期錯誤皆回 null（SSE handler 不可 reject）；非預期錯誤記錄日誌（不靜默吞）。 */
  private async fetchStatus(id: string): Promise<AnalysisStatusResponse | null> {
    try {
      return await this.service.getStatus(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      this.logger.error(
        `SSE status lookup failed for ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null; // 降級為空串流（與未知 id 同路徑）：不 hang、不殺 process、bug 由日誌可見。
    }
  }
}

/** 即時事件 → `MessageEvent`（type=event 名、data=payload；failed 的字串理由包成 `{error}`，§6.3）。 */
function toMessageEvent(event: JobEvent): MessageEvent {
  if (event.type === 'failed') {
    return { type: 'failed', data: { error: event.data } };
  }
  // progress→AnalysisProgress、completed→{count}（皆物件）；JobEvent.data 為 unknown，顯式收斂。
  return { type: event.type, data: event.data as MessageEvent['data'] };
}

/** 已終態 job 的單筆快照事件（completed→`{resultSnapshotId,count}`；failed/canceled→`{error}`，§6.3）。 */
function terminalSnapshot(status: AnalysisStatusResponse): MessageEvent {
  if (status.status === 'completed') {
    return { type: 'completed', data: status.result };
  }
  return { type: 'failed', data: { error: status.status } };
}
