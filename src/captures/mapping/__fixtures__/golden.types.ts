// golden fixture 型別（T13.5 / FR-37 AC-37.2 / NFR-17；contract test `mapper-golden.contract.spec.ts` 用）。
//
// 每份 golden = 一個 `(source, discriminator, schemaVersion)` 的 `{ input(rawInput), expected(canonical+mapStatus+reasons) }`。
// contract test 對每份 golden 跑 `normalize(input)` → deep-equal `expected`；上游/extension raw 形狀改變 → 紅燈（漂移早期預警）。
//
// ⚠ 權威來源限制：理想權威＝extension `src/contentScripts/sites/<site>/type.ts` 形狀，但 extension repo 不在本 workspace。
// 各 golden 以 **Design §18.2/§18.3/§18.5 已載形狀**為據（該節本即取自 extension type.ts），每檔 header 註記
// `grounded in Design §18.x; pending extension type.ts reconciliation at T13.6`——待 T13.6 對照真實 type.ts 對帳。
import type { CanonicalCapture, MapResult, MapperInput } from '../canonical.types';

/**
 * fixture 覆蓋度標記：
 * - `full-map`＝T13.4 骨架 mapper 能完整收斂該 rawInput 每個欄位 → `mapStatus=ok`、`reasons=[]`。
 * - `skeleton-partial`＝核心欄位在（canonical 產出），但 rawInput 帶有 per-channel/per-platform 專屬欄位尚未進骨架
 *   白名單 → `mapStatus=partial` + `unknown_field:*`（AC-37.4 漂移預警，**非 bug**）；white-list 擴充屬 M14 T14.4 / M16 T16.5，
 *   屆時該 golden 應由 partial→ok（contract test 會因此轉紅，逼出一次有意識的 fixture 對帳）。
 */
export type GoldenCoverage = 'full-map' | 'skeleton-partial';

export interface MapperGolden {
  /** 穩定識別：`${source}|${discriminator}|${schemaVersion}`（(source, discriminator, schemaVersion) 唯一鍵）。 */
  readonly id: string;
  readonly coverage: GoldenCoverage;
  /** fixture 版本（rawInput/expected 形狀變更時 bump，供漂移 diff 追溯）。 */
  readonly fixtureVersion: number;
  /** rawInput + 分派脈絡（source/channel|platform/schemaVersion/capturedAt）。 */
  readonly input: MapperInput;
  /** 期望中立化結果（`raw` 由 contract test 另以 identity 斷言＝input.payload，故不入此）。 */
  readonly expected: Pick<MapResult<CanonicalCapture>, 'mapStatus' | 'reasons' | 'canonical'>;
}
