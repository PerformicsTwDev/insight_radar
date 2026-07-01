import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import { createPrismaTestApp } from '../utils';

/**
 * TC-41（T8.1 / FR-16 / NFR-13 · Testcontainers `pgvector/pgvector:0.8.3-pg16`）：pgvector 就緒 + keyword_embeddings
 * 存讀。驗證 `CREATE EXTENSION vector`（≥0.7 才有 halfvec）、`halfvec(3072)` 經 `$queryRaw` 寫讀一致、cosine
 * `<=>` 正確、HNSW `halfvec_cosine_ops` 索引存在。embedding 欄以 Prisma `Unsupported` 宣告 → 一律走 raw SQL。
 */
const DIM = 3072;

/** 3072 維單位向量字面值（e_i：第 i 位為 1、其餘 0）；halfvec 文字形如 `[1,0,0,...]`。 */
function unitVectorLiteral(hotIndex: number): string {
  const arr = new Array<number>(DIM).fill(0);
  arr[hotIndex] = 1;
  return `[${arr.join(',')}]`;
}

async function insertEmbedding(
  prisma: PrismaService,
  normalizedText: string,
  literal: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO keyword_embeddings
       (normalized_text, geo, language, model, task_type, dim, input_hash, embedding)
     VALUES ($1, 'US', 'en', 'gemini-embedding-001', 'CLUSTERING', $2, $3, $4::halfvec)`,
    normalizedText,
    DIM,
    `hash-${normalizedText}`,
    literal,
  );
}

describe('keyword_embeddings (integration · Testcontainers pgvector, TC-41 / FR-16 / NFR-13)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM keyword_embeddings');
  });

  it('has the pgvector extension installed at >= 0.7 (halfvec support)', async () => {
    const rows = await prisma.$queryRawUnsafe<{ extversion: string }[]>(
      `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
    );
    expect(rows).toHaveLength(1);
    const [major, minor] = rows[0].extversion.split('.').map(Number);
    // ≥0.7：halfvec 型別與 halfvec_cosine_ops ANN 索引在 0.7 才引入。
    expect(major > 0 || (major === 0 && minor >= 7)).toBe(true);
  });

  it('round-trips a halfvec(3072) through $queryRaw (write === read)', async () => {
    await insertEmbedding(prisma, 'coffee', unitVectorLiteral(0));

    const rows = await prisma.$queryRawUnsafe<{ embedding: string; dim: number }[]>(
      `SELECT embedding::text AS embedding, dim FROM keyword_embeddings WHERE normalized_text = 'coffee'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dim).toBe(DIM);
    // halfvec 文字化為 `[1,0,0,...]`；維度 = 3072、第 0 位為 1。
    const parsed = JSON.parse(rows[0].embedding) as number[];
    expect(parsed).toHaveLength(DIM);
    expect(parsed[0]).toBe(1);
    expect(parsed[1]).toBe(0);
  });

  it('computes cosine distance with the <=> operator (self=0, orthogonal=1)', async () => {
    await insertEmbedding(prisma, 'coffee', unitVectorLiteral(0)); // e0

    const rows = await prisma.$queryRawUnsafe<{ self: number; ortho: number }[]>(
      `SELECT embedding <=> $1::halfvec AS self,
              embedding <=> $2::halfvec AS ortho
         FROM keyword_embeddings WHERE normalized_text = 'coffee'`,
      unitVectorLiteral(0), // 同向 → cosine 距離 0
      unitVectorLiteral(1), // 正交 → cosine 距離 1
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].self)).toBeCloseTo(0, 5);
    expect(Number(rows[0].ortho)).toBeCloseTo(1, 5);
  });

  it('created the HNSW halfvec_cosine_ops ANN index (手寫 migration)', async () => {
    const rows = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_keyword_embeddings_hnsw'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/USING hnsw/i);
    expect(rows[0].indexdef).toMatch(/halfvec_cosine_ops/i);
  });
});
