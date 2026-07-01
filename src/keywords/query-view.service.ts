import { BadRequestException, Injectable } from '@nestjs/common';
import type { FeaturesMap } from '../keyword-analysis/features';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import { AggregateBoundsError } from './aggregate';
import { FeatureNotReadyException } from './feature-not-ready.exception';
import type { FilterSpec } from './filter-spec';
import type { QueryLimits, QueryRequest, ViewDefinition, ViewResult } from './views';
import { ViewRegistry } from './views';

/** min ≤ max 檢查的欄位對（Design §9.1）。 */
const RANGE_PAIRS: readonly (readonly [keyof FilterSpec, keyof FilterSpec])[] = [
  ['volumeMin', 'volumeMax'],
  ['competitionIndexMin', 'competitionIndexMax'],
  ['cpcMin', 'cpcMax'],
];

/**
 * View-router 服務（T5.5，FR-14，Design §6.5）：`get(view) → validate(白名單) → view.build`。前端不送 SQL。
 * 違反白名單 / `pageSize`>上限 / `min>max` / 引擎 bounds → **400**（結構化 `code/message/fields`，仿全域
 * ValidationPipe）。純服務層：`rows` 由 caller（controller / 整合層）載入不可變 snapshot 後注入。
 */
@Injectable()
export class QueryViewService {
  constructor(private readonly registry: ViewRegistry) {}

  /**
   * @param features 各 feature 狀態（由 SnapshotQueryService 依分析狀態算出）。提供時做 **feature-gating**
   *   （view 依賴的 feature 未 ready → `409 FEATURE_NOT_READY`，AC-14.7）；省略時不 gate（純 view 單元測試用）。
   */
  /**
   * 解析 view（未知 → 400）並做 **feature-gating**（`features` 提供且 view 依賴的 feature 未 ready →
   * `409 FEATURE_NOT_READY`，AC-14.7）。供 caller（SnapshotQueryService）在**載入 snapshot 列之前**先擋——
   * 避免為 gated view（serp/topics）白抓整份 snapshot 才拒絕（M6-R6）。回解析出的 view。
   */
  assertExecutable(viewName: string, features?: FeaturesMap): ViewDefinition {
    const view = this.registry.get(viewName);
    if (!view) {
      this.fail({
        view: [`unknown view '${viewName}'; allowed: ${this.registry.names().join(', ')}`],
      });
    }
    const feature = view.requiresFeature ?? 'keyword_metrics';
    if (features && features[feature].status !== 'ready') {
      throw new FeatureNotReadyException(feature, features[feature].status);
    }
    return view;
  }

  /**
   * @param features 各 feature 狀態（由 SnapshotQueryService 依分析狀態算出）。提供時做 **feature-gating**
   *   （view 依賴的 feature 未 ready → `409 FEATURE_NOT_READY`，AC-14.7）；省略時不 gate（純 view 單元測試用）。
   */
  query(
    rows: SnapshotRowData[],
    request: QueryRequest,
    limits: QueryLimits,
    features?: FeaturesMap,
  ): ViewResult {
    // 解析 view + feature-gating（unknown → 400、未 ready → 409），先於白名單/build。
    const view = this.assertExecutable(request.view, features);

    // 白名單：select / filters / sort 皆須為該 view 宣告的允許集子集。
    const badSelect = (request.select ?? []).filter((key) => !view.allowedSelect.includes(key));
    if (badSelect.length > 0) {
      this.fail({ select: [`not selectable in '${view.name}': ${badSelect.join(', ')}`] });
    }
    const badFilters = Object.keys(request.filters ?? {}).filter(
      (key) => !view.allowedFilters.includes(key),
    );
    if (badFilters.length > 0) {
      this.fail({ filters: [`not filterable in '${view.name}': ${badFilters.join(', ')}`] });
    }
    const badSort = (request.sort ?? [])
      .map((sort) => sort.field)
      .filter((field) => !view.allowedSort.includes(field));
    if (badSort.length > 0) {
      this.fail({ sort: [`not sortable in '${view.name}': ${badSort.join(', ')}`] });
    }
    // 讀取層為**單鍵排序** + normalizedText tie-break（§9.1）；拒絕多鍵，避免靜默丟棄次要鍵（M5-R2）。
    if ((request.sort?.length ?? 0) > 1) {
      this.fail({ sort: ['only a single sort key is supported'] });
    }

    // 分頁上限。
    const pageSize = request.pagination?.pageSize;
    if (pageSize !== undefined && pageSize > limits.maxPageSize) {
      this.fail({ pageSize: [`pageSize ${pageSize} exceeds max ${limits.maxPageSize}`] });
    }

    // range min ≤ max。
    const rangeErrors = this.rangeErrors(request.filters ?? {});
    if (Object.keys(rangeErrors).length > 0) {
      this.fail(rangeErrors);
    }

    // build；引擎越界（bounds，如桶數 > maxBuckets）→ 400。
    try {
      return view.build({ rows, request, limits });
    } catch (error) {
      if (error instanceof AggregateBoundsError) {
        this.fail({ aggregate: [error.message] });
      }
      throw error;
    }
  }

  private rangeErrors(filters: FilterSpec): Record<string, string[]> {
    const errors: Record<string, string[]> = {};
    for (const [minKey, maxKey] of RANGE_PAIRS) {
      const min = filters[minKey];
      const max = filters[maxKey];
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        errors[minKey] = [`${minKey} must not be greater than ${maxKey}`];
      }
    }
    return errors;
  }

  /** 拋結構化 400（對齊全域 ValidationPipe 的 `code/message/fields`）。 */
  private fail(fields: Record<string, string[]>): never {
    throw new BadRequestException({
      code: 'QUERY_VALIDATION_FAILED',
      message: 'Query validation failed',
      fields,
    });
  }
}
