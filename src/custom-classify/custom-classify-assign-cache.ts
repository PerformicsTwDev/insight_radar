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
 * 自訂分類階段二歸類快取（T12.8，FR-34/AC-34.2）。**Redis-only、per-(cid, nt)**：key =
 * `custom_classify:v{CUSTOM_CLASSIFY_SCHEMA_VERSION}:{cid}:sha256(normalizedText)`（Design §17.4，**keyed on
 * classificationId、非 deployment**）。label 由 (cid, normalizedText) 決定，故快取為「該分類定義下 keyword→label 記憶」。
 * 與 snapshot-scoped 的 `keyword_custom_assignments`（view/查詢物化結果）為**兩層**。
 *
 * - **mget**：批查；讀取 best-effort（錯誤=miss，落 LLM，不拖垮 job）。讀出以**當前確認標籤集**驗成員
 *   （{@link cleanLabel}）——落在已被 HITL 移除的舊標籤 → 視同 miss（coherency guard，因 key 不含 labels-hash）。
 * - **mset**：只回寫**確認集內**的 label（`unclassified` sentinel + 已移除標籤自然被濾掉，不快取——比照 journey
 *   不快取非法 stage、避免近乎永久的錯誤命中）。
 * - **schemaVer + cid** 入 namespace → bump 版本整批失效；換分類定義自然不同 cid、不污染。TTL 一律毫秒
 *   （`CACHE_TTL_CUSTOM_CLASSIFY_MS`）。sha256(normalizedText)：去重 key = 快取 key 共用同一 normalizedText。
 */
@Injectable()
export class CustomClassifyAssignCache {
  private readonly logger = new Logger(CustomClassifyAssignCache.name);

  constructor(
    private readonly cache: CacheService,
    @Inject(cacheConfig.KEY) private readonly config: ConfigType<typeof cacheConfig>,
  ) {}

  /** key：`custom_classify:v{ver}:{cid}:sha256(normalizeText(nt))`（去重 key = 快取 key 共用同一 normalizedText）。 */
  private keyFor(classificationId: string, normalizedText: string): string {
    return this.cache.buildKey(
      CacheNamespace.CUSTOM_CLASSIFY,
      this.config.customClassifySchemaVersion,
      classificationId,
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
    normalizedTexts: string[],
    allowedLabels: ReadonlySet<string>,
  ): Promise<(string | undefined)[]> {
    if (normalizedTexts.length === 0) {
      return [];
    }
    const normalized = normalizedTexts.map(normalizeText);
    const raw = await this.bestEffortRead<(string | undefined)[]>(
      this.cache.mget<string>(normalized.map((nt) => this.keyFor(classificationId, nt))),
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
            this.keyFor(classificationId, e.nt),
            e.label,
            this.config.customClassifyTtlMs,
          ),
        ),
      ),
      'custom-classify cache writeback',
    );
  }
}
