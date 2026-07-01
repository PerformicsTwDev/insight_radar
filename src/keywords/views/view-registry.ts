import type { ViewDefinition } from './view-definition';

/**
 * 具名視圖登錄（T5.5，FR-14/NFR-10）。QueryViewService 以 `get(name)` 取 ViewDefinition；未知 view → 400。
 * 新增 dashboard 表 = 建構時多傳一個 ViewDefinition（免新 endpoint / 免 migration）。
 */
export class ViewRegistry {
  private readonly views: Map<string, ViewDefinition>;

  constructor(definitions: ViewDefinition[]) {
    this.views = new Map(definitions.map((def) => [def.name, def]));
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
}
