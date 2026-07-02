import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma';

/** keyword_embeddings 複合鍵（= PK：geo/language/normalizedText/model/taskType/dim）。 */
export interface EmbeddingKey {
  geo: string;
  language: string;
  normalizedText: string;
  model: string;
  taskType: string;
  dim: number;
}

/** 一筆待固化的 embedding（鍵 + input_hash + 向量）。 */
export interface EmbeddingRecord extends EmbeddingKey {
  inputHash: string;
  embedding: number[];
}

/** number[] → pgvector/halfvec 文字字面（`[v0,v1,...]`）。 */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * keyword_embeddings 儲存層（T8.2c，FR-16/NFR-13）。`embedding` 欄為 pgvector `halfvec(3072)`（Prisma
 * `Unsupported` → **全走 raw SQL**）：upsert 用 `$N::halfvec` 文字字面 param（參數化、非字串插值，防注入）；
 * 讀用 `embedding::text` 還原 number[]。upsert 於 PK 衝突時 latest-wins（更新 input_hash + 向量 + created_at）。
 */
@Injectable()
export class EmbeddingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 批次 upsert（單一交易；PK 衝突 → 更新）。空陣列 → no-op。 */
  async upsertMany(records: EmbeddingRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.prisma.$transaction(
      records.map((record) =>
        this.prisma.$executeRawUnsafe(
          `INSERT INTO keyword_embeddings
             (geo, language, normalized_text, model, task_type, dim, input_hash, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::halfvec)
           ON CONFLICT (geo, language, normalized_text, model, task_type, dim)
           DO UPDATE SET input_hash = EXCLUDED.input_hash,
                         embedding  = EXCLUDED.embedding,
                         created_at = now()`,
          record.geo,
          record.language,
          record.normalizedText,
          record.model,
          record.taskType,
          record.dim,
          record.inputHash,
          toVectorLiteral(record.embedding),
        ),
      ),
    );
  }

  /**
   * 讀回一組 keyword 的已存向量（供分群，T8.9）。固定 geo/language/model/taskType/dim，`normalizedText ∈ texts`。
   * 回 `Map<normalizedText, number[]>`（未命中者不在 map 中）。
   */
  async findVectors(query: {
    geo: string;
    language: string;
    model: string;
    taskType: string;
    dim: number;
    normalizedTexts: string[];
  }): Promise<Map<string, number[]>> {
    const result = new Map<string, number[]>();
    if (query.normalizedTexts.length === 0) {
      return result;
    }
    const rows = await this.prisma.$queryRawUnsafe<
      { normalized_text: string; embedding: string }[]
    >(
      `SELECT normalized_text, embedding::text AS embedding
         FROM keyword_embeddings
        WHERE geo = $1 AND language = $2 AND model = $3 AND task_type = $4 AND dim = $5
          AND normalized_text = ANY($6::text[])`,
      query.geo,
      query.language,
      query.model,
      query.taskType,
      query.dim,
      query.normalizedTexts,
    );
    for (const row of rows) {
      result.set(row.normalized_text, JSON.parse(row.embedding) as number[]);
    }
    return result;
  }
}
