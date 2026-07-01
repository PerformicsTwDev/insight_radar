/**
 * chart view 內部分組/分桶引擎（T5.5，FR-14/NFR-10，Design §9.3）。純函式：對**已篩選**的 snapshot 列
 * 依 `dimensions` 分組（含 explosion / 數值分桶）、累積 `measures`、sort/limit，O(n·dims)、亞毫秒。
 *
 * - **維度**：`value`（類別直取，如 competition）／`explode`（陣列欄逐值一組，如 intent→intentLabel，
 *   一列可貢獻多組 → `count` 可 > 列數，去重列數用 `countDistinct`）／`bucket`（數值左閉右開落桶、`null` 略過）。
 * - **measures**：`count`（組內 unit 數）／`countDistinct`（去重欄值，預設 normalizedText）／
 *   `sum·avg·min·max·median`（對指定欄位、`null` 略過）。
 * - **bounds（閉合，超出即 400）**：`dimensions ∈ [1,2]`、`bucket` width>0、value/median 類 measure 須帶 field、
 *   `limit ≤ maxGroups`、`bucket` 產生的桶數 ≤ maxBuckets；`groups` 超過 limit/maxGroups → 截斷 + `meta.truncated`。
 */

/** 引擎作用的列（snapshot 子集 + 任意欄位以支援各 view）。 */
export type AggregateRow = Record<string, unknown> & { normalizedText: string };

export type AggFn = 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max' | 'median';

export interface Measure {
  as: string;
  fn: AggFn;
  /** sum/avg/min/max/median 必填；countDistinct 預設 `normalizedText`；count 忽略。 */
  field?: string;
}

export type Dimension =
  | { as: string; field: string; kind: 'value' }
  | { as: string; field: string; kind: 'explode' }
  | { as: string; field: string; kind: 'bucket'; width: number };

export interface AggregateSpec {
  dimensions: Dimension[];
  measures: Measure[];
  sort?: { by: string; dir: 'asc' | 'desc' };
  limit?: number;
}

export interface AggregateLimits {
  maxBuckets: number;
  maxGroups: number;
}

export interface AggregateGroup {
  key: Record<string, string | number>;
  measures: Record<string, number>;
}

export interface AggregateResult {
  groups: AggregateGroup[];
  meta: { total: number; truncated: boolean };
}

/** 越界（違反封閉 grammar）→ 由 QueryViewService 對應為 400。 */
export class AggregateBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AggregateBoundsError';
  }
}

const FIELD_MEASURES: ReadonlySet<AggFn> = new Set(['sum', 'avg', 'min', 'max', 'median']);

/** 展開後的 unit：帶其 group key 值與來源列（measures 對來源列取值）。 */
interface Unit {
  key: Record<string, string | number>;
  row: AggregateRow;
}

/** 取某維度在一列的值列表（explosion → 多值；null/缺 → 空 → 該列不入此維度的組）。 */
function dimensionValues(row: AggregateRow, dim: Dimension): (string | number)[] {
  if (dim.kind === 'explode') {
    const raw = row[dim.field];
    return Array.isArray(raw)
      ? (raw as unknown[]).filter(
          (v): v is string | number => typeof v === 'string' || typeof v === 'number',
        )
      : [];
  }
  if (dim.kind === 'bucket') {
    const raw = row[dim.field];
    if (typeof raw !== 'number') {
      return []; // null / 缺值 → 不落桶
    }
    return [Math.floor(raw / dim.width) * dim.width]; // 左閉右開的桶下界
  }
  const raw = row[dim.field];
  return typeof raw === 'string' || typeof raw === 'number' ? [raw] : []; // null/物件 → 不入組
}

