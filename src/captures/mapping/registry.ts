import type { CanonicalCapture, MapperInput, MapResult } from './canonical.types';

/**
 * per-source/per-platform mapper **registry**（FR-37；Design §18.2）——依 `(source, platform|channel,
 * schemaVersion)` 選對應純函式 mapper。
 *
 * TODO(T13.4): 實作（wildcard schemaVersion `*` = 骨架 line-level 預設；exact-version 由 T13.5+ 覆蓋）。
 */

/** registry 中的 mapper 純函式簽章。 */
export type Mapper = (input: MapperInput) => MapResult;

/** wildcard schemaVersion：註冊 line-level 預設 mapper（任一 allowlist 版本 fallback），exact-version 優先。 */
export const ANY_SCHEMA_VERSION = '*';

/** 註冊規格：source + discriminator（channel|platform）+ 可選 schemaVersion（預設 wildcard）。 */
export interface MapperRegistration {
  source: string;
  discriminator: string;
  schemaVersion?: string;
}

/** mapper registry（可擴充：exact `(source,disc,version)` 優先、`*` fallback）。 */
export class MapperRegistry {
  register(_registration: MapperRegistration, _mapper: Mapper): this {
    return this;
  }

  resolve(_source: string, _discriminator: string, _schemaVersion: string): Mapper | undefined {
    return undefined;
  }
}

/** 建立含骨架 mapper 的預設 registry（extension/serpapi AI 渠道 → AI mapper；extension/threadsApi 平台 → Social mapper）。 */
export function createDefaultRegistry(): MapperRegistry {
  return new MapperRegistry();
}

/** 模組級預設 registry（`normalize` 預設用）。 */
export const defaultRegistry: MapperRegistry = createDefaultRegistry();

/**
 * 中立化單筆 raw capture（AC-37.1/37.4）：依 discriminator 分派 mapper；未知 key → `failed`（raw 保留、
 * **不拋**、不阻斷同批他筆）。
 */
export function normalize(
  input: MapperInput,
  registry: MapperRegistry = defaultRegistry,
): MapResult<CanonicalCapture> {
  void input;
  void registry;
  return { mapStatus: 'failed', canonical: null, raw: input.payload, reasons: ['not_implemented'] };
}
