import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Inject,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Job, Worker } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import {
  CLUSTERING_PROVIDER,
  type ClusteringProvider,
} from '../clustering/clustering-provider.port';
import { ClusteringContractError } from '../clustering/clustering.errors';
import { topicsConfig } from '../config/topics.config';
import { EmbeddingService } from '../embeddings/embedding.service';
import type { SerpContext } from '../embeddings/embedding.types';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import { scrubSecrets } from '../logger/redaction';
import { PrismaService } from '../prisma';
import { TOPICS_QUEUE } from '../queue/queue.constants';
import { SERP_PROVIDER, type SerpProvider } from '../serp/serp-provider.port';
import type { SerpQuery } from '../serp/serp.types';
import { assembleAssignments, assembleClusterRecords } from './assemble-assignments';
import { decideRunStatus, PHASE_PERCENT } from './decide-run-status';
import { extractRepresentatives } from './representatives';
import type { TopicJobPayload, TopicJobResult } from './topic-job.types';
import type { ClusterToName } from './topic-naming.prompt';
import { TopicJobMetrics } from './topic-job-metrics';
import { TopicNamingService } from './topic-naming.service';
import type { TopicPhase } from './topic-run.types';
import { TopicRepository } from './topic.repository';

/** pipeline 內部關鍵字（snapshot row 子集，滿足 representatives/embed/assemble 輸入）。 */
interface PipelineKeyword {
  normalizedText: string;
  text: string;
  avgMonthlySearches: number | null;
}

/**
 * embed/cluster 階段的錯誤是否**不得**被吞成 partial、須 rethrow 讓其浮現為 `failed`（M8-R2）：
 * - 基礎設施錯（Prisma DB 等）→ 暫時性、rethrow 讓 BullMQ 整 job 重試。
 * - {@link ClusteringContractError}（cluster-service/client 契約漂移）→ **非降級、是 bug**
 *   （clustering.errors.ts：「重試無益」）。吞成 partial 會讓其分型形同虛設、靜默遮蔽契約不同步；
 *   須 rethrow 浮現為明確 `failed`（distinct non-partial signal），觸發告警/修正而非假裝「0 群成功」。
 *
 * 對比：{@link ClusteringUnavailableError}（timeout/5xx 達重試上限）為外部階段降級 → 續走 partial。
 */
function shouldRethrowNotPartial(error: unknown): boolean {
  return (
    error instanceof ClusteringContractError ||
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  );
}

/**
 * 主題分群 processor（T8.9b，FR-15/18，TC-46/TC-51；Design §16.3）。`@Processor('topics')` + `WorkerHost`：
 * `load→serp→embed→cluster→represent→name→persist`，每階段 `updateProgress`。
 *
 * **partial 降級（NFR-12）**：
 * - SERP 抓取失敗 → 降級純文字 embedding、續跑（serpDegraded）。
 * - embed/cluster 外部降級（{@link ClusteringUnavailableError}：timeout/5xx 達重試上限）→ 標 `partial`
 *   （0 群、保留 run），**不** throw；但基礎設施錯（Prisma）與 **契約漂移**（`ClusteringContractError`，
 *   非降級、是 bug）→ rethrow 讓其浮現為 `failed`（BullMQ 重試 JOB_ATTEMPTS），不得吞成 partial（M8-R2）。
 * - 部分群命名 degraded → 群仍持久化、run 標 `partial`。
 *
 * `autorun:false` + `onApplicationBootstrap` 接上 config 並發（同 keyword-analysis processor，M3-R2）；
 * `onModuleDestroy` 排空 worker（NFR-9，防 Jest hang）。錯誤訊息一律 `scrubSecrets`（NFR-5）。
 */
