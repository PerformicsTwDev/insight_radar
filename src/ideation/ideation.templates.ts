/**
 * AI 發想的**模板允許清單**（T12.10，FR-35 / AC-35.1/35.3）。`template` 為 request 中的 **key**（非自由字串）；
 * 每 key 映射一段 **server-controlled prompt directive**（發想角度）——由後端掌控 prompt、避免以 template 文字注入
 * （S19；seeds 本身另做注入隔離）。未知 key → 400（DTO `@IsIn`）。內容 zh-TW（產品語境）；可依 mockup 增刪。
 */
export const IDEATION_TEMPLATES = {
  technical_terms: '列出與種子詞相關的專業術語、技術規格與行業用語',
  pain_points: '列出種子詞相關的消費者痛點、常見困難與問題描述',
  subtopics: '挖掘種子詞的延伸子主題、冷門需求與細分查詢',
  competitor_comparison: '列出與種子詞相關的競品名稱、品牌差異與比較用詞',
  trends: '列出種子詞的最新趨勢、熱門話題與時事關聯詞',
  related_products: '列出與種子詞相關的產品、配件與輔助工具',
  buying_motivation: '分析種子詞的情感訴求、購買動機與決策考量詞',
  cross_industry: '探索種子詞的跨產業關聯、應用場景與情境化查詢',
  controversies: '整理種子詞的爭議話題、正反面討論與比較觀點',
  myths: '列出種子詞的常見迷思、謠言與破解澄清查詢',
} as const;

export type IdeationTemplate = keyof typeof IDEATION_TEMPLATES;

/** 允許的 template key 清單（供 DTO `@IsIn` 與測試）。 */
export const IDEATION_TEMPLATE_KEYS = Object.keys(IDEATION_TEMPLATES) as IdeationTemplate[];
