import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { AI_SEARCH_QUEUE } from '../queue/queue.constants';
import type { CreateAiSearchAnalysisDto } from './ai-search.dto';
import { AiSearchRunRepository } from './ai-search-run.repository';
import type { AiSearchStatusResponse } from './ai-search-run.types';

/** DI token for AiSearchRunService 設定（由 module 從 queue config 組裝）。 */
export const AI_SEARCH_RUN_CONFIG = Symbol('AI_SEARCH_RUN_CONFIG');

export interface AiSearchRunConfig {
  schemaVersion: string;
  jobAttempts: number;
  jobBackoffMs: number;
  jobBackoffJitter: number;
}

/**
 * AiSearchRunService（T14.6，FR-41/AC-41.1）。`create` = **enqueue-only**（NFR-1，POST 路徑零外部呼叫）：owner 歸屬
 * → idempotency（owner + 語意輸入 canonical key）→ `createRun`（命中回同一 jobId；terminal-failed/canceled→reset
 * 重入列）→ 僅 created 才入列。SerpAPI pull / extension push 合流皆在 worker（processor）。（實作於 green。）
 */
@Injectable()
export class AiSearchRunService {
  private readonly logger = new Logger(AiSearchRunService.name);

  constructor(
    @InjectQueue(AI_SEARCH_QUEUE) private readonly queue: Queue,
    private readonly repo: AiSearchRunRepository,
    @Inject(AI_SEARCH_RUN_CONFIG) private readonly config: AiSearchRunConfig,
  ) {}

  create(_dto: CreateAiSearchAnalysisDto, _actor: AuthenticatedUser): Promise<{ jobId: string }> {
    void this.queue;
    void this.repo;
    void this.config;
    this.logger.debug('stub');
    throw new Error('AiSearchRunService.create not implemented');
  }

  getStatus(_id: string, _actor: AuthenticatedUser): Promise<AiSearchStatusResponse> {
    throw new Error('AiSearchRunService.getStatus not implemented');
  }

  getRunRef(
    _id: string,
    _actor: AuthenticatedUser,
  ): Promise<{ runId: string; status: string } | null> {
    throw new Error('AiSearchRunService.getRunRef not implemented');
  }
}
