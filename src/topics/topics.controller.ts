import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { TopicsResponse } from './build-topics-response';
import { CreateTopicRunDto } from './dto/create-topic-run.dto';
import { TopicsService } from './topics.service';

/**
 * Topics HTTP 入口（T8.10，FR-15/18）。掛 `/api/v1/keyword-analyses/:id/topics`（巢狀於既有分析）。
 * 全域 `ApiKeyGuard`（缺/錯 key → 401）與 `ValidationPipe`（未宣告欄位 → 400）已套用。`create` 為
 * **enqueue-only**：委派 service 入列即回 202，路徑不呼叫任何外部 API（NFR-1）。GET/`@Sse` 於 slice B。
 */
@Controller('keyword-analyses')
export class TopicsController {
  constructor(private readonly service: TopicsService) {}

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
}
