import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { CaptureChannel } from 'src/captures/dto/capture-ingest.dto';
import type { PrismaService } from 'src/prisma';
import { AiSearchCaptureRepository } from 'src/ai-search/ai-search-capture.repository';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-77 部分 (T14.6 · FR-41/AC-41.2 · Testcontainers): AiSearchCaptureRepository.readRawExtensionCaptures **有界掃描**
 * （M14-R3/#579 [8]）——capturedAt 回溯視窗 + take 上限，杜絕無界掃全 owner+渠道歷史 capture。以真 DB 驗窗外不撈、超量截頂。
 */
const DAY_MS = 24 * 60 * 60 * 1000;

describe('AiSearchCaptureRepository.readRawExtensionCaptures bounds (integration · Testcontainers, TC-77 部分)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: AiSearchCaptureRepository;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    repo = new AiSearchCaptureRepository(prisma);
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM captures');
  });

  async function seed(channel: CaptureChannel, query: string, capturedAt: Date): Promise<void> {
    await prisma.capture.create({
      data: {
        ownerId: null,
        source: 'extension',
        schemaVersion: 'v1',
        channel,
        contentHash: randomUUID(),
        payload: { query, answer: `answer for ${query}`, references: [] },
        capturedAt,
      },
    });
  }

  it('excludes captures older than the capturedAt window (no unbounded historical scan)', async () => {
    const now = Date.now();
    await seed('chatGpt', 'recent', new Date(now - 1 * DAY_MS)); // in-window
    await seed('chatGpt', 'ancient', new Date(now - 60 * DAY_MS)); // outside 30d window

    const rows = await repo.readRawExtensionCaptures({
      ownerId: null,
      channels: ['chatGpt'],
      capturedAfter: new Date(now - 30 * DAY_MS),
      limit: 500,
    });

    expect(rows).toHaveLength(1);
    expect((rows[0].payload as { query: string }).query).toBe('recent');
  });

  it('caps the scan at the take limit, returning the most-recent rows (capturedAt desc)', async () => {
    const now = Date.now();
    // 5 in-window captures; a limit of 2 must return only the 2 most recent.
    for (let i = 0; i < 5; i++) {
      await seed('chatGpt', `q-${i}`, new Date(now - i * 60_000)); // i=0 newest
    }

    const rows = await repo.readRawExtensionCaptures({
      ownerId: null,
      channels: ['chatGpt'],
      capturedAfter: new Date(now - 30 * DAY_MS),
      limit: 2,
    });

    expect(rows).toHaveLength(2);
    const queries = rows.map((r) => (r.payload as { query: string }).query);
    expect(queries).toEqual(['q-0', 'q-1']); // most-recent first, capped at 2
  });
});
