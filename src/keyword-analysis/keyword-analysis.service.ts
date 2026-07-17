import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { JobStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow, ownerIdOf, ownerWhere } from '../common/owner-scope';
import { scrubSecrets } from '../logger/redaction';
import { queryConfig } from '../config/query.config';
import { queueConfig } from '../config/queue.config';
import { PrismaService } from '../prisma/prisma.service';
import type { ListAnalysesQueryDto } from './dto/list-analyses-query.dto';
import { KEYWORD_ANALYSIS_QUEUE } from '../queue/queue.constants';
import { type FeaturesMap, computeFeatures } from './features';
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

/** 對外輪詢狀態（Design §6.2 / §6.8 狀態機）= DB `KeywordAnalysis.status` enum（6 值）。 */
export type AnalysisStatus = JobStatus;

/** 進度（與 processor `updateProgress` 對齊；phase/percent 必有，其餘階段性欄位 optional）。 */
export interface AnalysisProgress {
  phase: string;
  percent: number;
  expanded?: number;
  labeled?: number;
  total?: number;
}

/**
 * 輪詢回應（Design §6.2）。`result` 僅 completed 時帶實值，其餘為 null。`features` 回報各 dashboard feature
 * 狀態（T6.8，AC-14.7），前端據此對依賴未產生 compute 的 view 顯示「先執行 X」而非誤導空表。
 */
export interface AnalysisStatusResponse {
  status: AnalysisStatus;
  progress: AnalysisProgress;
  result: { resultSnapshotId: string | null; count: number | null };
  features: FeaturesMap;
}

const DEFAULT_PROGRESS: AnalysisProgress = { phase: 'queued', percent: 0 };

/** 歷史清單預設每頁筆數（AC-23.1；`pageSize` 上限另受 `QUERY_MAX_PAGE_SIZE` 把關）。 */
const DEFAULT_HISTORY_PAGE_SIZE = 20;

/** 歷史清單列（FR-23，AC-23.1）。 */
export interface AnalysisListRow {
  analysisId: string;
  status: AnalysisStatus;
  seeds: string[];
  params: { mode?: string; geo?: string; language?: string };
  createdAt: Date;
  finishedAt: Date | null;
  resultSnapshotId: string | null;
  count: number | null;
}

export interface AnalysesListResponse {
  data: AnalysisListRow[];
  meta: { total: number; page: number; pageSize: number };
}

/**
 * KeywordAnalysisService（T3.2，FR-1）。`create` 負責：算 idempotency key → 命中即回舊
 * analysisId（不重複入列）→ 否則建 `KeywordAnalysis`（status='queued'）+ 入列 + 寫
 * `idemp:{hash}`/`job:{id}` 快取。**不**呼叫任何外部 API（Ads/LLM 一律在 worker，NFR-1）。
 */
@Injectable()
export class KeywordAnalysisService {
  private readonly logger = new Logger(KeywordAnalysisService.name);

  constructor(
    @InjectQueue(KEYWORD_ANALYSIS_QUEUE) private readonly queue: Queue,
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
    @Inject(queueConfig.KEY) private readonly config: ConfigType<typeof queueConfig>,
    @Inject(queryConfig.KEY) private readonly queryCfg: ConfigType<typeof queryConfig>,
  ) {}

  /**
   * 分析歷史清單（T9.6，FR-23）：分頁 + `status` 過濾 + `createdAt desc`。`pageSize` 超 `QUERY_MAX_PAGE_SIZE`
   * → 400（沿用讀取層上限，AC-23.3）。**owner 過濾**（T10.6，AC-23.4/27.3/27.5）：session actor 只回自己
   * + 共享（null）列、apiKey 機器 actor 回全部——scope 由 `ownerWhere(actor)` 併入 `where`，`?ownerId=` 無法繞過。
   */
  async list(query: ListAnalysesQueryDto, actor: AuthenticatedUser): Promise<AnalysesListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_HISTORY_PAGE_SIZE;
    if (pageSize > this.queryCfg.maxPageSize) {
      throw new BadRequestException({
        code: 'QUERY_VALIDATION_FAILED',
        message: 'Query validation failed',
        fields: { pageSize: [`pageSize ${pageSize} exceeds max ${this.queryCfg.maxPageSize}`] },
      });
    }

