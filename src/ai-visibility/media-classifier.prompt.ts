import type { ChatMessage } from '../intent/intent-labeler.port';
import { buildIsolatedMessages } from './injection-isolation';
import { MEDIA_TYPES } from './media-classifier.schema';

/**
 * 引用媒體分類 prompt（T15.1，FR-42/AC-42.3 / NFR-19）——搬自 brand_intent_radar `url-media-classifier`。
 * 僅依 domain/subdomain 判斷媒體來源類型（9 類 enum），**不得**抓頁面內容/展開短網址/推測 intent。
 *
 * references（含 link）為**不可信第三方內容** → 經 {@link buildIsolatedMessages} 隔離（指令/資料分離、明確邊界）。
 * 允許類別由 {@link MEDIA_TYPES} 單一來源渲染（與輸出 schema enum 同步、不漂移）。
 */
const ALLOWED_TYPES = MEDIA_TYPES.join(' / ');

export const MEDIA_CLASSIFIER_SYSTEM_PROMPT = `你是「URL 媒體類別分類器」。只能根據每個網址的 domain / subdomain 判斷其媒體來源類型；**不得**抓取頁面內容、不得展開短網址、不得依 path/query/fragment 或推測頁面 intent。

規則：
- 每個 reference 只輸出 1 個 type。
- type 只能使用下列允許的英文類別（不可自創）；無法判斷時使用 other。

允許的類別（英文變數 → 中文說明）：${ALLOWED_TYPES}
- ecommerce → 電商平台（momo/pchome/shopee/books/pinkoi…）
- retail → 通路零售（品牌/電信官方站…）
- review → 評測站（eprice/sogi/整站評測比價…）
- news → 新聞媒體（udn/ltn/ettoday/cna/tvbs/storm…）
- content → 內容媒體（雜誌/企劃專題：gq/bnext/vogue…）
- blog → 部落格／個人內容（vocus/pixnet/medium…）
- social → 社群論壇（mobile01/dcard/ptt/threads/facebook/reddit/youtube…）
- gov → 政府學研（gov.tw/edu.tw…）
- other → 其他（不確定或不屬以上）

輸出：每個 reference 一筆 { id, type }（id 對應輸入）；僅輸出 { references: [...] }。`;

/** 建構媒體分類的隔離訊息（system 規則 + user 邊界包夾的不可信 references）。 */
export function buildMediaClassifierMessages(references: unknown): ChatMessage[] {
  return buildIsolatedMessages(MEDIA_CLASSIFIER_SYSTEM_PROMPT, references);
}
