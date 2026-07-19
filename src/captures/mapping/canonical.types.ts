import type { CaptureChannel, CapturePlatform, CaptureSource } from '../dto/capture-ingest.dto';

/**
 * per-source/per-platform normalization mapper 框架的中立契約（T13.4 / FR-37；Design §18.1/§18.2/§18.3/§18.5）。
 *
 * 分層原則（INV-4/5）：raw（`captures.payload`，append-only）→ mapper（**純函式**，core ≥ 90%）→ canonical
 * 具名實體（`AiSearchCapture` / `SocialPost`）。**單向**：canonical 只由 raw 推導；vendor schema 變動只修
 * mapper + reparse raw，分析層不知資料來自哪個來源/平台（換來源 = 換 mapper + golden fixture）。
 *
 * ⚠ 邊界（T13.4 ↔ T13.5）：本檔為 registry 框架 + 純函式 mapper **骨架**契約。golden fixtures（取自 extension
 * `src/contentScripts/sites/<site>/type.ts` 權威形狀）+ contract test 屬 **T13.5**；per-channel/per-platform
 * mapper 的實欄位填充屬 M14（T14.4）/ M16（T16.5）。
 */

/** 中立化結果狀態（AC-37.4）。`ok`=全欄可映；`partial`=核心欄在但有未知欄/次要缺漏；`failed`=核心欄缺、無法產出 canonical。 */
export type MapStatus = 'ok' | 'partial' | 'failed';

/**
 * AI 引用統一形狀（AC-37.3 / AC-39.3；Design §18.3）——跨渠道收斂：
 * `NewAiOverviewReference{title,link,snippet?,source?,index}` / Gemini `{name,url}` / … → 同一形狀。
 * `source` = 引用來源標籤（媒體/發布者），與 capture 的 `source`（extension/serpapi/…）語意不同。
 */
export interface AiReference {
  title: string;
  link: string;
  snippet?: string;
  source?: string;
  index: number;
}

/**
 * AI 線 canonical 形狀（Design §18.3；`AiSearchCapture` 具名表投影）。`blocks` 為中立化 text blocks——
 * 骨架期原樣保留（per-channel 內部結構於 M14 填充），只保證為陣列。`capturedAt` = raw 收件時點（ISO）。
 */
export interface AiSearchCanonical {
  source: CaptureSource;
  channel: CaptureChannel;
  schemaVersion: string;
  query: string;
  blocks: unknown[];
  references: AiReference[];
  capturedAt: string;
}

/**
 * Social 線 canonical 形狀（Design §18.5；`SocialPost` 具名表投影，metrics 攤平為 nullable 欄位）。
 * - `postKey` = `normalize(permalink/url)`（S13 唯一去重鍵）；跨來源 merge 語意（取較長全文 / metrics 取 extension /
 *   `source=merged`）屬 FR-46（T16.5），**非本 task**。
 * - `likes/comments/reposts/shares` **nullable**（S14 缺值≠0）：reserved API / readability 缺互動數 → null（不補 0）。
 * - `publishedAt` = 貼文真實時間（中文在地化字串 → ISO）；缺/不可解析 → null。`capturedAt` = raw 收件時點（ISO）。
 */
export interface SocialPostCanonical {
  source: CaptureSource;
  platform: CapturePlatform;
  schemaVersion: string;
  postKey: string;
  author: string | null;
  profileLink: string | null;
  content: string;
  publishedAt: string | null;
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  shares: number | null;
  capturedAt: string;
}

/** 兩線 canonical 聯集（registry `normalize` 回傳型別）。 */
export type CanonicalCapture = AiSearchCanonical | SocialPostCanonical;

/**
 * mapper 輸入（來自 raw 層一筆 capture）。`channel`（AI）XOR `platform`（Social）決定分派的線與 discriminator。
 * `payload` 為 raw JSONB（`unknown`，由 mapper 收斂）；`capturedAt` 為 raw 收件時點。
 */
export interface MapperInput {
  source: CaptureSource;
  schemaVersion: string;
  channel?: CaptureChannel;
  platform?: CapturePlatform;
  payload: unknown;
  capturedAt: Date | string;
}

/**
 * 中立化結果（AC-37.4）。`raw` **恆保留**（可 reparse，INV-4）；`canonical` 於 `failed` 為 `null`、
 * 於 `partial`/`ok` 為 best-effort 中立實體；`reasons` 記錄狀態成因（未知欄位 / 缺漏 / 不可解析），供
 * 觀測與 T13.5 contract 漂移報告。
 */
export interface MapResult<T extends CanonicalCapture = CanonicalCapture> {
  mapStatus: MapStatus;
  canonical: T | null;
  raw: unknown;
  reasons: string[];
}
