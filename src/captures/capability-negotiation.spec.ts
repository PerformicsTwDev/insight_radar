import {
  isFeatureAvailable,
  negotiateCapabilities,
  normalizeFeatures,
  type CapabilityNegotiation,
} from './capability-negotiation';

/**
 * TC-94（能力協商純函式，S21 / NFR-21 / AC-51.4；Design §18.1/§18.7）：extension bridge per-channel/per-platform
 * 能力協商。核心規則——**未回報渠道 → not-available（gating，不硬崩、不編造）**；全回報 → available。
 *
 * `EXTERNAL_PONG.features[]` 現況（research confirmed）僅 3 個渠道；期望擴充清單（AI 四渠道 + 社群多平台 +
 * readability）為 extension 端外部協調項（T13.6）。協商純函式讓 ingestion 邊界在擴充落地前優雅降級。
 */

// research-confirmed 現況：extension B 橋接目前只回報這三個 feature（idea/research 三份）。
const CONFIRMED_REPORTED = ['threadsSearch', 'googleSerp', 'chatGpt'] as const;

// 期望基準（Design §14 `EXTENSION_BRIDGE_REQUIRED_FEATURES` 預設）：現 3 + 擴充（geminiApp/googleAiMode/
// googleSearch/facebook/dcard/ptt/readability）——擴充項在 extension 端就緒前，協商應標 not-available（gating）。
const DESIRED_REQUIRED = [
  'threadsSearch',
  'googleSerp',
  'chatGpt',
  'geminiApp',
  'googleAiMode',
  'googleSearch',
  'facebook',
  'dcard',
  'ptt',
  'readability',
] as const;

