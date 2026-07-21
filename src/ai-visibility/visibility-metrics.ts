import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';
import { deriveDomain } from '../serp/parse-serpapi';

/**
 * AI 可見度指標**純函式**（T15.4；FR-43，AC-43.1/43.2/43.3，TC-79）。**無 IO/LLM/DB**：把每個
 * (channel × dimension × group) 範疇的觀測，攤成 per (… × brand) 的指標列，供讀取層（FR-44 view）格式化。
 *
 * 指標（AC-43.1）per scope × brand：
 * - **mentions**＝露出次數（**刻意不去重**，S17；`countMentions`）。
 * - **shareOfVoice**＝品牌提及 ÷ 全品牌提及總數；**分母（範疇全品牌提及總數）為 0 → null**（無資料、不除
 *   0、不呈現 0% 假訊號，AC-43.2）；**分子 0 但分母 > 0 → 真實 `0`**（AC-43.1 合法 0% 聲量，不遮蔽）；`shareOfVoice`。
 * - **citations**＝引用命中 `BrandProfile.sites`/domain 次數（`countCitations`）。
 * - **exposure**＝範疇關鍵字 `avgMonthlySearches` 加總；**任一 null → 不計入（不補 0）**、全 null/空 → null
 *   （複用 Search 線指標，比照 micros/cpc null≠0；`sumExposure`）。
 *
 * **指標計算與 view 格式解耦**：本層只出指標值——`shareOfVoice` 為**比例（0..1）**、無 %、無標籤、無 KPI；
 * 百分比/分數卡呈現由 view 層（FR-44）負責。各原始運算亦抽為獨立 export 純函式，可各自單元測試。
 */

/** 可見度分組維度（AC-43.3）：keyword / 意圖主題 / 購買歷程主題。 */
export type VisibilityDimension = 'keyword' | 'intent' | 'journey';

/** BrandProfile 的可見度相關面（T14.5）：canonical `name`（報告/歸戶用）+ `sites`（citations 命中用）。 */
export interface VisibilityBrand {
  name: string;
  sites: readonly string[];
}

/** 一個 (channel × dimension × group) 範疇的觀測。純資料，無 IO。 */
export interface AiVisibilityScope {
  channel: CaptureChannel;
  dimension: VisibilityDimension;
  /** 分組值：keyword 文字 / 意圖主題 / 購買歷程主題。 */
  group: string;
  /**
   * 該範疇 AI 回答抽出的品牌提及（canonical names，**刻意不去重＝露出次數**，T15.2/S17）。
   * 每個元素＝一次露出；含未追蹤競品字（不在報告品牌集內、但仍計入分母）。
   */
  mentions: readonly string[];
  /** 該範疇 AI 回答的引用連結（URL 或裸 domain）；命中某品牌 `sites` → 該品牌 citations +1。 */
  citations: readonly string[];
  /**
   * 該範疇涉及關鍵字的 `avgMonthlySearches`（複用 Search 線 `KeywordMetrics`）；
   * **任一 null → 該筆不計入（不補 0）**（正確性單點，比照 micros/cpc null≠0）。
   */
  searchVolumes: readonly (number | null)[];
}

/** 單一 (channel × dimension × group × brand) 的可見度指標列（指標值，**不含 view 格式**，解耦）。 */
export interface AiVisibilityCell {
  channel: CaptureChannel;
  dimension: VisibilityDimension;
  group: string;
  brand: string;
  /** 露出次數（不去重）。 */
  mentions: number;
  /** AI 聲量＝品牌提及 ÷ 全品牌提及總數（比例 0..1）；分母（全品牌提及總數）為 0 → null；分子 0 分母>0 → 真實 0。 */
  shareOfVoice: number | null;
  /** 引用命中數（`BrandProfile.sites`/domain 命中次數）。 */
  citations: number;
  /** 曝光數＝範疇關鍵字 `avgMonthlySearches` 加總（null 不計入）；全 null/空 → null。 */
  exposure: number | null;
}

/**
 * AI 聲量（share of voice）＝品牌提及 ÷ 全品牌提及總數。
 * **分母（範疇全品牌提及總數）為 0 → null**（無資料、不除 0、不 NaN、不呈現 0% 假訊號，AC-43.2）。
 * **分子（該品牌提及）為 0 但分母 > 0 → 回真實 `0`**（該品牌在此範疇 0% 聲量、競品有聲量，是 AC-43.1
 * `0/total` 的合法且有意義輸出——最需被看見的「競品壓過本品牌」訊號，不可遮蔽成 null）。
 * 回傳**比例**（0..1）；view 層乘 100 呈現為 %（指標與 view 格式解耦）。
 */
