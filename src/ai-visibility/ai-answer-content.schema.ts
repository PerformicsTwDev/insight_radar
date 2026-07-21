import { z } from 'zod';

/**
 * AI 回答（不可信第三方內容）**輸入契約** Zod schema（T15.1，FR-42 / NFR-19）——搬自 brand_intent_radar 的
 * AI Overview 資料形狀（text_blocks + references），與本專案 M14 `AiSearchCanonical{blocks,references}` /
 * `AiReference`（`src/captures/mapping/canonical.types.ts`）同形。
 *
 * 用途：(1) 回歸測試守住 prompt 資產所依賴的輸入形狀（brand_intent_radar 零測試、樣本即契約，上游漂移即紅燈）；
 * (2) 供 T15.2/T15.3 品牌/情緒/媒體服務在餵 LLM（經 {@link buildIsolatedMessages}）前做 shape 驗證。
 *
 * 容忍策略：宣告核心欄位型別（缺/型別變 → 紅燈），但**容忍上游新增欄位**（zod 預設 strip 未知欄，不硬崩），
 * 使 drift guard 抓「破壞性變更」而非「相容新增」。
 */

/** AI 引用（統一形狀，同 `AiReference`）：`{title, link, snippet?, source?, index}`。 */
export const aiReferenceSchema = z.object({
  title: z.string(),
  link: z.string(),
  snippet: z.string().optional(),
  source: z.string().optional(),
  index: z.number(),
});
export type AiReferenceInput = z.infer<typeof aiReferenceSchema>;

/**
 * AI Overview text block（遞迴）：`{type?, snippet?, reference_indexes?, list?}`。heading/paragraph 帶 `snippet`；
 * `list` block 以 `list[]` 巢狀子項（子項可再巢狀）。各欄皆 optional——涵蓋 top-level（恆帶 `type`）與巢狀 list
 * 子項（無 `type`）兩形。
 */
export interface AiTextBlockInput {
  type?: string;
  snippet?: string;
  reference_indexes?: number[];
  list?: AiTextBlockInput[];
}
export const aiTextBlockSchema: z.ZodType<AiTextBlockInput> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    snippet: z.string().optional(),
    reference_indexes: z.array(z.number()).optional(),
    list: z.array(aiTextBlockSchema).optional(),
  }),
);

/** 單筆 AI Overview 抓取的中立內容：`{text_blocks[], references[]}`。 */
export const aiOverviewSchema = z.object({
  text_blocks: z.array(aiTextBlockSchema),
  references: z.array(aiReferenceSchema),
});
export type AiOverviewInput = z.infer<typeof aiOverviewSchema>;
