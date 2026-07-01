/**
 * Embedding 低階呼叫的 Port（T8.2，FR-16，NFR-3 可測 / DI 可替換）。上層依賴此介面，不綁 `@google/genai`
 * SDK 型別（adapter = GeminiEmbeddingService，T8.2 slice B）。
 */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** 一批文字 → 對應的向量（順序與輸入對齊；維度 = GEMINI_EMBEDDING_DIM）。 */
export interface EmbeddingProvider {
  embed(inputs: string[]): Promise<number[][]>;
}
