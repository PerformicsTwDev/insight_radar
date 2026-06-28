import { enums } from 'google-ads-api';

/** 競爭度等級（原樣保留套件 enum 名稱）。 */
export type CompetitionLevel = 'UNSPECIFIED' | 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';

// 套件 enum 的雙向對照表（整數 ↔ 名稱）；以 Record 取用反查（整數 → 名稱），不硬編整數。
const COMPETITION_BY_VALUE = enums.KeywordPlanCompetitionLevel as unknown as Record<number, string>;
const VALID_NAMES = new Set<string>(['UNSPECIFIED', 'UNKNOWN', 'LOW', 'MEDIUM', 'HIGH']);

/**
 * 映射競爭度 enum（FR-3、TC-4）。**以套件 `enums` 反查名稱，不硬編整數**
 * （proto 整數值若變動，本函式仍正確；JANUARY-style off-by-one 類陷阱不適用，但同理不依賴字面整數）。
 *
 * - 整數（proto 值）→ 用 `enums.KeywordPlanCompetitionLevel` 反查名稱。
 * - 字串名稱 → 原樣保留（須為合法 enum 名）。
 * - null/undefined/無法辨識 → `UNSPECIFIED`（保守、不丟例外）。
 */
export function mapCompetition(raw: string | number | null | undefined): CompetitionLevel {
  if (typeof raw === 'number') {
    const name = COMPETITION_BY_VALUE[raw];
    return (name && VALID_NAMES.has(name) ? name : 'UNSPECIFIED') as CompetitionLevel;
  }
  if (typeof raw === 'string' && VALID_NAMES.has(raw)) {
    return raw as CompetitionLevel;
  }
  return 'UNSPECIFIED';
}

/** 映射競爭指數（0–100）；缺值 → null（不補 0）。 */
export function mapCompetitionIndex(raw: number | null | undefined): number | null {
  return raw ?? null;
}
