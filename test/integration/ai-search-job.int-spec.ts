import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { CaptureChannel } from 'src/captures/dto/capture-ingest.dto';
import type { AiSearchCanonical } from 'src/captures/mapping/canonical.types';
import type { PrismaService } from 'src/prisma';
import { AiSearchCaptureRepository } from 'src/ai-search/ai-search-capture.repository';
import { AiSearchProcessor } from 'src/ai-search/ai-search.processor';
import { AiSearchRunRepository } from 'src/ai-search/ai-search-run.repository';
import type { AiSearchJobPayload } from 'src/queue/ai-search-job.types';
import type { SerpAiProvider } from 'src/serp/serpapi-ai.types';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-77 部分 (T14.6 · FR-41/AC-41.2 · Testcontainers): AI Search job 兩來源合流落 ai_search_captures（以 jobId 關聯）
 * + partial（某渠道缺→partial 非整批失敗，INV-6）。processor 以 real prisma 收 extension raw capture（`captures`）+
 * SerpAPI pull（fake provider）→ mapAiCapture 收斂 → 落 canonical。
 */

/** fake SerpAiProvider：aiOverview 回一筆 canonical、其餘渠道回 null（模擬 reserved/未觸發）。 */
function fakeSerpAi(aioByQuery: Record<string, AiSearchCanonical | null> = {}): SerpAiProvider {
  return {
    fetchAiOverviews: (keywords: string[]) =>
      Promise.resolve(
        keywords.map((query) => ({ query, aiOverview: aioByQuery[query] ?? null, creditsUsed: 1 })),
      ),
    fetchAiModes: (keywords: string[]) =>
      Promise.resolve(keywords.map((query) => ({ query, aiMode: null, creditsUsed: 0 }))),
    fetchBingCopilot: (keywords: string[]) =>
      Promise.resolve(keywords.map((query) => ({ query, copilot: null, creditsUsed: 0 }))),
  };
}

function serpCanonical(query: string): AiSearchCanonical {
  return {
    source: 'serpapi',
    channel: 'aiOverview',
    schemaVersion: 'serpapi-v1',
    query,
    blocks: ['aio block'],
    references: [],
    capturedAt: new Date().toISOString(),
  };
}

function makeJob(over: Partial<AiSearchJobPayload>): Job<AiSearchJobPayload> {
  return {
    data: {
      runId: over.runId ?? randomUUID(),
      ownerId: null,
      keywords: ['asus zenbook'],
      channels: ['chatGpt', 'aiOverview'] as CaptureChannel[],
      brandProfileId: null,
      params: { schemaVersion: 'ai-search-v1' },
      ...over,
    },
    updateProgress: () => Promise.resolve(undefined),
    attemptsMade: 0,
    opts: { attempts: 5 },
  } as unknown as Job<AiSearchJobPayload>;
}

describe('AiSearchProcessor merge (integration · Testcontainers, TC-77 部分)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let runRepo: AiSearchRunRepository;
  let captureRepo: AiSearchCaptureRepository;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    runRepo = new AiSearchRunRepository(prisma);
    captureRepo = new AiSearchCaptureRepository(prisma);
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM ai_search_captures');
    await prisma.$executeRawUnsafe('DELETE FROM captures');
    await prisma.$executeRawUnsafe('DELETE FROM ai_search_runs');
  });

  async function seedExtensionCapture(channel: CaptureChannel, query: string): Promise<void> {
    await prisma.capture.create({
      data: {
        ownerId: null,
        source: 'extension',
        schemaVersion: 'v1',
        channel,
        contentHash: randomUUID(),
        payload: { query, answer: `answer for ${query}`, references: [] },
        capturedAt: new Date(),
      },
    });
  }

  it('merges extension push + SerpAPI pull into ai_search_captures keyed by jobId; run completed', async () => {
    const { runId } = await runRepo.createRun({
      ownerId: null,
      idempotencyKey: 'job-1',
      params: { schemaVersion: 'ai-search-v1' },
    });
    await seedExtensionCapture('chatGpt', 'asus zenbook');
    const processor = new AiSearchProcessor(
      fakeSerpAi({ 'asus zenbook': serpCanonical('asus zenbook') }),
      runRepo,
      captureRepo,
      { queueConcurrency: 3 },
    );

    const result = await processor.process(
      makeJob({ runId, channels: ['chatGpt', 'aiOverview'], keywords: ['asus zenbook'] }),
    );

    expect(result).toEqual({ status: 'completed', captureCount: 2 });
    const rows = await prisma.aiSearchCapture.findMany({ where: { jobId: runId } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => `${r.source}:${r.channel}`).sort()).toEqual([
      'extension:chatGpt',
      'serpapi:aiOverview',
    ]);
    const run = await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('completed');
    expect(run.captureCount).toBe(2);
  });

  it('marks the run partial (not whole-batch failure) when a requested channel has no capture', async () => {
    const { runId } = await runRepo.createRun({
      ownerId: null,
      idempotencyKey: 'job-2',
      params: { schemaVersion: 'ai-search-v1' },
    });
    await seedExtensionCapture('chatGpt', 'asus zenbook'); // googleSearch has none
    const processor = new AiSearchProcessor(fakeSerpAi(), runRepo, captureRepo, {
      queueConcurrency: 3,
    });

    const result = await processor.process(
      makeJob({ runId, channels: ['chatGpt', 'googleSearch'], keywords: ['asus zenbook'] }),
    );

    expect(result.status).toBe('partial');
    const rows = await prisma.aiSearchCapture.findMany({ where: { jobId: runId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe('chatGpt');
    const run = await prisma.aiSearchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('partial');
  });

  it('re-run is idempotent at the canonical layer (deleteByJobId clean slate → no duplicate rows)', async () => {
    const { runId } = await runRepo.createRun({
      ownerId: null,
      idempotencyKey: 'job-3',
      params: { schemaVersion: 'ai-search-v1' },
    });
    await seedExtensionCapture('chatGpt', 'asus zenbook');
    const processor = new AiSearchProcessor(fakeSerpAi(), runRepo, captureRepo, {
      queueConcurrency: 3,
    });
    const job = makeJob({ runId, channels: ['chatGpt'], keywords: ['asus zenbook'] });

    await processor.process(job);
    await processor.process(job); // re-run (reset/retry)

    const rows = await prisma.aiSearchCapture.findMany({ where: { jobId: runId } });
    expect(rows).toHaveLength(1); // clean slate → no duplicate
  });
});
