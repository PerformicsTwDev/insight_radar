import { sumExposure } from '../../ai-visibility/visibility-metrics';
import { buildPredicate, type FilterSpec } from '../filter-spec';
import { type PageMeta, decodeCursor, encodeCursor } from '../paginate';
import type {
  ColumnDef,
  QueryPagination,
  QuerySort,
  SummaryViewResult,
  TableViewResult,
} from './view-definition';

/**
 * AI Search 讀取層 view 的**純形狀函式**（T15.8b，#678 G2；FR-44/AC-44.1）。把 T15.5 落庫列
 * （`ai_answers`/`ai_cited_references`/`ai_visibility_metrics`，由 `AiVisibilityReadRepository` keyed by
 * 最新 linked `AiSearchRun.id`〔任何 status、與 gate 同一 `findLatestLinkedRun`，M15-R13〕讀出）→ 統一 `FilterSpec` 過濾 → 排序 → 分頁 → 投影 view 形狀。
 *
 * **無 IO/DB**：列由 SnapshotQueryService 載入後注入（比照 journey/custom 動態 view 的「載入 + 純 build」分工）。
 * **統一 FilterSpec（INV-1/2）**：過濾直接複用 `buildPredicate`（keyword 讀取層同一單點）——AI 列以其主要文字欄
 * （query / groupKey / mediaType）餵 `q`；其餘 keyword 導向的界（volume/cpc/competition/intent）於 AI 列無對應
 * 屬性、設定即不滿足（`null` 不假造為可比較值，缺值≠0）——為 forward-compat（channel/brand/dimension filter 待擴充）。
 */

/** 一列 AI 回答（`ai_answers`；`id` 為分頁穩定 tie-break 鍵）。 */
export interface AiAnswerReadRow {
  id: string;
  channel: string;
  query: string;
  answerText: string;
  brands: string[];
  positive: number;
  negative: number;
}

/** 一列引用媒體（`ai_cited_references`）。 */
export interface AiCitedReadRow {
  id: string;
  channel: string;
  query: string;
  link: string;
  domain: string;
  title: string | null;
  mediaType: string;
}

/** 一列可見度指標（`ai_visibility_metrics`，dimension 已於載入層篩選）。 */
export interface AiMetricReadRow {
  id: string;
  channel: string;
  groupKey: string;
  brand: string;
  mentions: number;
  shareOfVoice: number | null;
  citations: number;
  exposure: number | null;
}

/**
 * 排序可比較值：number 原樣、null/undefined→null（置尾）、string 原樣、其餘（array/object，如 `brands`）→穩定
 * JSON 字串序（避免 `no-base-to-string`——不對 object 隱式 `String()`）。keyed 欄（id/mediaType）另以 `as string`
 * 直取（DB 保證 string），不經此。
 */
function asComparable(value: unknown): number | string | null {
  if (typeof value === 'number') {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

/** 以統一 `FilterSpec` 過濾（複用 `buildPredicate`；`q` 作用於 `textOf` 取的主要文字欄）。 */
function filterByText<T>(rows: readonly T[], filters: FilterSpec, textOf: (row: T) => string): T[] {
  const predicate = buildPredicate(filters);
  return rows.filter((row) =>
    predicate({
      text: textOf(row),
      avgMonthlySearches: null,
      competition: '',
      competitionIndex: null,
      cpcLow: null,
      cpcHigh: null,
      intent: [],
    }),
  );
}

/**
 * 泛型排序：數值欄→數值序、其餘→字串序；`null`/`undefined` 一律置尾（不受方向影響，比照 keyword 讀取層），
 * 以 `keyOf`（穩定唯一鍵）tie-break 保確定性全序（翻頁不漂移）。`field` 已由 QueryViewService 驗 ⊆ allowedSort。
 */
function sortRows<T>(
  rows: readonly T[],
  field: string,
  direction: 'asc' | 'desc',
  keyOf: (row: T) => string,
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  const valueOf = (row: T): number | string | null =>
    asComparable((row as Record<string, unknown>)[field]);
  return [...rows].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av === null || bv === null) {
      if (!(av === null && bv === null)) {
        return av === null ? 1 : -1; // null 置尾（與方向無關）
      }
    } else {
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        // av/bv 為 number|string（asComparable 收斂）——String() 對兩者皆有意義（非 object，no-base-to-string 安全）。
        const as = String(av);
        const bs = String(bv);
        cmp = as < bs ? -1 : as > bs ? 1 : 0;
      }
      if (cmp !== 0) {
        return cmp * sign;
      }
    }
    // tie-break：以穩定唯一鍵（DB id / mediaType）asc——每列 key 唯一 → 全序確定、翻頁不漂移（相等不會發生）。
    const ak = keyOf(a);
    const bk = keyOf(b);
    return ak < bk ? -1 : 1;
  });
}

