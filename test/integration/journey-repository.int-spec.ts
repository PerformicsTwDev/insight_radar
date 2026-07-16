import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import { JourneyRepository } from 'src/journey/journey.repository';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-69 部分（T12.5 · FR-33/AC-33.5 · Testcontainers）：購買歷程分類 snapshot-scoped 持久化。
 * 驗 upsert 往返、同 snapshot 覆寫、normalizedText 去重、跨 snapshot 獨立、**不覆寫 keyword_intents**（分表互補 S10）。
 */
const ANALYSIS = '11111111-1111-1111-1111-111111111111';
const SNAP_A = '22222222-2222-2222-2222-2222222222aa';
const SNAP_B = '33333333-3333-3333-3333-3333333333bb';

describe('JourneyRepository (integration · Testcontainers, TC-69 部分)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: JourneyRepository;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    repo = new JourneyRepository(prisma);
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM keyword_journey_assignments');
    await prisma.$executeRawUnsafe('DELETE FROM keyword_intents');
  });

  it('saveAssignments writes snapshot-scoped rows keyed by [snapshotId, normalizedText]', async () => {
    await repo.saveAssignments({
      analysisId: ANALYSIS,
      snapshotId: SNAP_A,
      staged: [
        { keyword: 'espresso machine', stage: 'need_definition' },
        { keyword: 'buy nespresso pods', stage: 'final_decision' },
      ],
    });

    const rows = await prisma.keywordJourneyAssignment.findMany({
      where: { snapshotId: SNAP_A },
      orderBy: { normalizedText: 'asc' },
    });
    expect(rows).toEqual([
      expect.objectContaining({
        analysisId: ANALYSIS,
        snapshotId: SNAP_A,
        normalizedText: 'buy nespresso pods',
        stage: 'final_decision',
      }),
      expect.objectContaining({ normalizedText: 'espresso machine', stage: 'need_definition' }),
    ]);
  });

  it('normalizes the keyword to the dedup key and upserts (re-run overwrites the stage in place)', async () => {
    await repo.saveAssignments({
      analysisId: ANALYSIS,
      snapshotId: SNAP_A,
      staged: [{ keyword: '  Espresso   Machine ', stage: 'pain_awareness' }],
    });
    // 同 snapshot 重跑（大小寫/空白不同但 normalize 同 key）→ 覆寫、不新增列。
    await repo.saveAssignments({
      analysisId: ANALYSIS,
      snapshotId: SNAP_A,
      staged: [{ keyword: 'espresso machine', stage: 'spec_comparison' }],
    });

    const rows = await prisma.keywordJourneyAssignment.findMany({ where: { snapshotId: SNAP_A } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ normalizedText: 'espresso machine', stage: 'spec_comparison' });
  });

  it('dedups duplicate normalizedText within one call (last wins), no PK conflict', async () => {
    await repo.saveAssignments({
      analysisId: ANALYSIS,
      snapshotId: SNAP_A,
      staged: [
        { keyword: 'coffee', stage: 'pain_awareness' },
        { keyword: 'COFFEE', stage: 'final_decision' }, // same normalizedText
      ],
    });
    const rows = await prisma.keywordJourneyAssignment.findMany({ where: { snapshotId: SNAP_A } });
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe('final_decision'); // last wins
  });

  it('keys the same keyword independently across snapshots', async () => {
    await repo.saveAssignments({
      analysisId: ANALYSIS,
      snapshotId: SNAP_A,
      staged: [{ keyword: 'coffee', stage: 'need_definition' }],
    });
    await repo.saveAssignments({
      analysisId: ANALYSIS,
      snapshotId: SNAP_B,
      staged: [{ keyword: 'coffee', stage: 'repurchase_retention' }],
    });

    const a = await prisma.keywordJourneyAssignment.findMany({ where: { snapshotId: SNAP_A } });
    const b = await prisma.keywordJourneyAssignment.findMany({ where: { snapshotId: SNAP_B } });
    expect(a[0].stage).toBe('need_definition');
    expect(b[0].stage).toBe('repurchase_retention');
  });

  it('AC-33.5: does NOT touch keyword_intents (分表互補、不覆寫)', async () => {
    // 先種一筆 FR-4 intent（同 normalizedText）。
    await prisma.keywordIntent.create({
      data: { normalizedText: 'coffee', modelVersion: 'v1:gpt-4o-mini', labels: ['informational'] },
    });

    await repo.saveAssignments({
      analysisId: ANALYSIS,
      snapshotId: SNAP_A,
      staged: [{ keyword: 'coffee', stage: 'final_decision' }],
    });

    // intent 列原封不動（未被 journey 覆寫）。
    const intent = await prisma.keywordIntent.findUnique({
      where: {
        normalizedText_modelVersion: { normalizedText: 'coffee', modelVersion: 'v1:gpt-4o-mini' },
      },
    });
    expect(intent?.labels).toEqual(['informational']);
    // journey 列獨立存在。
    const journey = await prisma.keywordJourneyAssignment.findMany({
      where: { snapshotId: SNAP_A },
    });
    expect(journey).toHaveLength(1);
    expect(journey[0].stage).toBe('final_decision');
  });

  it('is a no-op for empty staged input', async () => {
    await repo.saveAssignments({ analysisId: ANALYSIS, snapshotId: SNAP_A, staged: [] });
    const rows = await prisma.keywordJourneyAssignment.findMany({ where: { snapshotId: SNAP_A } });
    expect(rows).toEqual([]);
  });
});