describe('TC-94: negotiateCapabilities (S21 / NFR-21 / AC-51.4)', () => {
  describe('全回報 → 皆 available', () => {
    it('reported ⊇ required → 每個 required 皆 available、notAvailable 空、allAvailable', () => {
      const result = negotiateCapabilities([...CONFIRMED_REPORTED], [...CONFIRMED_REPORTED]);
      expect(result.available).toEqual(['threadsSearch', 'googleSerp', 'chatGpt']);
      expect(result.notAvailable).toEqual([]);
      expect(result.allAvailable).toBe(true);
      for (const feature of CONFIRMED_REPORTED) {
        expect(result.statuses[feature]).toBe('available');
      }
    });

    it('reported 超集（含 extra）→ required 全 available、extra 另列、不影響 gating', () => {
      const result = negotiateCapabilities(
        ['threadsSearch', 'googleSerp', 'chatGpt', 'geminiApp'],
        ['threadsSearch', 'chatGpt'],
      );
      expect(result.available).toEqual(['threadsSearch', 'chatGpt']);
      expect(result.notAvailable).toEqual([]);
      expect(result.allAvailable).toBe(true);
      expect(result.extra).toEqual(['googleSerp', 'geminiApp']);
      // extra 也是「可用能力」——statuses 標 available（供轉發 gating 放行 extra 渠道）。
      expect(result.statuses.geminiApp).toBe('available');
    });
  });

  describe('未回報渠道 → not-available（gating，不編造）', () => {
    it('現況 3 回報 vs 期望擴充清單 → 擴充渠道皆 not-available（gating）', () => {
      const result = negotiateCapabilities([...CONFIRMED_REPORTED], [...DESIRED_REQUIRED]);
      // 現況 3 → available。
      expect(result.available).toEqual(['threadsSearch', 'googleSerp', 'chatGpt']);
      // 擴充 7 → not-available（gating；extension 端就緒前之預期狀態）。
      expect(result.notAvailable).toEqual([
        'geminiApp',
        'googleAiMode',
        'googleSearch',
        'facebook',
        'dcard',
        'ptt',
        'readability',
      ]);
      expect(result.allAvailable).toBe(false);
      // 未回報渠道之 status 明確為 not-available（**非** undefined、**非**編造 available）。
      expect(result.statuses.readability).toBe('not-available');
      expect(result.statuses.facebook).toBe('not-available');
    });

    it('單一未回報渠道 → not-available；不硬崩、不對缺渠道編造任何額外欄位', () => {
      const result = negotiateCapabilities(['chatGpt'], ['chatGpt', 'readability']);
      expect(result.statuses).toEqual({ chatGpt: 'available', readability: 'not-available' });
      expect(result.available).toEqual(['chatGpt']);
      expect(result.notAvailable).toEqual(['readability']);
    });
  });

  describe('extension 未回報 features[]（PONG 只帶 extensionVersion）→ 全 gating、不硬崩', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['空陣列', []],
    ])('reported=%s → 所有 required 皆 not-available（不 throw）', (_label, reported) => {
      const result = negotiateCapabilities(reported, [...CONFIRMED_REPORTED]);
      expect(result.available).toEqual([]);
      expect(result.notAvailable).toEqual(['threadsSearch', 'googleSerp', 'chatGpt']);
      expect(result.allAvailable).toBe(false);
      for (const feature of CONFIRMED_REPORTED) {
        expect(result.statuses[feature]).toBe('not-available');
      }
    });

    it('required 為空 → allAvailable=true（無期望即無 gating）、reported 全入 extra', () => {
      const result = negotiateCapabilities([...CONFIRMED_REPORTED], []);
      expect(result.available).toEqual([]);
      expect(result.notAvailable).toEqual([]);
      expect(result.allAvailable).toBe(true);
      expect(result.extra).toEqual(['threadsSearch', 'googleSerp', 'chatGpt']);
    });
  });

  describe('正規化（extension 契約無 schema、可能含雜質）', () => {
    it('trim / 濾空 / 去重（保留首見順序）', () => {
      const result = negotiateCapabilities(
        ['  chatGpt  ', 'chatGpt', '', '   ', 'threadsSearch'],
        ['chatGpt', 'threadsSearch', 'chatGpt'],
      );
      expect(result.available).toEqual(['chatGpt', 'threadsSearch']);
      expect(result.notAvailable).toEqual([]);
    });

    it('coerce：非字串元素（number/null/object）丟棄，不硬崩、不編造', () => {
      const dirtyReported = ['chatGpt', 42, null, { feature: 'x' }, undefined] as unknown[];
      const result = negotiateCapabilities(dirtyReported, ['chatGpt', 'readability']);
      expect(result.statuses).toEqual({ chatGpt: 'available', readability: 'not-available' });
    });

    it('normalizeFeatures 直接驗：trim/濾空/去重/丟棄非字串', () => {
      expect(normalizeFeatures(['  a ', 'a', '', 'b', 7, null] as unknown[])).toEqual(['a', 'b']);
      expect(normalizeFeatures(undefined)).toEqual([]);
      expect(normalizeFeatures(null)).toEqual([]);
    });
  });

  describe('決定論 + 不 mutate 輸入', () => {
    it('相同輸入 → 相同輸出', () => {
      const a = negotiateCapabilities([...CONFIRMED_REPORTED], [...DESIRED_REQUIRED]);
      const b = negotiateCapabilities([...CONFIRMED_REPORTED], [...DESIRED_REQUIRED]);
      expect(a).toEqual(b);
    });

    it('不 mutate reported / required 陣列', () => {
      const reported = ['chatGpt', 'threadsSearch'];
      const required = ['chatGpt', 'readability'];
      const reportedCopy = [...reported];
      const requiredCopy = [...required];
      negotiateCapabilities(reported, required);
      expect(reported).toEqual(reportedCopy);
      expect(required).toEqual(requiredCopy);
    });
  });

  describe('isFeatureAvailable（轉發 gating 便利判定）', () => {
    let negotiation: CapabilityNegotiation;
    beforeAll(() => {
      negotiation = negotiateCapabilities([...CONFIRMED_REPORTED], [...DESIRED_REQUIRED]);
    });

    it('extension 有回報（required）→ true', () => {
      expect(isFeatureAvailable(negotiation, 'chatGpt')).toBe(true);
    });

    it('required 但未回報（擴充項）→ false（gating）', () => {
      expect(isFeatureAvailable(negotiation, 'readability')).toBe(false);
      expect(isFeatureAvailable(negotiation, 'facebook')).toBe(false);
    });

    it('協商中未見過的 feature → false（不編造、gating）', () => {
      expect(isFeatureAvailable(negotiation, 'unknownChannel')).toBe(false);
    });

    it('extension 回報之 extra（不在 required）→ true（額外能力放行）', () => {
      const n = negotiateCapabilities(['chatGpt', 'geminiApp'], ['chatGpt']);
      expect(isFeatureAvailable(n, 'geminiApp')).toBe(true);
    });
  });
});