export function shareOfVoice(brandMentions: number, totalMentions: number): number | null {
  if (totalMentions <= 0) {
    return null; // 分母 0：無資料，不除 0
  }
  return brandMentions / totalMentions;
}

/**
 * 曝光數＝一組關鍵字 `avgMonthlySearches` 加總。**任一 null → 該筆不計入（不補 0）**；
 * 無任何非 null 值（全 null 或空集）→ null（不呈現假的 0，比照 Search 線 micros/cpc null≠0）。
 * 真實的 `0` 搜量保留（與 null 語意不同）。
 */
export function sumExposure(searchVolumes: readonly (number | null)[]): number | null {
  let sum = 0;
  let seen = false;
  for (const value of searchVolumes) {
    if (value === null) {
      continue; // null 不補 0、不計入
    }
    sum += value;
    seen = true;
  }
  return seen ? sum : null;
}

/** 某 canonical 品牌在提及陣列中的露出次數（**不去重**，逐筆精確比對）。 */
export function countMentions(mentions: readonly string[], brand: string): number {
  let count = 0;
  for (const mention of mentions) {
    if (mention === brand) {
      count += 1;
    }
  }
  return count;
}

/** 正規化 domain：接受裸 domain 或 URL；小寫、去前綴 `www.`；不可解析 → `''`（不拋）。 */
export function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return '';
  }
  // 已含 scheme → 直接取 host；裸 domain/path → 補 https:// 再統一走 deriveDomain。
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed);
  const host = deriveDomain(hasScheme ? trimmed : `https://${trimmed}`);
  return host.replace(/^www\./, '');
}

/** 引用連結是否命中品牌官網 domain（精確或子網域後綴命中；如 `rog.asus.com` 命中 `asus.com`）。 */
export function citationHitsBrand(link: string, siteDomains: readonly string[]): boolean {
  const host = normalizeDomain(link);
  if (host.length === 0) {
    return false;
  }
  for (const site of siteDomains) {
    const siteHost = normalizeDomain(site);
    if (siteHost.length === 0) {
      continue; // 空/不可解析 site 條目忽略，不誤命中
    }
    if (host === siteHost || host.endsWith(`.${siteHost}`)) {
      return true;
    }
  }
  return false;
}

/** 某品牌在一組引用連結中的命中計數（逐筆，命中各計一次）。 */
export function countCitations(
  citations: readonly string[],
  siteDomains: readonly string[],
): number {
  let count = 0;
  for (const link of citations) {
    if (citationHitsBrand(link, siteDomains)) {
      count += 1;
    }
  }
  return count;
}

/**
 * AI 可見度指標純函式（FR-43）——把每個 (channel × dimension × group) 範疇攤成 per-brand 指標列。
 *
 * - 全品牌提及總數（分母）＝ `scope.mentions.length`（每筆＝一次露出，含未追蹤競品）。
 * - 報告品牌集＝ `brands`（本品牌 + 競品）：每個品牌恆產出一列（即使零提及，供 view 完整列）。
 * - `exposure` 為**範疇屬性**（關鍵字搜量），per-brand cell 皆同值。
 * - 呼叫端契約：每個 (channel × dimension × group) 一個 scope（分組/歸戶由組裝層負責，本函式只算指標）。
 */
export function buildAiVisibility(
  scopes: readonly AiVisibilityScope[],
  brands: readonly VisibilityBrand[],
): AiVisibilityCell[] {
  const cells: AiVisibilityCell[] = [];
  for (const scope of scopes) {
    const totalMentions = scope.mentions.length;
    const exposure = sumExposure(scope.searchVolumes);
    for (const brand of brands) {
      const mentions = countMentions(scope.mentions, brand.name);
      cells.push({
        channel: scope.channel,
        dimension: scope.dimension,
        group: scope.group,
        brand: brand.name,
        mentions,
        shareOfVoice: shareOfVoice(mentions, totalMentions),
        citations: countCitations(scope.citations, brand.sites),
        exposure,
      });
    }
  }
  return cells;
}