    // owner scope 與 status 過濾複合（status AND (ownerId=self OR null)）；apiKey → ownerWhere={} 不過濾。
    const where: Prisma.KeywordAnalysisWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...ownerWhere(actor),
    };
    const skip = (page - 1) * pageSize;
    const total = await this.prisma.keywordAnalysis.count({ where });
    // M9-R4：越界 page（`skip ≥ total`）→ 短路回空頁，**不**對 DB 下越界 OFFSET 的 findMany。
    // 否則巨大 page 會讓 Postgres `OFFSET`（int8）溢位→500，或深 OFFSET 全掃→availability/DoS。
    if (skip >= total) {
      return { data: [], meta: { total, page, pageSize } };
    }
    const rows = await this.prisma.keywordAnalysis.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: { resultSnapshot: true },
    });

    return { data: rows.map(toListRow), meta: { total, page, pageSize } };
  }

  async create(
    input: CreateAnalysisInput,
    actor: AuthenticatedUser,
  ): Promise<{ analysisId: string }> {
    // owner 歸屬（AC-27.1）：session → actor.id、apiKey → null（機器資源）。**進 idempotency key 作為
    // owner 分範圍**（AC-1.4/#358）：owner-scope 下 A 的結果 B 讀不到，若 key 不含 owner，B 的相同請求會命中
    // A 的列、回**不可讀**的 analysisId（所有讀取路徑永久 404、dead-end）。session owner 各自去重；機器
    // actor（null）之間仍全域去重（既有 x-api-key 語意不變）。
    const ownerId = ownerIdOf(actor);
    const hash = computeIdempotencyKey(input.seeds, input.params, ownerId);
    const idempKey = this.cache.buildKey(CacheNamespace.IDEMP, hash);

    // 快路徑：idemp 快取命中 → 回舊 id。
    const cached = await this.cache.get<string>(idempKey);
    if (cached !== undefined) {
      return { analysisId: cached };
    }

    const analysisId = randomUUID();

    // 慢路徑：以 DB `idempotencyKey @unique` 為「最終仲裁」。並發的相同提交可能都未命中快取、
    // 各自 mint 不同 uuid，但只有一個 create 成功；落敗者得 P2002 → 依 freshness 窗解析
    // （NFR-8 並發下仍 idempotent，不對 client 拋 500）。
    try {
      await this.prisma.keywordAnalysis.create({
        data: this.buildQueuedRow(analysisId, hash, input, ownerId),
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.keywordAnalysis.findUnique({
        where: { idempotencyKey: hash },
      });
      // 窗內既有列（含並發相同提交的落敗者）→ idempotent 回舊 id（AC-1.4）。
      if (existing && this.isWithinIdempotencyWindow(existing.createdAt)) {
        await this.recacheIdempWithinWindow(idempKey, existing.id, existing.createdAt);
        return { analysisId: existing.id };
      }
      // 防禦：P2002 但列已消失（如並發刪除）→ 原錯上拋，不無限恢復。
      if (!existing) {
        throw error;
      }
      // M9-R2：既有列逾窗但**仍在處理中**（queued/running）→ 一律 coalesce 到它，不旋轉、不重複入列。
      // 否則 worker 落後 > `IDEMP_TTL_MS` 時，相同 seeds 的重送會為進行中的任務再建一個重複 job →
      // 雙倍 Google Ads 用量（freshness 窗只該管「終態結果是否陳舊」，不該把在途任務旋轉掉）。
      if (this.isInFlight(existing.status)) {
        await this.recacheIdempWithinWindow(idempKey, existing.id, existing.createdAt);
        return { analysisId: existing.id };
      }
      // #311：既有列逾窗且**已終態**——旋轉其唯一鍵讓位、建新任務，使 DB 慢路徑與 Redis 快路徑
      // freshness 語意一致（否則舊列的永久 unique key 會靜默擊穿窗、月後重跑同 seeds 仍回陳舊結果）。
      // 舊列（含其 snapshot/歷史）保留不刪。
      const reuse = await this.rotateExpiredAndCreate(
        existing,
        hash,
        idempKey,
        analysisId,
        input,
        ownerId,
      );
      if (reuse) return reuse; // 並發旋轉競態落敗 → 回勝者 id
      // else：舊列已讓位、新列已建 → 續往下入列（analysisId 為新任務）。
    }

    // 入列。失敗（如 Redis 短暫不可用）必須補償刪除剛建立的列，否則留下無對應 job 的
    // `queued` 孤兒列：永不被處理，且重試會撞 P2002 而永久卡死。
    const payload: AnalysisJobPayload = {
      analysisId,
      seeds: input.seeds,
      params: input.params,
    };
    try {
      // 兩層重試分工（NFR-9 / Design §11）：**BullMQ job-level retry 僅重跑暫時性基礎設施/Redis 故障**
      // （attempts + 指數退避 + jitter 散開）。Ads `RESOURCE_EXHAUSTED`/`RESOURCE_TEMPORARILY_EXHAUSTED` 由
      // **job 內** AdsRateLimiter 退避處理（T3.6），耗盡後 processor 以 `UnrecoverableError` 收尾（T7.1）
      // → **不**觸發整 job 重跑（避免重打 Ads、放大用量）。已快取批次於 retry 不重打 Ads（T4 cache-first）。
      await this.queue.add(KEYWORD_ANALYSIS_QUEUE, payload, {
        jobId: analysisId,
        attempts: this.config.jobAttempts,
        backoff: {
          type: 'exponential',
          delay: this.config.jobBackoffMs,
          jitter: this.config.jobBackoffJitter,
        },
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

  /** `queued` 列的 create data（idempotency 快/慢路徑共用，避免形狀漂移）。`ownerId` 由 actor 決定（AC-27.1）。 */
  private buildQueuedRow(
    analysisId: string,
    hash: string,
    input: CreateAnalysisInput,
    ownerId: string | null,
  ): Prisma.KeywordAnalysisUncheckedCreateInput {
    return {
      id: analysisId,
      status: 'queued',
      seeds: input.seeds,
      params: input.params as Prisma.InputJsonValue,
      progress: { phase: 'queued', percent: 0 },
      idempotencyKey: hash,
      ownerId,
    };
  }

  /** idempotency freshness 窗判定（#311）：Redis 快路徑與 DB 慢路徑共用同一 `IDEMP_TTL_MS` 語意。 */
  private isWithinIdempotencyWindow(createdAt: Date): boolean {
    return Date.now() - createdAt.getTime() <= this.config.idempTtlMs;
  }

  /** 非終態（仍在處理中）→ 相同 seeds 的重送一律 coalesce、不得旋轉/重複入列（M9-R2）。 */
  private isInFlight(status: string): boolean {
    return status === 'queued' || status === 'running';
  }

  /**
   * 窗內既有列的 idemp re-cache（M9-R3）：TTL = **剩餘窗**（`createdAt + idempTtlMs − now`），使 Redis
   * 快路徑與 DB freshness 窗**同時**失效、不隨每次重送從 now 起算全 TTL 而延壽（否則逾 DB 窗後快路徑仍
   * 命中、回陳舊 analysisId）。剩餘 ≤ 0（逾窗 in-flight 的 coalesce）則不寫快取，避免延壽。
   */
  private async recacheIdempWithinWindow(
    idempKey: string,
    id: string,
    createdAt: Date,
  ): Promise<void> {
    const remainingMs = createdAt.getTime() + this.config.idempTtlMs - Date.now();
    if (remainingMs > 0) {
      await this.cache.set(idempKey, id, remainingMs);
    }
  }

  /**
   * #311 慢路徑修正：既有列逾 freshness 窗時，把其 `idempotencyKey` 旋轉成不與任何真實 hash 相碰的
   * 存檔值（保留列本身），讓出唯一鍵後建新任務。回傳非 null＝並發旋轉競態下他人已建新列 → 回其 id。
   */
  private async rotateExpiredAndCreate(
    existing: { id: string },
    hash: string,
    idempKey: string,
    analysisId: string,
    input: CreateAnalysisInput,
    ownerId: string | null,
  ): Promise<{ analysisId: string } | null> {
    await this.prisma.keywordAnalysis.update({
      where: { id: existing.id },
      data: { idempotencyKey: expiredIdempotencyKey(hash, existing.id) },
    });
    try {
      await this.prisma.keywordAnalysis.create({
        data: this.buildQueuedRow(analysisId, hash, input, ownerId),
      });
      return null;
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
  }

  /**
   * 輪詢狀態（T3.4，FR-8）。**DB `KeywordAnalysis` 為真實來源**（§6.8 狀態機含 `partial`/`canceled`，
   * BullMQ `JobState` 無此語意，且 job 可能在 retention 後被逐出 → 不可僅讀 queue）。
   * 不存在 → 404；completed/partial 時自關聯 `ResultSnapshot` 取 `resultSnapshotId`+`count`（AC-8.4）。
   */
  async getStatus(analysisId: string, actor: AuthenticatedUser): Promise<AnalysisStatusResponse> {
    const row = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      include: { resultSnapshot: true },
    });
    // owner 過濾唯一單點（AC-27.3/27.4）：未知 id 與越權同回 404、不洩漏存在性；通過後 row 收斂為非 null。
    assertOwnedRow(row, actor, `Analysis ${analysisId} not found`);

    const progress = isProgress(row.progress) ? row.progress : DEFAULT_PROGRESS;
    const result = row.resultSnapshot
      ? { resultSnapshotId: row.resultSnapshot.id, count: row.resultSnapshot.keywordCount }
      : { resultSnapshotId: null, count: null };
    // journey feature 由最新 JourneyRun 推導（AC-33.6，驅動前端 gate）；無 run → not_generated。
    const journeyRun = await this.prisma.journeyRun.findFirst({
      where: { keywordAnalysisId: analysisId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    const features = computeFeatures(
      { status: row.status, resultSnapshotId: row.resultSnapshotId },
      { journeyStatus: journeyRun?.status },
    );

    return { status: row.status, progress, result, features };
  }

  /**
   * 取消分析（T3.12，FR-8、§6.8 狀態機）：不存在 → 404；已終態（completed/failed/canceled）→ 回現狀
   * 不覆寫；否則標 `status='canceled'` 並釋放佇列任務（best-effort：active job 鎖住無法 remove，DB
   * status 為權威信號）。
   */
  async cancel(analysisId: string, actor: AuthenticatedUser): Promise<{ status: AnalysisStatus }> {
    const row = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { status: true, ownerId: true },
    });
    // owner 過濾唯一單點（AC-27.3/27.4）：未知 id / 越權同回 404，先於狀態機/更新——不對他人資源做任何寫入。
    assertOwnedRow(row, actor, `Analysis ${analysisId} not found`);
    if (TERMINAL_STATUSES.has(row.status)) {
      return { status: row.status };
    }

    // 條件更新（M3-R3）：只在仍非終態時轉 canceled——與 saveResult 的條件 updateMany 互斥，
    // 先 commit 者勝、不互相覆寫（防 cancel-vs-processor race 雙向）。命中 0 列 → 已被轉終態 → 回讀現狀。
    const { count } = await this.prisma.keywordAnalysis.updateMany({
      where: { id: analysisId, status: { notIn: [...TERMINAL_STATUSES] } },
      data: { status: 'canceled', finishedAt: new Date() },
    });
    if (count === 0) {
      const current = await this.prisma.keywordAnalysis.findUnique({
        where: { id: analysisId },
        select: { status: true },
      });
      return { status: current?.status ?? 'canceled' };
    }
    // jobId === analysisId。best-effort：active job 鎖住無法 remove（預期）→ 記 warn
    // （DB status='canceled' 為權威信號；saveResult 對終態不固化，防 resurrection）。
    await this.queue.remove(analysisId).catch((error: unknown) => {
      // 祕密不入 log（NFR-5/#9）：ioredis 連線錯誤可夾帶 REDIS_URL（含密碼）。
      this.logger.warn(
        `queue.remove(${analysisId}) failed (job may be active/locked): ${scrubSecrets(String(error))}`,
      );
    });
    return { status: 'canceled' };
  }
}

/**
 * 終態（§6.8）：到此不再推進；取消僅作用於非終態 job。**含 `partial`**（M7-R5）：partial 為終態
 * （T7.1 以部分結果收尾、固化 snapshot + finishedAt、BullMQ 標 completed、不自動 resume），cancel 不得覆寫。
 */
const TERMINAL_STATUSES = new Set<AnalysisStatus>(['completed', 'partial', 'failed', 'canceled']);

/** Prisma 唯一鍵衝突（P2002）判定。 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * 逾 freshness 窗的舊列「讓位」用的存檔 idempotencyKey（#311）。含原 hash（可追溯來源）+ 列 id
 * （保證唯一），且尾綴 `#expired#` 使其**不可能**等於任何真實 sha256 hex hash → 不與新提交相碰。
 */
function expiredIdempotencyKey(hash: string, id: string): string {
  return `${hash}#expired#${id}`;
}

/**
 * 歷史清單列映射（FR-23，AC-23.1）：DB 列 → 對外形狀（params 取 mode/geo/language；count 取 snapshot）。
 * `seeds`/`params` 為 **non-null `Json`**（schema 保證）、由 `create()` 寫入 `string[]` / `AnalysisParams`
 * 物件，故此處直接收斂型別（不加 corrupt-DB 防禦分支）。
 */
function toListRow(
  row: Prisma.KeywordAnalysisGetPayload<{ include: { resultSnapshot: true } }>,
): AnalysisListRow {
  const params = row.params as { mode?: string; geo?: string; language?: string };
  return {
    analysisId: row.id,
    status: row.status,
    seeds: row.seeds as string[],
    params: { mode: params.mode, geo: params.geo, language: params.language },
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    resultSnapshotId: row.resultSnapshotId,
    count: row.resultSnapshot?.keywordCount ?? null,
  };
}

/** DB progress（Json 欄位）是否為我們的進度結構（phase+percent）。 */
function isProgress(value: unknown): value is AnalysisProgress {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnalysisProgress).phase === 'string' &&
    typeof (value as AnalysisProgress).percent === 'number'
  );
}
