import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import { EmbeddingRepository, type EmbeddingRecord } from 'src/embeddings/embedding.repository';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * EmbeddingRepository（T8.2c · FR-16/NFR-13 · Testcontainers pgvector）：raw-SQL halfvec(3072) upsert/read
 * 往返、PK 衝突 latest-wins、findVectors 依 model/dim/normalizedText 過濾。embedding 欄 Unsupported → 全 raw SQL。
 */
const DIM = 3072;

/** 3072 維向量：第 0 位為 head、其餘 0。 */
function vec(head: number): number[] {
  const arr = new Array<number>(DIM).fill(0);
  arr[0] = head;
  return arr;
}

function record(
  normalizedText: string,
  head: number,
  overrides: Partial<EmbeddingRecord> = {},
): EmbeddingRecord {
  return {
    geo: 'US',
    language: 'en',
    normalizedText,
    model: 'gemini-embedding-001',
    taskType: 'CLUSTERING',
    dim: DIM,
    inputHash: `hash-${normalizedText}`,
    embedding: vec(head),
    ...overrides,
  };
}

const QUERY = {
  geo: 'US',
  language: 'en',
  model: 'gemini-embedding-001',
  taskType: 'CLUSTERING',
  dim: DIM,
};

describe('EmbeddingRepository (integration · Testcontainers pgvector, T8.2c)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: EmbeddingRepository;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    repo = new EmbeddingRepository(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM keyword_embeddings');
  });

  it('upserts and reads back halfvec(3072) vectors, keyed by normalizedText', async () => {
    await repo.upsertMany([record('coffee', 1), record('latte', 2)]);

    const vectors = await repo.findVectors({ ...QUERY, normalizedTexts: ['coffee', 'latte'] });

    expect(vectors.size).toBe(2);
    expect(vectors.get('coffee')).toHaveLength(DIM);
    expect(vectors.get('coffee')?.[0]).toBe(1);
    expect(vectors.get('latte')?.[0]).toBe(2);
  });

  it('is latest-wins on PK conflict (re-upsert overwrites vector + input_hash)', async () => {
    await repo.upsertMany([record('coffee', 1, { inputHash: 'h1' })]);
    await repo.upsertMany([record('coffee', 9, { inputHash: 'h2' })]); // 同 PK、不同向量

    const vectors = await repo.findVectors({ ...QUERY, normalizedTexts: ['coffee'] });
    expect(vectors.get('coffee')?.[0]).toBe(9); // 最新覆寫

    const rows = await prisma.$queryRawUnsafe<{ input_hash: string }[]>(
      `SELECT input_hash FROM keyword_embeddings WHERE normalized_text = 'coffee'`,
    );
    expect(rows).toHaveLength(1); // 不新增列
    expect(rows[0].input_hash).toBe('h2');
  });

  it('findVectors only returns the queried normalizedTexts (no over-fetch)', async () => {
    await repo.upsertMany([record('coffee', 1), record('latte', 2), record('mocha', 3)]);

    const vectors = await repo.findVectors({ ...QUERY, normalizedTexts: ['coffee', 'mocha'] });
    expect([...vectors.keys()].sort()).toEqual(['coffee', 'mocha']);
  });

  it('findVectors filters by dim/model (a different-dim/model row is not returned)', async () => {
    await repo.upsertMany([record('coffee', 1)]);

    // 不同 model → 不命中（PK 不同；此處 model 過濾）。
    const other = await repo.findVectors({
      ...QUERY,
      model: 'other-model',
      normalizedTexts: ['coffee'],
    });
    expect(other.size).toBe(0);
  });

  it('upsertMany([]) is a no-op; findVectors([]) returns empty', async () => {
    await expect(repo.upsertMany([])).resolves.toBeUndefined();
    const vectors = await repo.findVectors({ ...QUERY, normalizedTexts: [] });
    expect(vectors.size).toBe(0);
  });
});
