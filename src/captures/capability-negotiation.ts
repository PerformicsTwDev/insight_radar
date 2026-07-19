/**
 * extension bridge per-channel/per-platform 能力協商（T13.6，S21 / NFR-21 / AC-51.4 / TC-94；Design §18.1/§18.7）。
 *
 * **背景**：extension（`web-insight-capture-wxt`）B 橋接為 extension-primary 架構下**所有線的主要抓取管道**
 * （ADR-0007），但其契約現況**無 schema versioning、`EXTERNAL_PONG.features[]` 僅 3 個 research-confirmed 渠道**
 * （`threadsSearch/googleSerp/chatGpt`）。多平台 / AI 多渠道 / 任意域名 readability 為 extension 端**外部協調擴充項**
 * （T13.6，使用者在 extension repo 執行）。在擴充落地前，本協商純函式讓 ingestion 邊界**優雅降級**：把「我們期望
 * extension 應提供」的 `required` 清單對照「extension 實際回報」的 `reported`（`EXTERNAL_PONG.features[]`），**未回報的
 * 渠道標 not-available（gating，不硬崩、不編造資料）**——而非假設所有渠道皆可用、對缺渠道靜默套預設 / 編造空資料。
 *
 * **純函式**（無副作用、不 mutate 輸入、決定論）：同 `mapping/coalesce.ts` 慣例，供前端轉發鏈 gating + 後端契約測試。
 */

/** 單一 feature 的協商結果（S21）：`available`＝extension 有回報；`not-available`＝未回報（gating、不編造）。 */
export type CapabilityStatus = 'available' | 'not-available';

/**
 * 能力協商結果（TC-94 / AC-51.4）。`statuses` 覆蓋 `required ∪ reported` 之聯集——每個見過的 feature 皆有明確狀態，
 * 供前端轉發鏈以 {@link isFeatureAvailable} 逐訊息 gating（未回報→not-available→不轉發、不編造）。
 */
export interface CapabilityNegotiation {
  /** 每個 feature（required ∪ reported）→ available|not-available；未見過的 feature 不列入（查詢時 undefined→視為 not-available）。 */
  statuses: Record<string, CapabilityStatus>;
  /** `required` 中已被 extension 回報者（gating 放行），依 `required` 正規化後之順序。 */
  available: string[];
  /** `required` 中未被回報者（gating not-available；擴充項落地前之預期狀態，外部協調 T13.6），依 `required` 順序。 */
  notAvailable: string[];
  /** extension 回報但不在 `required` 之額外能力（僅資訊、不影響 gating），依 `reported` 順序。 */
  extra: string[];
  /** 是否所有 `required` 皆 available（`notAvailable` 為空）。 */
  allAvailable: boolean;
}

/**
 * feature 清單正規化：coerce 非字串→丟棄、`trim`、濾空、去重（保留首見順序）。extension 契約無 schema versioning、
 * `EXTERNAL_PONG.features[]` 可能缺（研究實證：PONG 常只回 `extensionVersion`、不回 `features[]`）或含雜質——故防禦性
 * 正規化，缺 / 雜質 → 視為未回報（該渠道 gating not-available），**不硬崩**。
 */
export function normalizeFeatures(features: readonly unknown[] | undefined | null): string[] {
  if (features == null) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of features) {
    if (typeof raw !== 'string') {
      continue; // coerce：非字串（number/null/object）→ 丟棄（不硬崩、不編造）
    }
    const trimmed = raw.trim();
    if (trimmed === '' || seen.has(trimmed)) {
      continue; // 濾空 + 去重（保留首見順序）
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * 能力協商（S21 / NFR-21）：對照 extension 回報（`reported`＝`EXTERNAL_PONG.features[]`）與我方期望基準
 * （`required`＝`EXTENSION_BRIDGE_REQUIRED_FEATURES`）。每個 `required` feature：extension 有回報→`available`；
 * **未回報→`not-available`（gating，不硬崩、不編造）**。`reported` 中超出 `required` 者列 `extra`（額外能力、不影響 gating）。
 */
export function negotiateCapabilities(
  reported: readonly unknown[] | undefined | null,
  required: readonly unknown[] | undefined | null,
): CapabilityNegotiation {
  const reportedFeatures = normalizeFeatures(reported);
  const requiredFeatures = normalizeFeatures(required);
  const reportedSet = new Set(reportedFeatures);
  const requiredSet = new Set(requiredFeatures);

  const statuses: Record<string, CapabilityStatus> = {};
  const available: string[] = [];
  const notAvailable: string[] = [];

  // required（期望基準）：extension 有回報→available；未回報→not-available（gating，不編造）。依 required 順序。
  for (const feature of requiredFeatures) {
    if (reportedSet.has(feature)) {
      statuses[feature] = 'available';
      available.push(feature);
    } else {
      statuses[feature] = 'not-available';
      notAvailable.push(feature);
    }
  }

  // extension 回報但不在 required 之額外能力（extra）：亦標 available（供轉發放行 extra 渠道），不影響 gating。依 reported 順序。
  const extra: string[] = [];
  for (const feature of reportedFeatures) {
    if (!requiredSet.has(feature)) {
      statuses[feature] = 'available';
      extra.push(feature);
    }
  }

  return {
    statuses,
    available,
    notAvailable,
    extra,
    allAvailable: notAvailable.length === 0,
  };
}

/**
 * 便利判定（前端轉發鏈 gating）：某 feature 於協商結果中是否 available。extension 回報者（無論 required 或 extra）→ true；
 * `required` 但未回報者、或協商中未見過者 → false（gating：不轉發該渠道訊息、不編造）。
 */
export function isFeatureAvailable(negotiation: CapabilityNegotiation, feature: string): boolean {
  return negotiation.statuses[feature] === 'available';
}
