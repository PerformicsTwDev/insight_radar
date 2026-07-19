import { CAPTURE_CHANNELS, CAPTURE_PLATFORMS } from '../dto/capture-ingest.dto';
import { mapAiCapture } from './ai-mapper';
import type { CanonicalCapture, MapperInput, MapResult } from './canonical.types';
import { failResult } from './map-result';
import { mapSocialPost } from './social-mapper';

/**
 * per-source/per-platform mapper **registry**（FR-37；Design §18.2）——依 `(source, platform|channel,
 * schemaVersion)` 選對應純函式 mapper（S20：每平台/每渠道一個 mapper）。
 *
 * ⚠ 註：Task.md 以 `source|schemaVersion` 簡寫；權威 SSOT（Design §18.2 + S20「每平台/每渠道一 mapper」）要求
 * discriminator（channel|platform）進 key，否則無法一平台一 mapper——本框架以完整 `(source, discriminator, schemaVersion)`
 * 為 key。
 *
 * **可擴充**：exact `(source, discriminator, version)` 優先、`*`（wildcard）fallback。骨架期以 wildcard 註冊線層
 * 預設 mapper（任一 allowlist schemaVersion → 骨架）；T13.5 / T14.4 / T16.5 以 exact-version 覆蓋（換 mapper 不動分析層）。
 */
export type Mapper = (input: MapperInput) => MapResult;

/** wildcard schemaVersion：line-level 預設（任一版本 fallback），exact-version 優先。 */
export const ANY_SCHEMA_VERSION = '*';

/** 註冊規格：source + discriminator（channel|platform）+ 可選 schemaVersion（預設 wildcard）。 */
export interface MapperRegistration {
  source: string;
  discriminator: string;
  schemaVersion?: string;
}

function keyOf(source: string, discriminator: string, schemaVersion: string): string {
  return `${source}|${discriminator}|${schemaVersion}`;
}

/** mapper registry（exact 優先、`*` fallback；可持續 `register` 擴充新渠道/平台/版本）。 */
export class MapperRegistry {
  private readonly mappers = new Map<string, Mapper>();

  register(registration: MapperRegistration, mapper: Mapper): this {
    const version = registration.schemaVersion ?? ANY_SCHEMA_VERSION;
    this.mappers.set(keyOf(registration.source, registration.discriminator, version), mapper);
    return this;
  }

  resolve(source: string, discriminator: string, schemaVersion: string): Mapper | undefined {
    return (
      this.mappers.get(keyOf(source, discriminator, schemaVersion)) ??
      this.mappers.get(keyOf(source, discriminator, ANY_SCHEMA_VERSION))
    );
  }
}

/**
 * 建立含骨架 mapper 的預設 registry：AI 渠道（extension primary / serpapi reserved）→ `mapAiCapture`；
 * Social 平台（extension primary / threadsApi reserved）→ `mapSocialPost`。皆以 wildcard schemaVersion 註冊。
 */
export function createDefaultRegistry(): MapperRegistry {
  const registry = new MapperRegistry();
  for (const source of ['extension', 'serpapi'] as const) {
    for (const channel of CAPTURE_CHANNELS) {
      registry.register({ source, discriminator: channel }, mapAiCapture);
    }
  }
  for (const source of ['extension', 'threadsApi'] as const) {
    for (const platform of CAPTURE_PLATFORMS) {
      registry.register({ source, discriminator: platform }, mapSocialPost);
    }
  }
  return registry;
}

/** 模組級預設 registry（`normalize` 預設用）。 */
export const defaultRegistry: MapperRegistry = createDefaultRegistry();

/**
 * 中立化單筆 raw capture（AC-37.1/37.4）：channel（AI）XOR platform（Social）決定 discriminator 與分派的線；
 * 未知/缺 discriminator 或未註冊 mapper → `failed`（raw 保留、**不拋**、不阻斷同批他筆——呼叫端逐筆 `map`）。
 */
export function normalize(
  input: MapperInput,
  registry: MapperRegistry = defaultRegistry,
): MapResult<CanonicalCapture> {
  const raw = input.payload;
  if (input.channel && input.platform) {
    return failResult(raw, 'ambiguous_discriminator');
  }
  const discriminator = input.channel ?? input.platform;
  if (!discriminator) {
    return failResult(raw, 'missing_discriminator');
  }
  const mapper = registry.resolve(input.source, discriminator, input.schemaVersion);
  if (!mapper) {
    return failResult(raw, 'no_mapper_registered');
  }
  return mapper(input);
}
