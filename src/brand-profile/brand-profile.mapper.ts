import type { Prisma } from '@prisma/client';
import type { BrandEntryDto } from './dto/brand-entry.dto';

/**
 * BrandProfile 的 DB 列 ↔ 對外形狀純映射（T14.5，FR-40）——**純函式**（無 IO），與 CRUD DI 編排分離、可獨立
 * 單元測試（含 JSON 欄防禦性收斂路徑）。寫入：巢狀 `brand`/`competitors` DTO → 扁平欄 + JSON；讀取：JSON 欄
 * （`Prisma.JsonValue`）→ typed `BrandEntry`（防禦性：非陣列/非字串/缺欄一律收斂，杜絕外部寫入的髒 JSON 外洩）。
 */

/** 品牌 / 競品的對外形狀（name + aliases[] + sites[]）——與 AC-40.1 入參 `brand` 子物件對稱。 */
export interface BrandEntry {
  name: string;
  aliases: string[];
  sites: string[];
}

/** 品牌檔案對外形狀（create/get/list/update 回傳）：`brand` 巢狀 + `competitors[]`；**不外洩 ownerId**。 */
export interface BrandProfileView {
  id: string;
  brand: BrandEntry;
  competitors: BrandEntry[];
  createdAt: Date;
}

/** 映射所需的 DB 列最小面（JSON 欄以 `Prisma.JsonValue` 讀回）。 */
export interface BrandProfileRow {
  id: string;
  name: string;
  aliases: Prisma.JsonValue;
  sites: Prisma.JsonValue;
  competitors: Prisma.JsonValue;
  createdAt: Date;
}

/** 選填字串陣列 → 具體陣列（缺省 []）；供 aliases/sites 寫入 JSON 欄。 */
export function toAliasWriteList(values: string[] | undefined): string[] {
  return values ?? [];
}

/** 選填競品 DTO 陣列 → 收斂形狀 `[{name,aliases[],sites[]}]`（aliases/sites 缺省 []）；寫入 JSON 欄。 */
export function toCompetitorWriteList(
  competitors: BrandEntryDto[] | undefined,
): Prisma.InputJsonValue {
  return (competitors ?? []).map((c) => ({
    name: c.name,
    aliases: toAliasWriteList(c.aliases),
    sites: toAliasWriteList(c.sites),
  }));
}

/** DB 列 → 對外形狀（id→id、扁平欄→巢狀 `brand`、JSON 欄→typed）。 */
export function toBrandProfileView(row: BrandProfileRow): BrandProfileView {
  return {
    id: row.id,
    brand: {
      name: row.name,
      aliases: readStringList(row.aliases),
      sites: readStringList(row.sites),
    },
    competitors: readCompetitorList(row.competitors),
    createdAt: row.createdAt,
  };
}

/** JSON 欄 → `string[]`（防禦性：非陣列 → []；非字串元素剔除）。 */
export function readStringList(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** JSON 欄 → `BrandEntry[]`（防禦性：非陣列 → []；每列收斂 name/aliases/sites）。 */
export function readCompetitorList(value: Prisma.JsonValue): BrandEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const obj = isJsonObject(item) ? item : {};
    return {
      name: typeof obj.name === 'string' ? obj.name : '',
      aliases: readStringList(obj.aliases ?? []),
      sites: readStringList(obj.sites ?? []),
    };
  });
}

/** JSON 值是否為 object（非 array、非 null）。 */
function isJsonObject(value: Prisma.JsonValue): value is { [key: string]: Prisma.JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