@Processor(TOPICS_QUEUE, { autorun: false })
export class TopicClusterProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TopicClusterProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SERP_PROVIDER) private readonly serp: SerpProvider,
    private readonly embeddings: EmbeddingService,
    @Inject(CLUSTERING_PROVIDER) private readonly clustering: ClusteringProvider,
    private readonly naming: TopicNamingService,
    private readonly repo: TopicRepository,
    @Inject(topicsConfig.KEY) private readonly config: ConfigType<typeof topicsConfig>,
    // 結構化可觀測 log（T8.12，NFR-11/NFR-6）：pino 承載各階段耗時+計數。@Optional：未提供（多數單元測試以
    // 手動 new 建構）→ emitMetrics no-op（觀測缺席不影響 job 行為）。生產由 LoggerModule（@Global）注入。
    @Optional() private readonly metricsLog?: PinoLogger,
  ) {
    super();
  }

  /** 接上 TOPICS_QUEUE_CONCURRENCY 後才啟動 worker（`@Processor` WorkerOptions 為靜態、讀不到 config）。 */
  onApplicationBootstrap(): Promise<void> {
    const worker = this.worker;
    worker.concurrency = this.config.queueConcurrency;
    void worker.run().catch((error: unknown) => {
      this.logger.error(`worker run() failed: ${scrubSecrets(String(error))}`);
    });
    return Promise.resolve();
  }

  /** Graceful shutdown：排空 in-flight job（讀 backing `_worker`，未初始化時安全 no-op）。 */
  async onModuleDestroy(): Promise<void> {
    const worker = (this as unknown as { _worker?: Worker })._worker;
    if (worker) {
      await worker.close();
    }
  }

  async process(job: Job<TopicJobPayload>): Promise<TopicJobResult> {
    const { runId, snapshotId, geo, language, params } = job.data;
    const metrics = new TopicJobMetrics(runId); // 各階段耗時 + 計數（NFR-11/NFR-6，T8.12）
    try {
      await this.repo.markStatus(runId, 'running');

      // load（DB 讀；失敗 → throw → BullMQ 重試）
      const endLoad = metrics.startPhase('load');
      const keywords = await this.loadKeywords(snapshotId);
      endLoad();
      await this.reportProgress(job, runId, 'load', PHASE_PERCENT.load);

      // serp（可選；失敗 → 降級純文字、續跑）
      let serpDegraded = false;
      let serpByText = new Map<string, SerpContext>();
      const endSerp = metrics.startPhase('serp');
      if (params.serpEnabled) {
        try {
          serpByText = await this.fetchSerp(keywords, geo, language);
        } catch (error) {
          serpDegraded = true;
          this.logger.warn(`SERP degraded (plain-text fallback): ${scrubSecrets(String(error))}`);
        }
      }
      endSerp();
      await this.reportProgress(job, runId, 'serp', PHASE_PERCENT.serp);

      // embed + cluster（外部階段；外部失敗 → partial 0 群、infra → rethrow）
      let labels: number[];
      let probabilities: number[];
      let vectors: number[][];
      try {
        const endEmbed = metrics.startPhase('embed');
        vectors = await this.embeddings.embed(
          keywords.map((keyword) => ({
            geo,
            language,
            normalizedText: keyword.normalizedText,
            serp: serpByText.get(keyword.normalizedText),
          })),
        );
        endEmbed();
        await this.reportProgress(job, runId, 'embed', PHASE_PERCENT.embed);
        const endCluster = metrics.startPhase('cluster');
        const result = await this.clustering.cluster(vectors, {
          umap: params.umap,
          hdbscan: params.hdbscan,
          top_k: params.topK,
        });
        labels = result.labels;
        probabilities = result.probabilities;
        endCluster();
        await this.reportProgress(job, runId, 'cluster', PHASE_PERCENT.cluster);
      } catch (error) {
        if (shouldRethrowNotPartial(error)) {
          // infra 故障 → BullMQ 整 job 重試；契約漂移（ClusteringContractError）→ 浮現為 failed（非 partial）。
          throw error;
        }
        return this.finalizePartial(runId, keywords.length, error, metrics); // 外部降級 → partial（0 群）
      }

      // represent → name → persist
      const endRep = metrics.startPhase('represent');
      const rep = extractRepresentatives({
        labels,
        probabilities,
        keywords,
        vectors,
        topK: params.topK,
      });
      endRep();
      await this.reportProgress(job, runId, 'represent', PHASE_PERCENT.represent);

      const endName = metrics.startPhase('name');
      const namings = await this.naming.nameClusters(toClustersToName(rep.clusters));
      endName();
      const namingDegraded = namings.some((naming) => naming.degraded);
      await this.reportProgress(job, runId, 'name', PHASE_PERCENT.name);

      const endPersist = metrics.startPhase('persist');
      const clusterRecords = assembleClusterRecords(rep.clusters, namings);
      const assignments = assembleAssignments(labels, probabilities, keywords, namings);
      await this.repo.persist(runId, clusterRecords, assignments);
      endPersist();
      await this.reportProgress(job, runId, 'persist', PHASE_PERCENT.persist);

      const status = decideRunStatus({ serpDegraded, namingDegraded });
      await this.repo.markStatus(runId, status, {
        clusterCount: rep.clusters.length,
        noiseCount: rep.noiseCount,
      });
      metrics.setCounts({
        keywordCount: keywords.length,
        clusterCount: rep.clusters.length,
        noiseCount: rep.noiseCount,
      });
      metrics.setDegraded(serpDegraded || namingDegraded);
      this.emitMetrics(metrics, status);
      return { status, clusterCount: rep.clusters.length, noiseCount: rep.noiseCount };
    } catch (error) {
      // infra rethrow / 非預期錯：發 failed 觀測 log（best-effort）後上拋（BullMQ 重試）。
      this.emitMetrics(metrics, 'failed');
      throw error;
    }
  }

  /** 外部階段降級收尾：標 partial（0 群、noise=全部）、保留 run + 發 partial 觀測 log，回可辨識結果（不 throw）。 */
  private async finalizePartial(
    runId: string,
    keywordCount: number,
    error: unknown,
    metrics: TopicJobMetrics,
  ): Promise<TopicJobResult> {
    this.logger.warn(`clustering pipeline degraded → partial: ${scrubSecrets(String(error))}`);
    await this.repo.markStatus(runId, 'partial', {
      clusterCount: 0,
      noiseCount: keywordCount,
      error: scrubSecrets(error instanceof Error ? error.message : String(error)),
    });
    metrics.setCounts({ keywordCount, clusterCount: 0, noiseCount: keywordCount });
    metrics.setDegraded(true);
    this.emitMetrics(metrics, 'partial');
    return { status: 'partial', clusterCount: 0, noiseCount: keywordCount };
  }

  /**
   * 發射每 job 結構化可觀測 log（NFR-6/NFR-11）。**best-effort**：觀測副作用絕不可讓已持久化的 job 失敗
   * （否則 catch 誤判 → BullMQ 重跑已完成 job、重打外部）。無 logger（單元測試手動建構）→ no-op。
   */
  private emitMetrics(metrics: TopicJobMetrics, status: string): void {
    if (!this.metricsLog) {
      return;
    }
    try {
      this.metricsLog.info(metrics.toLogFields(status), 'topic job metrics');
    } catch (error) {
      this.logger.warn(`metrics emit failed (best-effort): ${scrubSecrets(String(error))}`);
    }
  }

  /**
   * 回報階段進度：**同時**寫 DB（GET 輪詢真實來源）與 `job.updateProgress`（BullMQ QueueEvents → topics @Sse
   * 即時串流，M8-R8）。少了後者，SSE 只會收到終態事件、進度條永不前進（xhigh confirmed）。
   *
   * `repo.updateProgress`（Prisma，durable）失敗 → 上拋，讓呼叫端 {@link shouldRethrowNotPartial} 判為 infra → BullMQ 重試。
   * `job.updateProgress`（Redis/BullMQ 進度發布）為**純觀測副作用**，**best-effort**：吞錯記 warn（同
   * {@link emitMetrics}）。否則 embed/cluster try/catch 會把 Redis 短暫失敗誤判為外部降級、把已成功的昂貴管線
   * 標成 `partial`（0 群、丟棄結果、且不重試）——違 NFR-12（partial 僅限外部階段失敗）。（M8-R12）
   */
  private async reportProgress(
    job: Job<TopicJobPayload>,
    runId: string,
    phase: TopicPhase,
    percent: number,
  ): Promise<void> {
    const progress = { phase, percent };
    await this.repo.updateProgress(runId, progress);
    try {
      await job.updateProgress(progress);
    } catch (error) {
      this.logger.warn(`job progress publish failed (best-effort): ${scrubSecrets(String(error))}`);
    }
  }

  /** 讀不可變 snapshot 的關鍵字列（依 rowIndex 序）。 */
  private async loadKeywords(snapshotId: string): Promise<PipelineKeyword[]> {
    const rows = await this.prisma.snapshotRow.findMany({
      where: { snapshotId },
      orderBy: { rowIndex: 'asc' },
    });
    return rows.map((row) => {
      const data = row.data as unknown as SnapshotRowData;
      return {
        normalizedText: data.normalizedText,
        text: data.text,
        avgMonthlySearches: data.avgMonthlySearches,
      };
    });
  }

  /** 抓 SERP → 轉中立 SerpContext（by normalizedText）。 */
  private async fetchSerp(
    keywords: PipelineKeyword[],
    geo: string,
    language: string,
  ): Promise<Map<string, SerpContext>> {
    const queries: SerpQuery[] = keywords.map((keyword) => ({
      normalizedText: keyword.normalizedText,
      keyword: keyword.text,
      geo,
      language,
    }));
    const results = await this.serp.fetch(queries);
    const byText = new Map<string, SerpContext>();
    for (const result of results) {
      byText.set(result.normalizedText, {
        organic: result.results.organic.map((organic) => ({
          title: organic.title,
          snippet: organic.snippet,
        })),
        peopleAlsoAsk: result.results.paa,
        relatedSearches: result.results.related,
      });
    }
    return byText;
  }
}

/** rep clusters → 命名輸入（代表字取 text；clusterVolume/keywordCount 帶入量體訊號）。 */
function toClustersToName(
  clusters: ReturnType<typeof extractRepresentatives>['clusters'],
): ClusterToName[] {
  return clusters.map((cluster) => ({
    clusterLabel: cluster.clusterLabel,
    representativeKeywords: cluster.representativeKeywords.map((rep) => rep.text),
    clusterVolume: cluster.clusterVolume,
    keywordCount: cluster.keywordCount,
  }));
}
