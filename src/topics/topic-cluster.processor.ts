import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Job, Worker } from 'bullmq';
import {
  CLUSTERING_PROVIDER,
  type ClusteringProvider,
} from '../clustering/clustering-provider.port';
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
import { TopicNamingService } from './topic-naming.service';
import { TopicRepository } from './topic.repository';

/** pipeline 內部關鍵字（snapshot row 子集，滿足 representatives/embed/assemble 輸入）。 */
interface PipelineKeyword {
  normalizedText: string;
  text: string;
  avgMonthlySearches: number | null;
}

/** 基礎設施錯（DB 等）→ 應 rethrow 讓 BullMQ 整 job 重試（非外部階段降級）。 */
function isInfraError(error: unknown): boolean {
  return (
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
 * - embed/cluster 外部失敗（含 {@link ClusteringUnavailableError}）→ 標 `partial`（0 群、保留 run），**不** throw；
 *   但基礎設施錯（Prisma）→ rethrow 讓 BullMQ 整 job 重試（JOB_ATTEMPTS）。
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
    await this.repo.markStatus(runId, 'running');

    // load（DB 讀；失敗 → throw → BullMQ 重試）
    const keywords = await this.loadKeywords(snapshotId);
    await this.repo.updateProgress(runId, { phase: 'load', percent: PHASE_PERCENT.load });

    // serp（可選；失敗 → 降級純文字、續跑）
    let serpDegraded = false;
    let serpByText = new Map<string, SerpContext>();
    if (params.serpEnabled) {
      try {
        serpByText = await this.fetchSerp(keywords, geo, language);
      } catch (error) {
        serpDegraded = true;
        this.logger.warn(`SERP degraded (plain-text fallback): ${scrubSecrets(String(error))}`);
      }
    }
    await this.repo.updateProgress(runId, { phase: 'serp', percent: PHASE_PERCENT.serp });

    // embed + cluster（外部階段；外部失敗 → partial 0 群、infra → rethrow）
    let labels: number[];
    let probabilities: number[];
    let vectors: number[][];
    try {
      vectors = await this.embeddings.embed(
        keywords.map((keyword) => ({
          geo,
          language,
          normalizedText: keyword.normalizedText,
          serp: serpByText.get(keyword.normalizedText),
        })),
      );
      await this.repo.updateProgress(runId, { phase: 'embed', percent: PHASE_PERCENT.embed });
      const result = await this.clustering.cluster(vectors, {
        umap: params.umap,
        hdbscan: params.hdbscan,
        top_k: params.topK,
      });
      labels = result.labels;
      probabilities = result.probabilities;
      await this.repo.updateProgress(runId, { phase: 'cluster', percent: PHASE_PERCENT.cluster });
    } catch (error) {
      if (isInfraError(error)) {
        throw error; // 基礎設施故障 → BullMQ 整 job 重試
      }
      return this.finalizePartial(runId, keywords.length, error); // 外部階段降級 → partial（0 群）
    }

    // represent → name → persist
    const rep = extractRepresentatives({
      labels,
      probabilities,
      keywords,
      vectors,
      topK: params.topK,
    });
    await this.repo.updateProgress(runId, { phase: 'represent', percent: PHASE_PERCENT.represent });

    const namings = await this.naming.nameClusters(toClustersToName(rep.clusters));
    const namingDegraded = namings.some((naming) => naming.degraded);
    await this.repo.updateProgress(runId, { phase: 'name', percent: PHASE_PERCENT.name });

    const clusterRecords = assembleClusterRecords(rep.clusters, namings);
    const assignments = assembleAssignments(labels, probabilities, keywords, namings);
    await this.repo.persist(runId, clusterRecords, assignments);
    await this.repo.updateProgress(runId, { phase: 'persist', percent: PHASE_PERCENT.persist });

    const status = decideRunStatus({ serpDegraded, namingDegraded });
    await this.repo.markStatus(runId, status, {
      clusterCount: rep.clusters.length,
      noiseCount: rep.noiseCount,
    });
    return { status, clusterCount: rep.clusters.length, noiseCount: rep.noiseCount };
  }

  /** 外部階段降級收尾：標 partial（0 群、noise=全部）、保留 run，回可辨識結果（不 throw）。 */
  private async finalizePartial(
    runId: string,
    keywordCount: number,
    error: unknown,
  ): Promise<TopicJobResult> {
    this.logger.warn(`clustering pipeline degraded → partial: ${scrubSecrets(String(error))}`);
    await this.repo.markStatus(runId, 'partial', {
      clusterCount: 0,
      noiseCount: keywordCount,
      error: scrubSecrets(error instanceof Error ? error.message : String(error)),
    });
    return { status: 'partial', clusterCount: 0, noiseCount: keywordCount };
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
