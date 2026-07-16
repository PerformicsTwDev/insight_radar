import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, type INestApplication } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import type { PrismaService } from 'src/prisma';
import type { KeywordAssignment, TopicClusterRecord } from 'src/topics/assemble-assignments';
import { TopicRepository } from 'src/topics/topic.repository';
import { TrackingListService } from 'src/tracking/tracking-list.service';
import { createPrismaTestApp } from '../utils';

/**
 * TC-64（FR-28，AC-28.4/28.5/28.7 · Testcontainers 真 Postgres）：加成員的 **DB 層強制** + **主題展開攤平**。
 * 直接構造 `TrackingListService`（真 prisma + 真 `TopicRepository`），驗真實語意：
 * - `TopicRepository.expandTopicToMembers`：讀 TopicRun × TopicCluster.topicName × KeywordClusterAssignment
 *   （已指派非-noise），原字取自 snapshot（缺 → fallback normalizedText），geo/language 取分析 params。
 * - 加成員：`normalizedText` 聯集去重（批內 + 對現有）、語境守門（geo/language 不符 → 400）、成員上限 → 409、
 *   owner scope（越權/不存在 → 404）。HTTP 層由 e2e 覆蓋，兩者互補。
 */

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const SESSION_A: AuthenticatedUser = { kind: 'session', id: OWNER_A, email: 'a@example.com' };
const SESSION_B: AuthenticatedUser = { kind: 'session', id: OWNER_B, email: 'b@example.com' };

const TW_LIST = { name: 'TW list', geo: 'TW', language: 'zh-TW' };

function clusterRecord(clusterLabel: number, topicName: string): TopicClusterRecord {
  return {
    clusterLabel,
    topicName,
    parentTopic: 'Root',
    intentLabel: 'commercial',
    topicType: 'head',
    reason: '',
    clusterVolume: 100,
    keywordCount: 1,
    confidence: 0.9,
    representativeKeywords: [],
  };
}

function assignment(normalizedText: string, clusterLabel: number | null): KeywordAssignment {
  const isNoise = clusterLabel === null;
  return {
    normalizedText,
    clusterLabel,
    topicName: null,
    parentTopic: null,
    intentLabel: null,
    confidence: isNoise ? 0 : 0.9,
    isNoise,
  };
}

