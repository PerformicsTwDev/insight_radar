import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * 資源歸屬強制 —— **owner 過濾的唯一單點**（FR-27 / AC-27.3~27.5 / TC-62；Design §17.5 S8）。
 *
 * 所有讀取路徑（歷史清單 / 讀某分析 / 讀關鍵字 / query / cancel）**一律**經此模組把關，
 * 不得在各處散落 ad-hoc `where ownerId`（否則忘一處 = 越權讀）。規則：
 * - **session**（人類 actor）：只能存取 `ownerId === actor.id`（自己的）或 `ownerId === null`
 *   （M10 前既有 / 機器建立的**共享歷史列**，AC-27.3）；他人（`ownerId === B`）→ **404**（不洩漏存在性）。
 * - **apiKey**（機器 actor）：**不套** owner 過濾（回全部，維持 M9 前語意，AC-27.5）。
 *
 * owner scope **只**由已認證 actor（`request.user`）推導，**永不**由任何請求參數（`?ownerId=` 等）覆寫（AC-27.4）。
 */

/** 具 owner 歸屬的資源在存取判定時所需的最小面（只看 `ownerId`）。 */
export interface OwnedResource {
  ownerId: string | null;
}

/**
 * `list`/`count` 用的 owner 過濾 `where` 片段（結構化、與 model 無關，供 KeywordAnalysis 及日後 TrackingList/
 * BrandProfile 重用）：apiKey → `{}`（不過濾）；session → `{ OR: [{ownerId: id}, {ownerId: null}] }`（自己 + 共享）。
 */
export type OwnerScopeWhere = Record<string, never> | { OR: Array<{ ownerId: string | null }> };

/**
 * `actor` 是否可存取某 owner 歸屬資源（AC-27.3/27.5）。
 * - apiKey：一律 `true`（機器 actor 不過濾）。
 * - session：自己的（`ownerId === actor.id`）或共享 null-owner 列（`ownerId === null`）才 `true`。
 */
export function canAccess(resource: OwnedResource, actor: AuthenticatedUser): boolean {
  if (actor.kind === 'apiKey') {
    return true; // 機器 actor 不套 owner 過濾（AC-27.5）。
  }
  return resource.ownerId === null || resource.ownerId === actor.id; // 共享（null）或自己的（AC-27.3）。
}

/**
 * 單列讀取的 owner 強制（getStatus/keywords/query/cancel 共用單點）。越權 → **404**（NOT 403——不洩漏
 * 存在性，AC-27.3/27.4）：與「未知 id」不可區分。授權則靜默通過。
 */
export function assertOwnerAccess(
  resource: OwnedResource,
  actor: AuthenticatedUser,
  notFoundMessage: string,
): void {
  if (!canAccess(resource, actor)) {
    throw new NotFoundException(notFoundMessage);
  }
}

/**
 * 單列讀取的 **not-found + owner** 複合單點（getStatus/keywords/query/cancel 共用）：`row` 為 `null`（未知 id）
 * **或** actor 越權，皆丟**同一** 404（相同訊息，不洩漏存在性，AC-27.3/27.4）。通過後（TS assertion）將 `row`
 * 收斂為非 null，呼叫端免再自行 null-check——把「未知 id 與越權不可區分」的反枚舉不變式鎖在一處。
 */
export function assertOwnedRow<T extends OwnedResource>(
  row: T | null,
  actor: AuthenticatedUser,
  notFoundMessage: string,
): asserts row is T {
  if (!row) {
    throw new NotFoundException(notFoundMessage);
  }
  assertOwnerAccess(row, actor, notFoundMessage);
}

/**
 * list/count 的 owner scope `where` 片段（AC-27.5）：apiKey → `{}`；session → 自己 + 共享（null）。
 * owner 僅源自 `actor`——`?ownerId=` 之類請求參數無法拓寬此 scope（AC-27.4）。
 */
export function ownerWhere(actor: AuthenticatedUser): OwnerScopeWhere {
  if (actor.kind === 'apiKey') {
    return {};
  }
  // 自己的（ownerId = actor.id）+ 共享（ownerId IS NULL）；`{ ownerId: null }` 於 Prisma 產生 IS NULL。
  return { OR: [{ ownerId: actor.id }, { ownerId: null }] };
}

/**
 * 建立資源時要落 DB 的 `ownerId`（AC-27.1）：session → `actor.id`；apiKey → `null`（機器資源）。
 */
export function ownerIdOf(actor: AuthenticatedUser): string | null {
  return actor.kind === 'session' ? actor.id : null;
}

/**
 * **非同步 job / worker 情境**的 owner scope `where` 片段——由**已持久化的 `ownerId`**（run/job 落庫時
 * `ownerIdOf(建立者 actor)` 的結果）推導，因 worker 無 live `AuthenticatedUser`（無 request context）。
 * 與 {@link ownerWhere} 同語意、共用單點（S8——避免各處散落 ad-hoc `where ownerId`）：
 * - `ownerId === null`（機器/apiKey 建立的 run）→ `{}`（不過濾、見全部，AC-27.5）。
 * - `ownerId === <userId>`（session 建立的 run）→ `{ OR: [{ownerId}, {ownerId: null}] }`（自己 + 共享，AC-27.3）。
 *
 * 註：`ownerId` 已由 `ownerIdOf` 收斂（session→非 null id、apiKey→null 互斥），故 null 可逆推「機器 actor」。
 */
export function ownerWhereFromOwnerId(ownerId: string | null): OwnerScopeWhere {
  if (ownerId === null) {
    return {}; // 機器 actor 建立 → 不套 owner 過濾。
  }
  return { OR: [{ ownerId }, { ownerId: null }] }; // session 建立 → 自己 + 共享。
}