/** offset（page/pageSize）+ cursor（opaque，編碼 `keyOf`）分頁，回頁列 + `PageMeta`（比照 `selectPage`）。 */
function paginate<T>(
  sorted: readonly T[],
  pagination: QueryPagination | undefined,
  keyOf: (row: T) => string,
): { rows: T[]; meta: PageMeta } {
  const total = sorted.length;
  const pageSize = Math.max(1, pagination?.pageSize ?? 50);
  let startIndex: number;
  let pageNum: number;
  if (pagination?.cursor !== undefined) {
    const key = decodeCursor(pagination.cursor);
    const idx = key === null ? -1 : sorted.findIndex((row) => keyOf(row) === key);
    startIndex = idx >= 0 ? idx + 1 : total; // 未知/畸形 cursor → 空尾頁
    pageNum = Math.floor(startIndex / pageSize) + 1;
  } else {
    pageNum = Math.max(1, pagination?.page ?? 1);
    startIndex = (pageNum - 1) * pageSize;
  }
  const rows = sorted.slice(startIndex, startIndex + pageSize);
  const endIndex = startIndex + rows.length;
  const last = rows[rows.length - 1];
  const cursor = last !== undefined && endIndex < total ? encodeCursor(keyOf(last)) : null;
  return { rows, meta: { total, page: pageNum, pageSize, cursor } };
}

/** 通用 AI table build：filter（統一 FilterSpec）→ sort → paginate → 投影 select 欄位。 */
function buildTable<T>(
  viewName: string,
  columns: readonly ColumnDef[],
  allowedSelect: readonly string[],
  rows: readonly T[],
  request: {
    filters?: FilterSpec;
    sort?: QuerySort[];
    pagination?: QueryPagination;
    select?: string[];
  },
  keyField: string,
  textField: string,
): TableViewResult {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const rec = (row: T): Record<string, unknown> => row as Record<string, unknown>;
  // keyField（id / mediaType）、textField（query / groupKey / mediaType）皆 DB 保證 string → `as string` 直取
  // （不經 String()，no-base-to-string 安全；契約：AI 讀取層列由 repo 投影，該兩欄恆為 string）。
  const keyOf = (row: T): string => rec(row)[keyField] as string;
  const textOf = (row: T): string => rec(row)[textField] as string;
  const filtered = filterByText(rows, request.filters ?? {}, textOf);
  const sort0 = request.sort?.[0];
  const sorted = sort0 ? sortRows(filtered, sort0.field, sort0.direction, keyOf) : filtered;
  const page = paginate(sorted, request.pagination, keyOf);
  const select = request.select && request.select.length > 0 ? request.select : [...allowedSelect];
  return {
    view: viewName,
    // select 已由 QueryViewService 驗 ⊆ allowedSelect（皆對應 columns），故 byKey.get 必命中。
    columns: select.map((key) => byKey.get(key)).filter((c): c is ColumnDef => c !== undefined),
    rows: page.rows.map((row) => Object.fromEntries(select.map((key) => [key, rec(row)[key]]))),
    pagination: page.meta,
  };
}

