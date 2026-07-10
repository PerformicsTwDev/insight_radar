import { DEFAULT_VIEW_FEATURE, type ViewDefinition, type ViewMetadata } from './view-definition';

/**
 * 具名視圖登錄（T5.5，FR-14/NFR-10）。QueryViewService 以 `get(name)` 取 ViewDefinition；未知 view → 400。
 * 新增 dashboard 表 = 建構時多傳一個 ViewDefinition（免新 endpoint / 免 migration）。
 */
export class ViewRegistry {
  private readonly views: Map<string, ViewDefinition>;

  constructor(definitions: ViewDefinition[]) {
    this.views = new Map(definitions.map((def) => [def.name, def]));
    // fail-fast：同名 view 會在 Map 靜默覆蓋（後者勝），屬設定錯誤 → 直接拋。
    if (this.views.size !== definitions.length) {
      throw new Error('ViewRegistry: duplicate view name');
    }
  }

  /** 取具名視圖；未註冊回 `undefined`（由 caller 轉 400）。 */
  get(name: string): ViewDefinition | undefined {
    return this.views.get(name);
  }

  has(name: string): boolean {
    return this.views.has(name);
  }

  /** 已註冊的 view 名稱（供錯誤訊息/探索）。 */
  names(): string[] {
    return [...this.views.keys()];
  }

  /**
   * 導出所有 view 的自省 metadata（`GET /views`，FR-22/NFR-10）——直接由 `ViewDefinition` 映射，
   * 與 `/query` 的白名單**同一來源**（不另抄）。新增 ViewDefinition 自動出現於此（閉環）。
   */
  metadata(): ViewMetadata[] {
    return [...this.views.values()].map((view) => ({
      name: view.name,
      grain: view.grain,
      // AC-22.2：allowedSelect 帶型別（[{key,type}]）；型別取自 selectColumns（與 build 的欄位同源），
      // 缺對應欄位（理論不應發生）退回 'text'。
      allowedSelect: view.allowedSelect.map((key) => ({
        key,
        type: view.selectColumns?.find((c) => c.key === key)?.type ?? 'text',
      })),
      allowedFilters: [...view.allowedFilters],
      allowedSort: [...view.allowedSort],
      responseShape: view.kind,
      requiresFeature: view.requiresFeature ?? DEFAULT_VIEW_FEATURE,
    }));
  }
}
