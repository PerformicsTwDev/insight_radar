import { ApiProperty } from '@nestjs/swagger';

/**
 * SSE 事件 payload 的 OpenAPI 契約（FR-9/FR-22，Design §6.3）。`@Sse` 回 `Observable<MessageEvent>`，
 * swagger 無法自 route 反推事件形狀 → 以顯式 DTO 描述，經 `@ApiExtraModels` 註冊進 components.schemas，
 * 供前端 typed client 產生 SSE 事件型別。三種 `event:` 對映三個 DTO（progress / completed / failed）。
 */
export class SseProgressEventDto {
  @ApiProperty({ example: 'intent', description: '目前階段（expand/intent/persist…）' })
  phase!: string;

  @ApiProperty({ example: 72, minimum: 0, maximum: 100 })
  percent!: number;

  @ApiProperty({ required: false, example: 1980 })
  expanded?: number;

  @ApiProperty({ required: false, example: 1420 })
  labeled?: number;

  @ApiProperty({ required: false, example: 1980 })
  total?: number;
}

export class SseCompletedEventDto {
  @ApiProperty({
    nullable: true,
    type: String,
    example: '6f…uuid',
    description: '結果 snapshot id（partial 亦以此收尾）',
  })
  resultSnapshotId!: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 1980 })
  count!: number | null;
}

export class SseFailedEventDto {
  @ApiProperty({
    example: 'RESOURCE_EXHAUSTED after 5 retries',
    description: '失敗理由（已 scrubSecrets 遮罩）',
  })
  error!: string;
}