/** `ai_answers` view（per-answer；channel/query/answerText/brands（露出次數）/positive/negative，S17 不去重）。 */
export function buildAiAnswersTable(
  viewName: string,
  columns: readonly ColumnDef[],
  allowedSelect: readonly string[],
  rows: readonly AiAnswerReadRow[],
  request: {
    filters?: FilterSpec;
    sort?: QuerySort[];
    pagination?: QueryPagination;
    select?: string[];
  },
): TableViewResult {
  return buildTable(viewName, columns, allowedSelect, rows, request, 'id', 'query');
}

/** `ai_cited_pages` view（逐頁引用列表；channel/query/link/domain/title/mediaType）。 */
export function buildCitedPagesTable(
  viewName: string,
  columns: readonly ColumnDef[],
  allowedSelect: readonly string[],
  rows: readonly AiCitedReadRow[],
  request: {
    filters?: FilterSpec;
    sort?: QuerySort[];
    pagination?: QueryPagination;
    select?: string[];
  },
): TableViewResult {
  return buildTable(viewName, columns, allowedSelect, rows, request, 'id', 'query');
}

/** `ai_cited_media` view（依 `media_type` 聚合佔比：`{mediaType,count,share}`；share=count/total）。 */
export function buildCitedMediaTable(
  viewName: string,
  columns: readonly ColumnDef[],
  allowedSelect: readonly string[],
  rows: readonly AiCitedReadRow[],
  request: {
    filters?: FilterSpec;
    sort?: QuerySort[];
    pagination?: QueryPagination;
    select?: string[];
  },
): TableViewResult {
  const total = rows.length;
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.mediaType, (counts.get(row.mediaType) ?? 0) + 1);
  }
  // `counts` 由非空 rows 導出 → 進 map 時 `total > 0` 恆真（空 rows→counts 空→map 不執行、無除零）。
  const aggregated = [...counts.entries()].map(([mediaType, count]) => ({
    mediaType,
    count,
    share: count / total,
  }));
  return buildTable(
    viewName,
    columns,
    allowedSelect,
    aggregated,
    request,
    'mediaType',
    'mediaType',
  );
}

/** `brand|intent|journey_ai_visibility` view（可見度指標列，dimension 已於載入層篩選）。 */
export function buildVisibilityTable(
  viewName: string,
  columns: readonly ColumnDef[],
  allowedSelect: readonly string[],
  rows: readonly AiMetricReadRow[],
  request: {
    filters?: FilterSpec;
    sort?: QuerySort[];
    pagination?: QueryPagination;
    select?: string[];
  },
): TableViewResult {
  return buildTable(viewName, columns, allowedSelect, rows, request, 'id', 'groupKey');
}

/**
 * `*_ai_visibility_summary` view（KPI score cards，FR-44）：dimension 篩選列 → 聚合 KPI。
 * - `mentions`/`citations`＝Σ（跨 group×brand 露出/引用加總，S17 不去重語意沿用落庫值）；
 * - `exposure`＝**per-group** exposure 的 null-safe 加總（同 group 各 brand 列同值 → 去重後加總；全 null/空→null，S14）；
 * - `groups`＝該維度涵蓋的 distinct group 數（keyword/意圖/歷程 覆蓋面）。
 */
export function buildVisibilitySummary(
  viewName: string,
  rows: readonly AiMetricReadRow[],
  request: { filters?: FilterSpec },
): SummaryViewResult {
  const filtered = filterByText(rows, request.filters ?? {}, (row) => row.groupKey);
  let mentions = 0;
  let citations = 0;
  const exposureByGroup = new Map<string, number | null>();
  for (const row of filtered) {
    mentions += row.mentions;
    citations += row.citations;
    if (!exposureByGroup.has(row.groupKey)) {
      exposureByGroup.set(row.groupKey, row.exposure);
    }
  }
  const exposure = sumExposure([...exposureByGroup.values()]);
  return {
    view: viewName,
    metrics: { groups: exposureByGroup.size, mentions, citations, exposure },
  };
}
