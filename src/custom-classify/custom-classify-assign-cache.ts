import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import { sha256Hex } from '../common/sha256';
import { cacheConfig } from '../config/cache.config';
import { normalizeText } from '../google-ads/normalize';
import { scrubSecrets } from '../logger/redaction';
import { cleanLabel, type AssignedKeyword } from './custom-classify-assign-postprocess';

/**
 * 自訂分類階段二歸類快取（T12.8，FR-34/AC-34.2）。**Redis-only、per-(cid, labelsHash, nt)**：key =
 * `custom_classify:v{CUSTOM_CLASSIFY_SCHEMA_VERSION}:{cid}:{labelsHash}:sha256(normalizedText)`（Design §17.4）。
 * `labelsHash`（= `computeLabelsHash(labels)`，涵蓋 label + description）**入 key**——HITL 任何改動（含只改
 * description）→ 不同 labelsHash → 不同 key → 自然隔離，不回舊指引下算出的 verdict（**coherency guard**：涵蓋
 * 移除標籤 *與* 同名改述兩種情況；否則 60 天 TTL 內 description-only 修正會靜默失效）。
 *
 * - **mget**：批查；讀取 best-effort（錯誤=miss，落 LLM，不拖垮 job）。讀出仍以確認標籤集驗成員
 *   （{@link cleanLabel}，defensive）。
 * - **mset**：只回寫**確認集內**的 label（濾掉 LLM 幻覺的非確認 label + `unclassified` sentinel，不快取——比照
 *   journey 不快取非法 stage、避免近乎永久的錯誤命中）。
 * - **schemaVer + cid + labelsHash** 入 namespace → bump 版本整批失效；換分類定義/改標籤自然不同 key、不污染。TTL
 *   一律毫秒（`CACHE_TTL_CUSTOM_CLASSIFY_MS`）。sha256(normalizedText)：去重 key = 快取 key 共用同一 normalizedText。
 */
@Injectable()
export class CustomClassifyAssignCache {
  private readonly logger = new Logger(CustomClassifyAssignCache.name);

  constructor(
    private readonly cache: CacheService,
    @Inject(cacheConfig.KEY) private readonly config: ConfigType<typeof cacheConfig>,
  ) {}

  /** key：`custom_classify:v{ver}:{cid}:{labelsHash}:sha256(normalizeText(nt))`（labelsHash 隔離 HITL 改動）。 */
  private keyFor(classificationId: string, labelsHash: string, normalizedText: string): string {
    return this.cache.buildKey(
      CacheNamespace.CUSTOM_CLASSIFY,
      this.config.customClassifySchemaVersion,
      classificationId,
      labelsHash,
      sha256Hex(normalizedText),
    );
  }

  /** 讀取 best-effort（cache-aside）：讀取錯誤 = miss（回 `fallback`），降級落 LLM，**不**拖垮已付費 job。 */
  private async bestEffortRead<T>(work: Promise<T>, fallback: T, context: string): Promise<T> {
    try {
      return await work;
    } catch (error) {
      this.logger.warn(`${context} failed (best-effort): ${scrubSecrets(String(error))}`);
      return fallback;
    }
  }

  /** 回寫純屬快取暖機：寫入失敗只降級為「下次重打 LLM」，不可拖垮已付費 job——吞錯記 warn（祕密清洗）。 */
  private async bestEffort(work: Promise<unknown>, context: string): Promise<void> {
    try {
      await work;
    } catch (error) {
      this.logger.warn(`${context} failed (best-effort): ${scrubSecrets(String(error))}`);
    }
  }

  /**
   * 批次查 label（依 `normalizedTexts` 對齊；miss = `undefined`）。以**當前確認標籤集** `allowedLabels` 驗成員：
   * 讀出但落在已移除標籤 → 視同 miss（key 不含 labels-hash 的 coherency guard）。
   */
  async mget(
    classificationId: string,
    labelsHash: string,
    normalizedTexts: string[],
    allowedLabels: ReadonlySet<string>,
  ): Promise<(string | undefined)[]> {
    if (normalizedTexts.length === 0) {
      return [];
    }
    const normalized = normalizedTexts.map(normalizeText);
    const raw = await this.bestEffortRead<(string | undefined)[]>(
      this.cache.mget<string>(
        normalized.map((nt) => this.keyFor(classificationId, labelsHash, nt)),
      ),
      normalized.map(() => undefined),
      'custom-classify cache read',
    );
    // 讀出仍驗成員（防 stale/已移除標籤污染下游）：非確認集 → 視同 miss（undefined）。
    return raw.map((v) =>
      v == null ? undefined : (cleanLabel(v, allowedLabels as Set<string>) ?? undefined),
    );
  }

  /** 回寫（writeback）：只寫**確認集內**的 label（`unclassified` + 已移除標籤自然濾掉、不快取）。 */
  async mset(
    classificationId: string,
    labelsHash: string,
    entries: AssignedKeyword[],
    allowedLabels: ReadonlySet<string>,
  ): Promise<void> {
    const valid = entries
      .map((e) => ({
        nt: normalizeText(e.keyword),
        label: cleanLabel(e.label, allowedLabels as Set<string>),
      }))
      .filter((e): e is { nt: string; label: string } => e.label !== null);
    await this.bestEffort(
      Promise.all(
        valid.map((e) =>
          this.cache.set(
            this.keyFor(classificationId, labelsHash, e.nt),
            e.label,
            this.config.customClassifyTtlMs,
          ),
        ),
      ),
      'custom-classify cache writeback',
    );
  }
}
