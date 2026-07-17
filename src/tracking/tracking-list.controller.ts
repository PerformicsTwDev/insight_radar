import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { CurrentActor } from '../common/current-actor.decorator';
import { AddMembersDto } from './dto/add-members.dto';
import { CreateTrackingListDto } from './dto/create-tracking-list.dto';
import { GetSeriesQueryDto } from './dto/get-series-query.dto';
import { RenameTrackingListDto } from './dto/rename-tracking-list.dto';
import { TrackingListService } from './tracking-list.service';
import type {
  AddMembersResult,
  RemoveMemberResult,
  TrackingListDetail,
  TrackingListSummary,
  TrackingListView,
} from './tracking-list.service';
import { TrackingRefreshService } from './tracking-refresh.service';
import type { EnqueueRefreshResult } from './tracking-refresh.service';
import type { VolumeSeriesResult } from './volume-series';

/**
 * TrackingList HTTP 入口（T11.2，FR-28）。掛 `/api/v1/tracking-lists`（全域前綴）。全域
 * `CompositeAuthGuard`（缺/錯認證→401）、`CsrfGuard`（session 狀態變更需同源 Origin）、`ValidationPipe`
 * （缺 name/geo/language→400）均已套用。**owner scope 強制在 service 層**（非 controller，AC-27.4）：
 * 建立歸屬 actor、列表/計數以 `ownerWhere` 過濾、單列越權/不存在 → 同一 404（不洩漏存在性）。
 */
@ApiTags('tracking-lists')
@Controller('tracking-lists')
export class TrackingListController {
  constructor(
    private readonly service: TrackingListService,
    private readonly refresh: TrackingRefreshService,
  ) {}

  /** 建立清單（AC-28.1）：ownerId=actor；缺欄位→400；同 owner 重名→409。回傳建立的清單（201）。 */
  @Post()
  create(
    @Body() dto: CreateTrackingListDto,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<TrackingListView> {
    return this.service.create(dto, actor);
  }

  /** 清單列表（AC-28.3）：以 `ownerWhere(actor)` 過濾；每列帶 `memberCount`。 */
  @Get()
  list(@CurrentActor() actor: AuthenticatedUser): Promise<TrackingListSummary[]> {
    return this.service.list(actor);
  }

  /** 清單詳情（AC-28.3）：metadata + 成員基本面。越權/不存在 → 404。 */
  @Get(':listId')
  getDetail(
    @Param('listId', ParseUUIDPipe) listId: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<TrackingListDetail> {
    return this.service.getDetail(listId, actor);
  }

  /**
   * 搜量時序讀取（AC-30.1~30.5）：回 `{ list, axis, total, members:[{…,latest,series}], summary }`。
   * `from`/`to` 過濾觀測時點（含端點；非法→400 via DTO）；`granularity` 目前 reserved（回原始觀測點）。
   * owner 守門於 service 層（越權/不存在→同一 404，不洩漏存在性）。
   */
  @Get(':listId/series')
  getSeries(
    @Param('listId', ParseUUIDPipe) listId: string,
    @Query() query: GetSeriesQueryDto,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<VolumeSeriesResult> {
    return this.service.getSeries(listId, { from: query.from, to: query.to }, actor);
  }

  /**
   * 加成員（AC-28.4/28.5/28.7）：關鍵字列 / 主題列展開攤平、`normalizedText` 去重聯集。越權/不存在→404；
   * 語境（geo/language）不符→400；達 `TRACKING_MAX_MEMBERS_PER_LIST`→409。回 `{ memberCount, added }`。
   */
  @Post(':listId/members')
  @HttpCode(HttpStatus.OK)
  addMembers(
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: AddMembersDto,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<AddMembersResult> {
    return this.service.addMembers(listId, dto, actor);
  }

  /**
   * 移除成員（AC-28.6）：越權/清單不存在→404；無此成員→404。`:normalizedText` 伺服器端再 `normalizeText`
   * （S4）後比對。回 `{ listId, normalizedText }`。
   */
  @Delete(':listId/members/:normalizedText')
  @HttpCode(HttpStatus.OK)
  removeMember(
    @Param('listId', ParseUUIDPipe) listId: string,
    @Param('normalizedText') normalizedText: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<RemoveMemberResult> {
    return this.service.removeMember(listId, normalizedText, actor);
  }

  /** 改名（AC-28.2）：越權/不存在→404；同 owner 重名→409。 */
  @Patch(':listId')
  rename(
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: RenameTrackingListDto,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<TrackingListView> {
    return this.service.rename(listId, dto, actor);
  }

  /** 刪除（AC-28.2）：cascade 移除成員（FK）；越權/不存在→404。 */
  @Delete(':listId')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('listId', ParseUUIDPipe) listId: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<{ listId: string }> {
    return this.service.remove(listId, actor);
  }

  /**
   * 手動即時刷新（AC-29.6，【should】）：入列一次即時刷新 job（沿用同一批次刷新路徑 + 限流器）→ `202`。
   * owner 守門於 `TrackingRefreshService`（service 層，FR-27）：越權/不存在 → 404，入列前擋掉。
   */
  @Post(':listId/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  refreshList(
    @Param('listId', ParseUUIDPipe) listId: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<EnqueueRefreshResult> {
    return this.refresh.enqueueManualRefresh(listId, actor);
  }
}
