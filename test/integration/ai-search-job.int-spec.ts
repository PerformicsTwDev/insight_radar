import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { CaptureChannel } from 'src/captures/dto/capture-ingest.dto';
import type { AiSearchCanonical } from 'src/captures/mapping/canonical.types';
import type { PrismaService } from 'src/prisma';
import { AiSearchCaptureRepository } from 'src/ai-search/ai-search-capture.repository';
import { AiSearchProcessor } from 'src/ai-search/ai-search.processor';
import { AiSearchRunRepository } from 'src/ai-search/ai-search-run.repository';
import type { AiAnalysisService } from 'src/ai-visibility/ai-analysis.service';
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

/** T15.5 分析 stage stub：本 spec 只驗抓取合流（T14.6）；分析編排由 ai-analysis-job.int-spec 獨立把關。 */
const stubAnalysis = {
  analyzeAndPersist: () =>
    Promise.resolve({ answersCount: 0, citedCount: 0, metricsCount: 0, needsReview: 0 }),
} as unknown as AiAnalysisService;

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

function makeJob(over: Partial<AiSearchJobPayload>, attemptsMade = 0): Job<AiSearchJobPayload> {
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
    attemptsMade,
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
      stubAnalysis,
      { queueConcurrency: 3, captureLookbackDays: 30, captureScanLimit: 500 },
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
    const processor = new AiSearchProcessor(fakeSerpAi(), runRepo, captureRepo, stubAnalysis, {
      queueConcurrency: 3,
      captureLookbackDays: 30,
      captureScanLimit: 500,
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

  it('BullMQ retry after an analysis failure reuses persisted captures — does NOT re-charge the paid SerpAPI pull (#683/M15-R1)', async () => {
    // Root cause (#683): the analysis stage runs AFTER the PAID SerpAPI pull + persist. If analysis throws on a
    // non-final attempt, BullMQ retries the whole process() → re-invokes pullSerpapi with a fresh credit ledger →
    // SerpAPI credits are re-charged on every retry, blowing the per-job budget. A retry must reuse the captures a
    // prior attempt already persisted (durable, keyed by jobId) instead of paying for the same fetch again.
    const { runId } = await runRepo.createRun({
      ownerId: null,
      idempotencyKey: 'job-retry-recharge',
      params: { schemaVersion: 'ai-search-v1' },
    });

    // Counting SerpAPI provider (paid pull): each fetchAiOverviews call = one billable batch.
    let pullCount = 0;
    const countingSerpAi: SerpAiProvider = {
      fetchAiOverviews: (keywords: string[]) => {
        pullCount += 1;
        return Promise.resolve(
          keywords.map((query) => ({ query, aiOverview: serpCanonical(query), creditsUsed: 1 })),
        );
      },
      fetchAiModes: (keywords: string[]) =>
        Promise.resolve(keywords.map((query) => ({ query, aiMode: null, creditsUsed: 0 }))),
      fetchBingCopilot: (keywords: string[]) =>
        Promise.resolve(keywords.map((query) => ({ query, copilot: null, creditsUsed: 0 }))),
    };

    // Analysis throws on the first (non-final) attempt, succeeds on the retry — models a transient LLM/infra error.
    let analyzeCalls = 0;
    const flakyAnalysis = {
      analyzeAndPersist: () => {
        analyzeCalls += 1;
        if (analyzeCalls === 1) {
          return Promise.reject(new Error('LLM 429 (non-final attempt)'));
        }
        return Promise.resolve({ answersCount: 0, citedCount: 0, metricsCount: 0, needsReview: 0 });
      },
    } as unknown as AiAnalysisService;

    const processor = new AiSearchProcessor(countingSerpAi, runRepo, captureRepo, flakyAnalysis, {
      queueConcurrency: 3,
      captureLookbackDays: 30,
      captureScanLimit: 500,
    });
    const payload = {
      runId,
      channels: ['aiOverview'] as CaptureChannel[],
      keywords: ['asus zenbook'],
    };

    // Attempt 1 (attemptsMade=0): pull + persist succeed, analysis throws → BullMQ will retry the whole job.
    await expect(processor.process(makeJob(payload, 0))).rejects.toThrow('LLM 429');
    expect(pullCount).toBe(1);

    // Attempt 2 (attemptsMade=1): BullMQ retry re-runs process() from the top.
    const result = await processor.process(makeJob(payload, 1));

    expect(result.status).toBe('completed');
    expect(analyzeCalls).toBe(2);
    // The paid pull must have run exactly once across both attempts — the retry reuses the persisted captures.
    expect(pullCount).toBe(1);
    // No duplicate canonical rows: the retry did not re-persist (nor wipe + re-fetch).
    const rows = await prisma.aiSearchCapture.findMany({ where: { jobId: runId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('serpapi');
  });

  it('BullMQ retry after a transient failure BETWEEN the paid pull and persist does NOT re-charge the SerpAPI pull (#701/M15-R12)', async () => {
    // Root cause (M15-R1 residual window, #701): the reuse-on-retry guard only spares the paid pull
    // once persistCanonical lands. Any DB op BETWEEN the paid pull and persist (extension read /
    // progress write) that throws transiently aborts pre-persist → the retry sees nothing durable
    // (readCanonicalByJobId empty) → a full re-fetch → the SerpAPI pull is charged a second time.
    const { runId } = await runRepo.createRun({
      ownerId: null,
      idempotencyKey: 'job-retry-window',
      params: { schemaVersion: 'ai-search-v1' },
    });
    await seedExtensionCapture('chatGpt', 'asus zenbook');

    let pullCount = 0;
    const countingSerpAi: SerpAiProvider = {
      fetchAiOverviews: (keywords: string[]) => {
        pullCount += 1;
        return Promise.resolve(
          keywords.map((query) => ({ query, aiOverview: serpCanonical(query), creditsUsed: 1 })),
        );
      },
      fetchAiModes: (keywords: string[]) =>
        Promise.resolve(keywords.map((query) => ({ query, aiMode: null, creditsUsed: 0 }))),
      fetchBingCopilot: (keywords: string[]) =>
        Promise.resolve(keywords.map((query) => ({ query, copilot: null, creditsUsed: 0 }))),
    };

    // Real captureRepo; force the extension read (which sits between the paid pull and persist in the
    // buggy order) to throw once on the first attempt, then fall through to the real implementation.
    const readSpy = jest
      .spyOn(captureRepo, 'readRawExtensionCaptures')
      .mockRejectedValueOnce(new Error('transient DB error (mid-gather)'));

    const processor = new AiSearchProcessor(countingSerpAi, runRepo, captureRepo, stubAnalysis, {
      queueConcurrency: 3,
      captureLookbackDays: 30,
      captureScanLimit: 500,
    });
    const payload = {
      runId,
      channels: ['chatGpt', 'aiOverview'] as CaptureChannel[],
      keywords: ['asus zenbook'],
    };

    // Attempt 1 (attemptsMade=0): aborts mid-gather (transient), non-final → BullMQ will retry.
    await expect(processor.process(makeJob(payload, 0))).rejects.toThrow('transient DB error');
    // Attempt 2 (attemptsMade=1): BullMQ retry re-runs process() from the top.
    const result = await processor.process(makeJob(payload, 1));

    expect(result.status).toBe('completed');
    // The paid pull must have run exactly once across both attempts — no re-charge on retry.
    expect(pullCount).toBe(1);
    const rows = await prisma.aiSearchCapture.findMany({ where: { jobId: runId } });
    expect(rows.map((r) => `${r.source}:${r.channel}`).sort()).toEqual([
      'extension:chatGpt',
      'serpapi:aiOverview',
    ]);
    readSpy.mockRestore();
  });

  it('re-run is idempotent at the canonical layer (deleteByJobId clean slate → no duplicate rows)', async () => {
    const { runId } = await runRepo.createRun({
      ownerId: null,
      idempotencyKey: 'job-3',
      params: { schemaVersion: 'ai-search-v1' },
    });
    await seedExtensionCapture('chatGpt', 'asus zenbook');
    const processor = new AiSearchProcessor(fakeSerpAi(), runRepo, captureRepo, stubAnalysis, {
      queueConcurrency: 3,
      captureLookbackDays: 30,
      captureScanLimit: 500,
    });
    const job = makeJob({ runId, channels: ['chatGpt'], keywords: ['asus zenbook'] });

    await processor.process(job);
    await processor.process(job); // re-run (reset/retry)

    const rows = await prisma.aiSearchCapture.findMany({ where: { jobId: runId } });
    expect(rows).toHaveLength(1); // clean slate → no duplicate
  });
});
