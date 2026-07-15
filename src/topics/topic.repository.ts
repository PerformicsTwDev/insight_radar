import { randomUUID } from 'node:crypto';
import { Injectable, NotImplementedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import type { KeywordAssignment, TopicClusterRecord } from './assemble-assignments';
import type { AssignmentRow, TopicClusterRow, TopicRunView } from './build-topics-response';
import type { TopicRunStatus } from './topic-run.types';

/**
 * 主題列展開後的成員（T11.3，AC-28.4）：每字取 `normalizedText`/原字 `text`，並帶來源分析的 `geo`/`language`
 * 語境（供追蹤清單語境守門 AC-28.5）。`geo`/`language` 取自 `KeywordAnalysis.params`，缺值時為 `undefined`
 * （不猜、由呼叫端守門判定不符 → 400）。
 */
export interface ExpandedTopicMember {
  normalizedText: string;
  text: string;
  geo: string | undefined;
  language: string | undefined;
}

/** 建立 TopicRun 的輸入（params/progress 為已序列化 Json）。 */
export interface CreateTopicRunInput {
  keywordAnalysisId: string;
  snapshotId: string;
  idempotencyKey: string;
  params: Prisma.InputJsonValue;
  progress?: Prisma.InputJsonValue;
}

/** createRun 結果：`created=false` 代表 idempotency 命中既有 run（不重跑）。 */
export interface CreateTopicRunResult {
  runId: string;
  created: boolean;
}

/** markStatus 的可選終態欄位（僅提供者更新；undefined 由 Prisma 略過、不覆寫）。 */
export interface TopicRunOutcome {
  clusterCount?: number;
  noiseCount?: number;
  error?: string | null;
}

/**
 * 主題分群持久層（T8.8/T8.9，FR-15/18；Design §16.4）：TopicRun 生命週期（create/idempotency/status/progress）
 * + 把每群命名 + 每字群指派寫入 `topic_clusters` / `keyword_cluster_assignments`（標準型別 → typed
 * `prisma.<model>`）。persist 於一個 transaction 內先寫 clusters（產 id、建 label→id 映射）再寫 assignments。
 *
 * **絕不觸碰 FR-4 `keyword_intents`**（群層 intent 與每字 multi-label 分表互補、不覆寫；Design §16.1 註）。
 */
@Injectable()
export class TopicRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 建立分群 run（狀態 queued）。idempotency：`idempotencyKey` 命中既有 → 回既有 runId（`created=false`），
   * 不重複建立。並發同 key（都未先查到）以 DB `@unique` 為最終仲裁（P2002 → 回既有）。
   */
  async createRun(input: CreateTopicRunInput): Promise<CreateTopicRunResult> {
    const existing = await this.prisma.topicRun.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return { runId: existing.id, created: false };
    }
    try {
      const run = await this.prisma.topicRun.create({
        data: {
          keywordAnalysisId: input.keywordAnalysisId,
          snapshotId: input.snapshotId,
          status: 'queued',
          params: input.params,
          progress: input.progress ?? {},
          idempotencyKey: input.idempotencyKey,
        },
      });
      return { runId: run.id, created: true };
    } catch (error) {
      // 並發相同 key → unique violation（P2002）→ 回既有（NFR-8 並發下仍 idempotent）。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const row = await this.prisma.topicRun.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
        return { runId: row.id, created: false };
      }
      throw error;
    }
  }

  /** 取某 idempotencyKey 的 run（無則 null）。 */
  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<{ id: string; status: string } | null> {
    const row = await this.prisma.topicRun.findUnique({
      where: { idempotencyKey },
      select: { id: true, status: true },
    });
    return row;
  }

  /** 更新狀態（+ 選配 clusterCount/noiseCount/error）。undefined 欄位 Prisma 略過、不覆寫既有值。 */
  async markStatus(
    runId: string,
    status: TopicRunStatus,
    outcome: TopicRunOutcome = {},
  ): Promise<void> {
    await this.prisma.topicRun.update({
      where: { id: runId },
      data: {
        status,
        clusterCount: outcome.clusterCount,
        noiseCount: outcome.noiseCount,
        error: outcome.error,
      },
    });
  }

  /** 更新進度（SSE / GET 回報）。 */
  async updateProgress(runId: string, progress: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.topicRun.update({ where: { id: runId }, data: { progress } });
  }

  /** 取某分析的最新 run（GET 回應；無→null）。 */
  async findLatestRunByAnalysis(analysisId: string): Promise<TopicRunView | null> {
    const run = await this.prisma.topicRun.findFirst({
      where: { keywordAnalysisId: analysisId },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) {
      return null;
    }
    return {
      id: run.id,
      snapshotId: run.snapshotId,
      status: run.status,
      progress: run.progress,
      clusterCount: run.clusterCount,
      noiseCount: run.noiseCount,
    };
  }

  /** 讀某 run 的群（依 clusterLabel 升冪）。 */
  async loadClusters(runId: string): Promise<TopicClusterRow[]> {
    const rows = await this.prisma.topicCluster.findMany({
      where: { runId },
      orderBy: { clusterLabel: 'asc' },
    });
    return rows.map((row) => ({
      clusterId: row.id,
      clusterLabel: row.clusterLabel,
      topicName: row.topicName,
      parentTopic: row.parentTopic,
      intentLabel: row.intentLabel,
      topicType: row.topicType,
      reason: row.reason,
      clusterVolume: row.clusterVolume,
      keywordCount: row.keywordCount,
      confidence: row.confidence,
      representativeKeywords: row.representativeKeywords,
    }));
  }

  /** 讀某 run 的每字指派（依 normalizedText 升冪）。 */
  async loadAssignments(runId: string): Promise<AssignmentRow[]> {
    const rows = await this.prisma.keywordClusterAssignment.findMany({
      where: { runId },
      orderBy: { normalizedText: 'asc' },
    });
    return rows.map((row) => ({
      normalizedText: row.normalizedText,
      clusterId: row.clusterId,
      confidence: row.confidence,
      isNoise: row.isNoise,
    }));
  }

  /** 讀 snapshot 的 normalizedText→原字 text 映射（GET 回應補 keyword 原字）。 */
  async loadKeywordTexts(snapshotId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.snapshotRow.findMany({
      where: { snapshotId },
      select: { data: true },
    });
    const byNorm = new Map<string, string>();
    for (const row of rows) {
      const data = row.data as unknown as { normalizedText: string; text: string };
      byNorm.set(data.normalizedText, data.text);
    }
    return byNorm;
  }

  /**
   * 展開某分析最新 topic run 中 `topicName` 群的**已指派非-noise** 關鍵字（T11.3，AC-28.4）——**RED shell**：
   * typed not-implemented 空殼；GREEN 於下一 commit 實作。
   */
  expandTopicToMembers(_analysisId: string, _topicName: string): Promise<ExpandedTopicMember[]> {
    throw new NotImplementedException('T11.3 expandTopicToMembers not implemented (RED shell)');
  }

  /** 寫入某 run 的所有群 + 每字指派（transaction 原子）。clusters 先寫以供 assignments 解析 clusterId。 */
  async persist(
    runId: string,
    clusters: TopicClusterRecord[],
    assignments: KeywordAssignment[],
  ): Promise<void> {
    const idByLabel = new Map<number, string>();
    const clusterRows: Prisma.TopicClusterCreateManyInput[] = clusters.map((cluster) => {
      const id = randomUUID();
      idByLabel.set(cluster.clusterLabel, id);
      return {
        id,
        runId,
        clusterLabel: cluster.clusterLabel,
        topicName: cluster.topicName,
        parentTopic: cluster.parentTopic,
        intentLabel: cluster.intentLabel,
        topicType: cluster.topicType,
        reason: cluster.reason,
        clusterVolume: cluster.clusterVolume === null ? null : BigInt(cluster.clusterVolume),
        keywordCount: cluster.keywordCount,
        confidence: cluster.confidence,
        representativeKeywords: cluster.representativeKeywords as unknown as Prisma.InputJsonValue,
      };
    });

    const assignmentRows: Prisma.KeywordClusterAssignmentCreateManyInput[] = assignments.map(
      (assignment) => ({
        runId,
        normalizedText: assignment.normalizedText,
        // noise（clusterLabel null）→ null；否則解析為剛寫入的 cluster id（找不到亦 null，防呆）。
        clusterId:
          assignment.clusterLabel === null
            ? null
            : (idByLabel.get(assignment.clusterLabel) ?? null),
        confidence: assignment.confidence,
        isNoise: assignment.isNoise,
      }),
    );

    // 冪等（M8-R1，NFR-12）：先清該 run 既有 clusters/assignments 再寫 → BullMQ 重跑同 job（persist 後
    // markStatus/updateProgress 暫時失敗、或 worker 被殺）重新 persist 時**覆寫**而非撞 PK (run_id,
    // normalized_text) 的 P2002（原會 rollback → job 永久失敗、run 卡 running、重打 Python/Azure）。
    // 全在單一 transaction 內原子：delete（assignments、clusters）→ create（clusters、assignments）。
    await this.prisma.$transaction([
      this.prisma.keywordClusterAssignment.deleteMany({ where: { runId } }),
      this.prisma.topicCluster.deleteMany({ where: { runId } }),
      this.prisma.topicCluster.createMany({ data: clusterRows }),
      this.prisma.keywordClusterAssignment.createMany({ data: assignmentRows }),
    ]);
  }
}
