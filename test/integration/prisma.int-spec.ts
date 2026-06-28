import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule, PrismaService } from 'src/prisma';

describe('PrismaService (integration · Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init(); // onModuleInit → $connect to the Testcontainers DB
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close(); // onModuleDestroy → $disconnect
  });

  afterEach(async () => {
    await prisma.keywordAnalysis.deleteMany();
  });

  it('creates and reads a KeywordAnalysis on real Postgres (uuid id, jsonb columns)', async () => {
    const created = await prisma.keywordAnalysis.create({
      data: {
        status: 'queued',
        seeds: ['shoes', 'running shoes'],
        params: { mode: 'expand' },
        progress: { phase: 'queued' },
        idempotencyKey: 'idem-1',
      },
    });

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const found = await prisma.keywordAnalysis.findUnique({ where: { id: created.id } });
    expect(found).not.toBeNull();
    expect(found?.idempotencyKey).toBe('idem-1');
    expect(found?.status).toBe('queued');
    expect(found?.seeds).toEqual(['shoes', 'running shoes']);
  });

  it('enforces the unique idempotency_key constraint', async () => {
    const base = {
      status: 'queued' as const,
      seeds: [],
      params: {},
      progress: {},
      idempotencyKey: 'dup',
    };
    await prisma.keywordAnalysis.create({ data: base });

    await expect(prisma.keywordAnalysis.create({ data: base })).rejects.toThrow();
  });
});
