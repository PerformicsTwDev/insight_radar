import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import { queueConfig } from '../config/queue.config';
import { PrismaService } from '../prisma/prisma.service';
import { KEYWORD_ANALYSIS_QUEUE } from '../queue/queue.constants';
import { computeIdempotencyKey } from './idempotency';

/** 分析參數（地區/語言/模式等；保留於 `KeywordAnalysis.params`，亦進 idempotency hash）。 */
export interface AnalysisParams {
  geo: string;
  language: string;
  mode: 'expand' | 'exact';
  includeAdult: boolean;
  [key: string]: unknown;
}

/** `create` 輸入（已由 controller 的 DTO/ValidationPipe 驗證）。 */
export interface CreateAnalysisInput {
  seeds: string[];
  params: AnalysisParams;
}

/** 入列的 job payload（worker 端 `process` 取用）。 */
export interface AnalysisJobPayload {
  analysisId: string;
  seeds: string[];
  params: AnalysisParams;
}

/** `job:{analysisId}` 狀態摘要（輪詢/SSE 後備；DB 為真實來源）。 */
interface JobSummary {
  status: 'queued';
  progress: { phase: 'queued'; percent: 0 };
}

/**
 * KeywordAnalysisService（T3.2，FR-1）。`create` 負責：算 idempotency key → 命中即回舊
 * analysisId（不重複入列）→ 否則建 `KeywordAnalysis`（status='queued'）+ 入列 + 寫
 * `idemp:{hash}`/`job:{id}` 快取。**不**呼叫任何外部 API（Ads/LLM 一律在 worker，NFR-1）。
 */
@Injectable()
export class KeywordAnalysisService {
  constructor(
    @InjectQueue(KEYWORD_ANALYSIS_QUEUE) private readonly queue: Queue,
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
    @Inject(queueConfig.KEY) private readonly config: ConfigType<typeof queueConfig>,
  ) {}

  async create(input: CreateAnalysisInput): Promise<{ analysisId: string }> {
    const hash = computeIdempotencyKey(input.seeds, input.params);
    const idempKey = this.cache.buildKey(CacheNamespace.IDEMP, hash);

    // 快路徑：idemp 快取命中 → 回舊 id。
    const cached = await this.cache.get<string>(idempKey);
    if (cached !== undefined) {
      return { analysisId: cached };
    }

    const analysisId = randomUUID();

    // 慢路徑：以 DB `idempotencyKey @unique` 為「最終仲裁」。並發的相同提交可能都未命中快取、
    // 各自 mint 不同 uuid，但只有一個 create 成功；落敗者得 P2002 → 改回查既有列回其 analysisId
    // （NFR-8 並發下仍 idempotent，不對 client 拋 500）。
    try {
      await this.prisma.keywordAnalysis.create({
        data: {
          id: analysisId,
          status: 'queued',
          seeds: input.seeds,
          params: input.params as Prisma.InputJsonValue,
          progress: { phase: 'queued', percent: 0 },
          idempotencyKey: hash,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.keywordAnalysis.findUnique({
          where: { idempotencyKey: hash },
        });
        if (winner) {
          await this.cache.set(idempKey, winner.id, this.config.idempTtlMs);
          return { analysisId: winner.id };
        }
      }
      throw error;
    }

    // 入列。失敗（如 Redis 短暫不可用）必須補償刪除剛建立的列，否則留下無對應 job 的
    // `queued` 孤兒列：永不被處理，且重試會撞 P2002 而永久卡死。
    const payload: AnalysisJobPayload = {
      analysisId,
      seeds: input.seeds,
      params: input.params,
    };
    try {
      await this.queue.add(KEYWORD_ANALYSIS_QUEUE, payload, {
        jobId: analysisId,
        attempts: this.config.jobAttempts,
        backoff: { type: 'exponential', delay: this.config.jobBackoffMs },
      });
    } catch (error) {
      await this.prisma.keywordAnalysis.delete({ where: { id: analysisId } });
      throw error;
    }

    const summary: JobSummary = { status: 'queued', progress: { phase: 'queued', percent: 0 } };
    await this.cache.set(
      this.cache.buildKey(CacheNamespace.JOB, analysisId),
      summary,
      this.config.jobTtlMs,
    );
    await this.cache.set(idempKey, analysisId, this.config.idempTtlMs);

    return { analysisId };
  }
}

/** Prisma 唯一鍵衝突（P2002）判定。 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
