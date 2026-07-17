/**
 * AI 發想的**模板允許清單**（T12.10，FR-35 / AC-35.1/35.3）。`template` 為 request 中的 **key**（非自由字串）；
 * 每 key 映射一段 **server-controlled prompt directive**（發想角度）——由後端掌控 prompt、避免以 template 文字注入
 * （S19；seeds 本身另做注入隔離）。未知 key → 400（DTO `@IsIn`）。內容 zh-TW（產品語境）；可依 mockup 增刪。
 */
export const IDEATION_TEMPLATES = {
  technical_terms: '列出與種子詞相關的專業術語、技術規格與行業用語',
  competitor_comparison: '列出與種子詞相關的競品名稱、品牌與比較用詞',
  use_cases: '列出種子詞的使用情境、應用場景與情境化查詢',
  target_audience: '列出種子詞的目標受眾、客群描述與相關人群詞',
  pain_points: '列出種子詞相關的需求痛點、問題與困擾描述',
  buying_guide: '列出種子詞的選購考量、規格比較與購買決策用詞',
  long_tail: '列出種子詞的長尾關鍵字、具體問句與細分需求',
  related_concepts: '列出與種子詞語意相關的概念、聯想詞與延伸主題',
} as const;

export type IdeationTemplate = keyof typeof IDEATION_TEMPLATES;

/** 允許的 template key 清單（供 DTO `@IsIn` 與測試）。 */
export const IDEATION_TEMPLATE_KEYS = Object.keys(IDEATION_TEMPLATES) as IdeationTemplate[];