describe('TrackingList add members (integration · Testcontainers · TC-64 · FR-28 · AC-28.4/28.5/28.7)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: TopicRepository;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    repo = new TopicRepository(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM keyword_cluster_assignments');
    await prisma.$executeRawUnsafe('DELETE FROM topic_clusters');
    await prisma.$executeRawUnsafe('DELETE FROM topic_cluster_runs');
    await prisma.$executeRawUnsafe('DELETE FROM snapshot_rows');
    await prisma.$executeRawUnsafe('DELETE FROM result_snapshots');
    await prisma.$executeRawUnsafe('DELETE FROM keyword_analyses');
    await prisma.trackingList.deleteMany(); // cascade removes members
  });

  const makeService = (
    maxMembersPerList = 500,
    maxItemsPerRequest = 500,
    maxLists = 50,
  ): TrackingListService =>
    new TrackingListService(prisma, repo, {
      maxLists,
      maxMembersPerList,
      maxItemsPerRequest,
      backfillMonths: 12,
      refreshCron: '0 3 * * *',
    });

  /** 建父分析（params 帶 geo/language 語境），回 analysisId。 */
  async function seedAnalysis(
    params: Prisma.InputJsonObject = { geo: 'TW', language: 'zh-TW', mode: 'expand' },
    ownerId: string | null = null,
  ): Promise<string> {
    const analysisId = randomUUID();
    await prisma.keywordAnalysis.create({
      data: {
        id: analysisId,
        status: 'completed',
        seeds: [],
        params,
        progress: {},
        idempotencyKey: `idem-${analysisId}`,
        ownerId,
      },
    });
    return analysisId;
  }

  /**
   * 建完整 topic run：clusters 'Coffee'(0)/'Tea'(1)/'Empty'(2)；assignments coffee maker/espresso machine/
   * ghost kw → Coffee(0)、green tea → Tea(1)、noise kw → noise。snapshot 含前述原字但**故意不含** 'ghost kw'
   * （驗 fallback：無 snapshot 原字 → 用 normalizedText）。回 analysisId。
   */
  async function seedRun(
    params: Prisma.InputJsonObject = { geo: 'TW', language: 'zh-TW', mode: 'expand' },
    ownerId: string | null = null,
  ): Promise<string> {
    const analysisId = await seedAnalysis(params, ownerId);
    const snapshotId = randomUUID();
    await prisma.resultSnapshot.create({
      data: { id: snapshotId, analysisId, keywordCount: 4, checksum: 'chk' },
    });
    await prisma.snapshotRow.createMany({
      data: [
        {
          snapshotId,
          analysisId,
          rowIndex: 0,
          data: { text: 'Coffee Maker', normalizedText: 'coffee maker' },
        },
        {
          snapshotId,
          analysisId,
          rowIndex: 1,
          data: { text: 'Espresso Machine', normalizedText: 'espresso machine' },
        },
        {
          snapshotId,
          analysisId,
          rowIndex: 2,
          data: { text: 'Green Tea', normalizedText: 'green tea' },
        },
        {
          snapshotId,
          analysisId,
          rowIndex: 3,
          data: { text: 'Noise Kw', normalizedText: 'noise kw' },
        },
      ],
    });
    const { runId } = await repo.createRun({
      keywordAnalysisId: analysisId,
      snapshotId,
      idempotencyKey: randomUUID(),
      params: {},
    });
    await repo.markStatus(runId, 'completed', { clusterCount: 3, noiseCount: 1 });
    await repo.persist(
      runId,
      [clusterRecord(0, 'Coffee'), clusterRecord(1, 'Tea'), clusterRecord(2, 'Empty')],
      [
        assignment('coffee maker', 0),
        assignment('espresso machine', 0),
        assignment('ghost kw', 0), // 不在 snapshot → fallback text
        assignment('green tea', 1), // 非目標群（驗 targetClusterIds.has=false 分支）
        assignment('noise kw', null), // noise（驗 clusterId!==null=false 分支）
      ],
    );
    return analysisId;
  }

  const memberNorms = async (listId: string): Promise<string[]> => {
    const rows = await prisma.trackingListMember.findMany({
      where: { listId },
      orderBy: { normalizedText: 'asc' },
    });
    return rows.map((r) => r.normalizedText);
  };

  describe('TopicRepository.expandTopicToMembers (AC-28.4 展開語意)', () => {
    it('展開最新 run 該群非-noise 關鍵字：原字取 snapshot、缺則 fallback、geo/language 取分析', async () => {
      const analysisId = await seedRun();
      const members = await repo.expandTopicToMembers(analysisId, 'Coffee');
      const byNorm = new Map(members.map((m) => [m.normalizedText, m]));
      expect([...byNorm.keys()].sort()).toEqual(['coffee maker', 'espresso machine', 'ghost kw']);
      expect(byNorm.get('coffee maker')).toMatchObject({
        text: 'Coffee Maker',
        geo: 'TW',
        language: 'zh-TW',
      });
      expect(byNorm.get('ghost kw')?.text).toBe('ghost kw'); // fallback（snapshot 無此原字）
      // 'green tea'（他群）與 'noise kw'（noise）不得混入。
      expect(byNorm.has('green tea')).toBe(false);
      expect(byNorm.has('noise kw')).toBe(false);
    });

    it('無此主題群 → 空集合（不 throw）', async () => {
      const analysisId = await seedRun();
      await expect(repo.expandTopicToMembers(analysisId, 'Nonexistent')).resolves.toEqual([]);
    });

    it('群存在但無指派 → 空集合', async () => {
      const analysisId = await seedRun();
      await expect(repo.expandTopicToMembers(analysisId, 'Empty')).resolves.toEqual([]);
    });

    it('分析無 topic run → 空集合', async () => {
      const analysisId = await seedAnalysis();
      await expect(repo.expandTopicToMembers(analysisId, 'Coffee')).resolves.toEqual([]);
    });

    it('未知分析 → 空集合', async () => {
      await expect(repo.expandTopicToMembers(randomUUID(), 'Coffee')).resolves.toEqual([]);
    });
  });

  describe('addMembers — keyword items (AC-28.4)', () => {
    it('新增關鍵字列 → normalizedText 落 DB、聯集去重', async () => {
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      const res = await svc.addMembers(
        list.listId,
        {
          items: [
            { kind: 'keyword', text: 'Coffee Maker', geo: 'TW', language: 'zh-TW' },
            { kind: 'keyword', text: 'coffee maker', geo: 'TW', language: 'zh-TW' }, // 批內重複
          ],
        },
        SESSION_A,
      );
      expect(res).toEqual({ memberCount: 1, added: 1 });
      expect(await memberNorms(list.listId)).toEqual(['coffee maker']);
    });

    it('對現有成員去重 → added=0、memberCount 不變', async () => {
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      await svc.addMembers(
        list.listId,
        { items: [{ kind: 'keyword', text: 'Coffee Maker', geo: 'TW', language: 'zh-TW' }] },
        SESSION_A,
      );
      const res = await svc.addMembers(
        list.listId,
        { items: [{ kind: 'keyword', text: 'coffee maker', geo: 'TW', language: 'zh-TW' }] },
        SESSION_A,
      );
      expect(res).toEqual({ memberCount: 1, added: 0 });
    });
  });

  describe('addMembers — topic flatten (AC-28.4)', () => {
    it('主題列展開攤平為該群非-noise 關鍵字並落 DB', async () => {
      const analysisId = await seedRun();
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      const res = await svc.addMembers(
        list.listId,
        { items: [{ kind: 'topic', analysisId, topicName: 'Coffee' }] },
        SESSION_A,
      );
      expect(res).toEqual({ memberCount: 3, added: 3 });
      expect(await memberNorms(list.listId)).toEqual([
        'coffee maker',
        'espresso machine',
        'ghost kw',
      ]);
    });

    it('空展開（無此群）→ added=0（不 400）', async () => {
      const analysisId = await seedRun();
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      const res = await svc.addMembers(
        list.listId,
        { items: [{ kind: 'topic', analysisId, topicName: 'Nonexistent' }] },
        SESSION_A,
      );
      expect(res).toEqual({ memberCount: 0, added: 0 });
    });

    it('topic analysisId 屬他人 owner → 不展開（空集合，不跨 owner 讀，FR-27）', async () => {
      // B 擁有的分析（非 null 共享）；A 不可存取 → 主題展開為空、無 B 的關鍵字外洩。
      const analysisId = await seedRun({ geo: 'TW', language: 'zh-TW', mode: 'expand' }, OWNER_B);
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      const res = await svc.addMembers(
        list.listId,
        { items: [{ kind: 'topic', analysisId, topicName: 'Coffee' }] },
        SESSION_A,
      );
      expect(res).toEqual({ memberCount: 0, added: 0 });
      expect(await memberNorms(list.listId)).toEqual([]);
    });

    it('topic analysisId 不存在 → 不展開（空集合，與越權不可區分）', async () => {
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      const res = await svc.addMembers(
        list.listId,
        { items: [{ kind: 'topic', analysisId: randomUUID(), topicName: 'Coffee' }] },
        SESSION_A,
      );
      expect(res).toEqual({ memberCount: 0, added: 0 });
    });
  });

  describe('context guard (AC-28.5)', () => {
    it('主題展開後語境（geo）與清單不符 → 400', async () => {
      const analysisId = await seedRun(); // 分析 geo=TW
      const svc = makeService();
      const usList = await svc.create({ name: 'US list', geo: 'US', language: 'en-US' }, SESSION_A);
      await expect(
        svc.addMembers(
          usList.listId,
          { items: [{ kind: 'topic', analysisId, topicName: 'Coffee' }] },
          SESSION_A,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await memberNorms(usList.listId)).toEqual([]); // 不默默改寫、不落列
    });

    it('關鍵字列 language 與清單不符 → 400', async () => {
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      await expect(
        svc.addMembers(
          list.listId,
          { items: [{ kind: 'keyword', text: 'x', geo: 'TW', language: 'en-US' }] },
          SESSION_A,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('limit (AC-28.7)', () => {
    it('加入後成員數超過上限 → 409（ConflictException）', async () => {
      const svc = makeService(3);
      const list = await svc.create(TW_LIST, SESSION_A);
      await expect(
        svc.addMembers(
          list.listId,
          {
            items: [
              { kind: 'keyword', text: 'a', geo: 'TW', language: 'zh-TW' },
              { kind: 'keyword', text: 'b', geo: 'TW', language: 'zh-TW' },
              { kind: 'keyword', text: 'c', geo: 'TW', language: 'zh-TW' },
              { kind: 'keyword', text: 'd', geo: 'TW', language: 'zh-TW' },
            ],
          },
          SESSION_A,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await memberNorms(list.listId)).toEqual([]); // 超限 → 整批不落
    });

    it('剛好達上限（不超過）→ 成功', async () => {
      const svc = makeService(3);
      const list = await svc.create(TW_LIST, SESSION_A);
      const res = await svc.addMembers(
        list.listId,
        {
          items: [
            { kind: 'keyword', text: 'a', geo: 'TW', language: 'zh-TW' },
            { kind: 'keyword', text: 'b', geo: 'TW', language: 'zh-TW' },
            { kind: 'keyword', text: 'c', geo: 'TW', language: 'zh-TW' },
          ],
        },
        SESSION_A,
      );
      expect(res).toEqual({ memberCount: 3, added: 3 });
    });
  });

  describe('request-size guard (NFR-16 · items 上限 · DoS 前置守門)', () => {
    const bulk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        kind: 'keyword' as const,
        text: `bulk-${i}`,
        geo: 'TW',
        language: 'zh-TW',
      }));

    it('items 數 > maxItemsPerRequest → 400（BadRequestException）', async () => {
      const svc = makeService(500, 2); // 成員上限寬鬆、請求上限=2 → 隔離請求形狀守門
      const list = await svc.create(TW_LIST, SESSION_A);
      await expect(
        svc.addMembers(list.listId, { items: bulk(3) }, SESSION_A),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await memberNorms(list.listId)).toEqual([]); // 觸 DB 前即拒 → 不落任何成員
    });

    it('超量 items + 不存在 listId → 400（守門先於 DB 清單解析，非 404）', async () => {
      const svc = makeService(500, 2);
      // 若守門在 findUnique 之後，不存在清單會先拋 NotFoundException(404)；此處證明守門在其之前。
      await expect(
        svc.addMembers(randomUUID(), { items: bulk(3) }, SESSION_A),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('removeMember (AC-28.6)', () => {
    const seedKw = (listId: string, normalizedText: string, text: string) =>
      prisma.trackingListMember.create({ data: { listId, normalizedText, text } });

    it('移除存在成員 → 回 { listId, normalizedText } 且該成員消失', async () => {
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      await seedKw(list.listId, 'running shoes', 'Running Shoes');
      await seedKw(list.listId, 'trail shoes', 'Trail Shoes');
      const res = await svc.removeMember(list.listId, 'running shoes', SESSION_A);
      expect(res).toEqual({ listId: list.listId, normalizedText: 'running shoes' });
      expect(await memberNorms(list.listId)).toEqual(['trail shoes']);
    });

    it('normalizedText 參數伺服器端再 normalize（大小寫/空白）→ 命中同一成員', async () => {
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      await seedKw(list.listId, 'running shoes', 'Running Shoes');
      const res = await svc.removeMember(list.listId, '  Running   SHOES ', SESSION_A);
      expect(res.normalizedText).toBe('running shoes');
      expect(await memberNorms(list.listId)).toEqual([]);
    });

    it('不存在成員 → 404（NotFoundException）', async () => {
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      await expect(svc.removeMember(list.listId, 'ghost', SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('非 owner 移除 → 404（owner 守門先於成員查找，不洩漏存在性、不誤刪）', async () => {
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      await seedKw(list.listId, 'running shoes', 'Running Shoes');
      await expect(
        svc.removeMember(list.listId, 'running shoes', SESSION_B),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await memberNorms(list.listId)).toEqual(['running shoes']); // 未被刪
    });

    it('清單不存在 → 404', async () => {
      const svc = makeService();
      await expect(svc.removeMember(randomUUID(), 'x', SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('owner scope (AC-28.4 · FR-27)', () => {
    it('非 owner 加成員 → 404（不落列）', async () => {
      const svc = makeService();
      const list = await svc.create(TW_LIST, SESSION_A);
      await expect(
        svc.addMembers(
          list.listId,
          { items: [{ kind: 'keyword', text: 'x', geo: 'TW', language: 'zh-TW' }] },
          SESSION_B,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await memberNorms(list.listId)).toEqual([]);
    });

    it('不存在的 listId → 404', async () => {
      const svc = makeService();
      await expect(
        svc.addMembers(
          randomUUID(),
          { items: [{ kind: 'keyword', text: 'x', geo: 'TW', language: 'zh-TW' }] },
          SESSION_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
