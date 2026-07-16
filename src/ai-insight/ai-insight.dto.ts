import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { FilterSpecDto } from '../keywords/dto/filter-spec.dto';

/**
 * `POST /keyword-analyses/:id/ai-insight` body（T12.4，FR-32 / AC-32.1）。**契約 = `{ view, filters? }`**：
 * 刻意**不含 `select`/`sort`/`pagination`**（#476）——洞察總結的是「套用篩選後的訊號」而非欄位子集，聚合僅由
 * `(view, filters)` 決定（對齊 AC-32.2 的 filters-only 快取 key）。全域 whitelist ValidationPipe 會把未宣告欄位
 * （如舊 `select`）擋成 **400**（`forbidNonWhitelisted`）。`filters` 共用 `/query` 的 {@link FilterSpecDto}
 * （型別/`min<=max`/`null`→未設 正規化一致，S9）；view 是否已知、filters 是否屬該 view 白名單由
 * `SnapshotQueryService`/`QueryViewService` 於服務層把關（unknown-view→400）。
 */
export class AiInsightDto {
  @IsString()
  view!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FilterSpecDto)
  filters?: FilterSpecDto;
}
