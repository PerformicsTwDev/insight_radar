import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import type { KeywordAssignment, TopicClusterRecord } from './assemble-assignments';

/**
 * 主題分群持久層（T8.8，FR-18；Design §16.4）：把每群命名 + 每字群指派寫入 `topic_clusters` /
 * `keyword_cluster_assignments`（標準型別 → typed `prisma.<model>`）。一個 transaction 內先寫 clusters
 * （產 id、建 label→id 映射）再寫 assignments（clusterId 由 label 解析、noise→null）。
 *
 * **絕不觸碰 FR-4 `keyword_intents`**（群層 intent 與每字 multi-label 分表互補、不覆寫；Design §16.1 註）。
 */
@Injectable()
export class TopicRepository {
  constructor(private readonly prisma: PrismaService) {}

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

    await this.prisma.$transaction([
      this.prisma.topicCluster.createMany({ data: clusterRows }),
      this.prisma.keywordClusterAssignment.createMany({ data: assignmentRows }),
    ]);
  }
}