/** 取列上某欄的數值（缺值/非數值 → null，交由 measure 略過）。 */
function numericField(row: AggregateRow, field: string): number | null {
  const raw = row[field];
  return typeof raw === 'number' ? raw : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 對一組 unit 算單一 measure。 */
function computeMeasure(units: Unit[], measure: Measure): number {
  if (measure.fn === 'count') {
    return units.length;
  }
  if (measure.fn === 'countDistinct') {
    const field = measure.field ?? 'normalizedText';
    return new Set(units.map((u) => String(u.row[field]))).size;
  }
  const field = measure.field as string;
  const values = units
    .map((u) => numericField(u.row, field))
    .filter((v): v is number => v !== null);
  if (values.length === 0) {
    return 0;
  }
  switch (measure.fn) {
    case 'sum':
      return values.reduce((s, v) => s + v, 0);
    case 'avg':
      return values.reduce((s, v) => s + v, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    default:
      return median(values);
  }
}

/** 校驗封閉 grammar；違反 → {@link AggregateBoundsError}（→ 400）。 */
function assertBounds(spec: AggregateSpec, limits: AggregateLimits): void {
  if (spec.dimensions.length < 1 || spec.dimensions.length > 2) {
    throw new AggregateBoundsError('dimensions must be 1 or 2');
  }
  for (const dim of spec.dimensions) {
    if (dim.kind === 'bucket' && !(dim.width > 0)) {
      throw new AggregateBoundsError(`bucket dimension "${dim.as}" needs a positive width`);
    }
  }
  for (const measure of spec.measures) {
    if (FIELD_MEASURES.has(measure.fn) && measure.field === undefined) {
      throw new AggregateBoundsError(`measure "${measure.as}" (${measure.fn}) needs a field`);
    }
  }
  if (spec.limit !== undefined && spec.limit > limits.maxGroups) {
    throw new AggregateBoundsError(`limit ${spec.limit} exceeds maxGroups ${limits.maxGroups}`);
  }
}

export function aggregate(
  rows: AggregateRow[],
  spec: AggregateSpec,
  limits: AggregateLimits,
): AggregateResult {
  assertBounds(spec, limits);

  // 1. 展開 units：每列對各維度取值列表 → 笛卡兒積成複合 key。
  const units: Unit[] = [];
  for (const row of rows) {
    let partials: Record<string, string | number>[] = [{}];
    for (const dim of spec.dimensions) {
      const values = dimensionValues(row, dim);
      partials = partials.flatMap((partial) =>
        values.map((value) => ({ ...partial, [dim.as]: value })),
      );
    }
    for (const key of partials) {
      units.push({ key, row });
    }
  }

  // bucket 桶數上限（閉合）。
  for (const dim of spec.dimensions) {
    if (dim.kind === 'bucket') {
      const buckets = new Set(units.map((u) => u.key[dim.as]));
      if (buckets.size > limits.maxBuckets) {
        throw new AggregateBoundsError(
          `bucket dimension "${dim.as}" produced ${buckets.size} buckets (> ${limits.maxBuckets})`,
        );
      }
    }
  }

  // 2. 依複合 key 分組。
  const byKey = new Map<string, Unit[]>();
  for (const unit of units) {
    const keyStr = JSON.stringify(spec.dimensions.map((d) => unit.key[d.as]));
    const bucket = byKey.get(keyStr);
    if (bucket) {
      bucket.push(unit);
    } else {
      byKey.set(keyStr, [unit]);
    }
  }

  // 3. 每組算 measures。
  let groups: AggregateGroup[] = [...byKey.values()].map((groupUnits) => ({
    key: groupUnits[0].key,
    measures: Object.fromEntries(spec.measures.map((m) => [m.as, computeMeasure(groupUnits, m)])),
  }));

  // 4. sort（by measure 或 dimension key）。
  if (spec.sort) {
    const { by, dir } = spec.sort;
    const factor = dir === 'asc' ? 1 : -1;
    groups = [...groups].sort((a, b) => {
      const av = a.measures[by] ?? a.key[by];
      const bv = b.measures[by] ?? b.key[by];
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * factor;
      }
      return String(av) < String(bv) ? -factor : String(av) > String(bv) ? factor : 0;
    });
  }

  // 5. limit / maxGroups → 截斷 + truncated。
  const total = groups.length;
  const effectiveLimit = Math.min(spec.limit ?? limits.maxGroups, limits.maxGroups);
  const truncated = total > effectiveLimit;
  if (truncated) {
    groups = groups.slice(0, effectiveLimit);
  }

  return { groups, meta: { total, truncated } };
}
