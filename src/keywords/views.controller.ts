import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ViewRegistry } from './views';
import type { ViewMetadata } from './views';

/**
 * `GET /api/v1/views`（FR-22/NFR-10）：view-router 自省端點。回各 view 的白名單能力
 * （allowedSelect/Filters/Sort）+ 回應形狀 `kind` + 依賴 feature——**由 `ViewRegistry` 導出、與 `/query`
 * 同源**（不另抄白名單），前端據此驅動 dashboard tab/欄位/篩選 config。新增 ViewDefinition 自動出現（閉環）。
 * 全域 `ApiKeyGuard` 已套用（非 `@Public` → 缺/錯 key 回 401）。
 */
@ApiTags('views')
@Controller('views')
export class ViewsController {
  constructor(private readonly registry: ViewRegistry) {}

  @Get()
  list(): { views: ViewMetadata[] } {
    return { views: this.registry.metadata() };
  }
}
