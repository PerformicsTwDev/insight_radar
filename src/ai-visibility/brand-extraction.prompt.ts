import type { ChatMessage } from '../intent/intent-labeler.port';
import { buildIsolatedMessages } from './injection-isolation';

/**
 * 品牌抽取 prompt（T15.1，FR-42/AC-42.1 / NFR-19）——搬自 brand_intent_radar `extract-brands-from-text-blocks`。
 * 忠實保留 **S17 業務規則：不去重＝露出次數**（同品牌多次出現計多次，不可當 bug「修正」）。輸出改為 array 形
 * `{ results:[{ id, brands[] }] }`（見 `brand-extraction.schema.ts`，適配 Azure strict）。
 *
 * 不可信第三方內容（AI 回答 blocks）一律經 {@link buildIsolatedMessages} 隔離（指令/資料分離、明確邊界，
 * 不拼進指令尾）。
 */
export const BRAND_EXTRACTION_SYSTEM_PROMPT = `你是一位專精資訊抽取的資料分析專家。任務：從提供的 AI 回答 text blocks 中抽取所有「品牌名稱」，並依 block id 逐一輸出。

品牌抽取規則：
1. 僅抽取品牌名稱，不含產品型號（例：ASUS Vivobook → ASUS、Lenovo IdeaPad → Lenovo、MacBook Air → Apple）。
2. 品牌名稱標準化為最通用的官方英文名稱（例：華碩 → ASUS、宏碁 → Acer、微星 → MSI、聯想 → Lenovo）；未知品牌轉首字母大寫。
3. 不可將產品系列當作品牌（Nitro → Acer、Legion → Lenovo）。
4. 若某 block 無任何品牌，該 block 回傳空陣列。
5. 品牌計數規則（重要）：
   - 遍歷每個 block 的所有文字，品牌每在文字中出現一次，就在該 block 的品牌陣列中加入一次。
   - 同一句話中的重複也要計算（例："Apple MacBook 和 Apple iPad" → Apple 出現 2 次）。
   - **不要去重**——忠實反映品牌在文字中的總露出次數。

輸出格式：
- 對每個輸入 block 產生一筆 { id, brands }：id = 該 block 的 id；brands = 依出現順序、未去重的品牌名稱陣列。
- 僅輸出 { results: [...] }，results 的筆數必須等於輸入 block 的數量，順序一致。`;

/** 建構品牌抽取的隔離訊息（system 規則 + user 邊界包夾的不可信 blocks）。 */
export function buildBrandExtractionMessages(blocks: unknown): ChatMessage[] {
  return buildIsolatedMessages(BRAND_EXTRACTION_SYSTEM_PROMPT, blocks);
}
