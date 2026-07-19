import {
  assembleVolumeSeries,
  type SeriesListMeta,
  type SeriesMemberInput,
  type SeriesSnapshotInput,
} from './volume-series';

/**
 * TC-66（FR-30 · AC-30.1~30.5 · 正確性單點 S2 null≠0）：`assembleVolumeSeries` 純函式——
 * axis 去重升冪聯集 + per-member 對齊（缺點斷點 null，不補 0）+ total（非 null 之和、全缺→0）+
 * latest（成員自己最新快照）+ 空狀態（無快照→axis=[]、latest=null）+ cpc=cpcLow÷1e6（缺→null）。
 *
 * DB / 時間範圍過濾為呼叫端（service，見 integration）職責；此處以已過濾/已 scope 的輸入驗**組裝正確性**。
 */

const LIST: SeriesListMeta = { listId: 'list-1', name: 'Shoes', geo: 'TW', language: 'zh-TW' };

const T0 = new Date('2026-01-01T00:00:00.000Z');
const T1 = new Date('2026-02-01T00:00:00.000Z');
const T2 = new Date('2026-03-01T00:00:00.000Z');

function member(over: Partial<SeriesMemberInput> = {}): SeriesMemberInput {
  return {
    normalizedText: 'coffee',
    text: 'Coffee',
    addedAt: T0,
    lastCheckedAt: T1,
    ...over,
  };
}

function snap(over: Partial<SeriesSnapshotInput> = {}): SeriesSnapshotInput {
  return {
    normalizedText: 'coffee',
    fetchedAt: T0,
    avgMonthlySearches: 100,
    competition: 'MEDIUM',
    cpcLowMicros: 500000n, // 0.5
    ...over,
  };
}

describe('TC-66: assembleVolumeSeries (unit · FR-30 · AC-30.1~30.5)', () => {
  describe('axis union + list/summary (AC-30.1)', () => {
    it('axis = distinct fetchedAt across all members, ascending; list + summary passthrough', () => {
      const members = [
        member({ normalizedText: 'coffee', text: 'Coffee' }),
        member({ normalizedText: 'tea', text: 'Tea' }),
      ];
      const snapshots = [
        snap({ normalizedText: 'coffee', fetchedAt: T2 }),
        snap({ normalizedText: 'coffee', fetchedAt: T0 }),
        snap({ normalizedText: 'tea', fetchedAt: T1 }), // T1 只來自 tea → 仍在聯集
      ];

      const res = assembleVolumeSeries(LIST, members, snapshots);

      expect(res.list).toEqual(LIST);
      expect(res.axis).toEqual([T0, T1, T2]); // 去重升冪聯集
      expect(res.summary).toEqual({ memberCount: 2, latestFetchedAt: T2 });
    });
  });

  describe('per-member alignment: breakpoint null ≠ 0 (AC-30.2)', () => {
    it('a member missing a point → null breakpoint (not 0); present point → its values', () => {
      const members = [
        member({ normalizedText: 'coffee', text: 'Coffee' }),
        member({ normalizedText: 'tea', text: 'Tea' }),
      ];
      const snapshots = [
        snap({ normalizedText: 'coffee', fetchedAt: T0, avgMonthlySearches: 100 }),
        // coffee 無 T1 快照（store-on-change：值變才落列）→ T1 為斷點
        snap({ normalizedText: 'coffee', fetchedAt: T2, avgMonthlySearches: 120 }),
        snap({ normalizedText: 'tea', fetchedAt: T1, avgMonthlySearches: 50 }),
      ];

      const res = assembleVolumeSeries(LIST, members, snapshots);
      const coffee = res.members.find((m) => m.normalizedText === 'coffee')!;
      const tea = res.members.find((m) => m.normalizedText === 'tea')!;

      // axis = [T0, T1, T2]
      expect(coffee.series.map((p) => p.avgMonthlySearches)).toEqual([100, null, 120]); // T1 斷點 null
      expect(coffee.series[1]).toEqual({
        fetchedAt: T1,
        avgMonthlySearches: null,
        competition: null,
        cpc: null,
      });
      expect(tea.series.map((p) => p.avgMonthlySearches)).toEqual([null, 50, null]); // T0/T2 斷點
      expect(coffee.series.map((p) => p.fetchedAt)).toEqual([T0, T1, T2]); // 每點帶 axis 時間
    });
  });

  describe('total line: sum of non-null, 0 when all missing (AC-30.2 / AC-5.3)', () => {
    it('total[i] = sum of non-null member avgMonthlySearches; all missing → 0 (always a number)', () => {
      const members = [member({ normalizedText: 'coffee' }), member({ normalizedText: 'tea' })];
      const snapshots = [
        snap({ normalizedText: 'coffee', fetchedAt: T0, avgMonthlySearches: 100 }),
        snap({ normalizedText: 'tea', fetchedAt: T0, avgMonthlySearches: 50 }),
        // T1：coffee 有 null-avg 觀測、tea 缺 → total = 0（非虛假數）
        snap({ normalizedText: 'coffee', fetchedAt: T1, avgMonthlySearches: null }),
        snap({ normalizedText: 'coffee', fetchedAt: T2, avgMonthlySearches: 20 }),
        snap({ normalizedText: 'tea', fetchedAt: T2, avgMonthlySearches: 5 }),
      ];

      const res = assembleVolumeSeries(LIST, members, snapshots);

      expect(res.axis).toEqual([T0, T1, T2]);
      expect(res.total).toEqual([150, 0, 25]); // T1 全缺/ null → 0
      expect(res.total.every((n) => typeof n === 'number')).toBe(true);
    });

    it('present observation with null avg is a real point (not a breakpoint) but contributes 0 to total', () => {
      const members = [member({ normalizedText: 'tea', text: 'Tea' })];
      const snapshots = [
        snap({
          normalizedText: 'tea',
          fetchedAt: T0,
          avgMonthlySearches: null,
          competition: 'UNSPECIFIED',
          cpcLowMicros: null,
        }),
      ];

      const res = assembleVolumeSeries(LIST, members, snapshots);

      expect(res.axis).toEqual([T0]); // 有真實觀測 → axis 非空（非空狀態）
      expect(res.total).toEqual([0]);
      expect(res.members[0].series[0]).toEqual({
        fetchedAt: T0,
        avgMonthlySearches: null, // 真實 null 觀測（缺值≠0）
        competition: 'UNSPECIFIED',
        cpc: null,
      });
    });
  });

  describe('empty state (AC-30.3)', () => {
    it('no snapshots → axis=[], total=[], each member series=[], latest=null, latestFetchedAt=null', () => {
      const members = [member({ normalizedText: 'coffee' }), member({ normalizedText: 'tea' })];

      const res = assembleVolumeSeries(LIST, members, []);

      expect(res.axis).toEqual([]);
      expect(res.total).toEqual([]);
      expect(res.summary).toEqual({ memberCount: 2, latestFetchedAt: null });
      for (const m of res.members) {
        expect(m.series).toEqual([]); // 空 series（不回誤導假 0 線）
        expect(m.latest).toBeNull();
      }
    });

    it('list with members but zero snapshots (scheduler not run) → no fabricated points', () => {
      const res = assembleVolumeSeries(LIST, [member()], []);
      expect(res.members[0].series).toEqual([]);
      expect(res.summary.latestFetchedAt).toBeNull();
    });
  });

  describe('member latest metrics (AC-30.5)', () => {
    it("latest = member's own most-recent snapshot metrics (distinct from axis-aligned last point)", () => {
      const members = [member({ normalizedText: 'coffee' }), member({ normalizedText: 'tea' })];
      const snapshots = [
        snap({
          normalizedText: 'coffee',
          fetchedAt: T0,
          avgMonthlySearches: 100,
          competition: 'LOW',
          cpcLowMicros: 500000n,
        }),
        // coffee 最新自身快照在 T1（值 120）；但 axis 末端為 T2（來自 tea）→ coffee 於 T2 為斷點
        snap({
          normalizedText: 'coffee',
          fetchedAt: T1,
          avgMonthlySearches: 120,
          competition: 'HIGH',
          cpcLowMicros: 1500000n,
        }),
        snap({
          normalizedText: 'tea',
          fetchedAt: T2,
          avgMonthlySearches: 5,
          competition: 'LOW',
          cpcLowMicros: null,
        }),
      ];

      const res = assembleVolumeSeries(LIST, members, snapshots);
      const coffee = res.members.find((m) => m.normalizedText === 'coffee')!;

      // axis-aligned 末點（T2）為斷點 null，但 latest 為 coffee 自身最新（T1）
      expect(coffee.series[2]).toMatchObject({ fetchedAt: T2, avgMonthlySearches: null });
      expect(coffee.latest).toEqual({
        fetchedAt: T1,
        avgMonthlySearches: 120,
        competition: 'HIGH',
        cpc: 1.5,
      });
    });

    it('member with no snapshots → latest null; addedAt/lastCheckedAt passthrough', () => {
      const members = [
        member({ normalizedText: 'coffee' }),
        member({ normalizedText: 'ghost', text: 'Ghost', addedAt: T1, lastCheckedAt: null }),
      ];
      const snapshots = [snap({ normalizedText: 'coffee', fetchedAt: T0 })];

      const res = assembleVolumeSeries(LIST, members, snapshots);
      const ghost = res.members.find((m) => m.normalizedText === 'ghost')!;

      expect(ghost.latest).toBeNull();
      expect(ghost.series).toEqual([
        { fetchedAt: T0, avgMonthlySearches: null, competition: null, cpc: null }, // 全斷點
      ]);
      expect(ghost.addedAt).toEqual(T1);
      expect(ghost.lastCheckedAt).toBeNull();
    });
  });

  describe('latest is derived from the unfiltered per-member set, not the windowed one (AC-30.5 · #471-1)', () => {
    it("windowed set excludes the member's most-recent → latest reflects the unfiltered most-recent", () => {
      const members = [member({ normalizedText: 'coffee' })];
      // windowed（呼叫端已依 ?to= 過濾）僅到 T1；但成員實際最新快照在 T2（在 to 視窗之外）。
      const windowed = [
        snap({ normalizedText: 'coffee', fetchedAt: T0, avgMonthlySearches: 10 }),
        snap({ normalizedText: 'coffee', fetchedAt: T1, avgMonthlySearches: 20 }),
      ];
      const unfilteredLatest = [
        snap({
          normalizedText: 'coffee',
          fetchedAt: T2,
          avgMonthlySearches: 30,
          cpcLowMicros: 3000000n,
        }),
      ];

      const res = assembleVolumeSeries(LIST, members, windowed, unfilteredLatest);
      const coffee = res.members[0];

      // axis/series 仍受 windowed 界定（chart 尊重 to 視窗）
      expect(res.axis).toEqual([T0, T1]);
      expect(coffee.series.map((p) => p.avgMonthlySearches)).toEqual([10, 20]);
      // 但成員表 latest = 成員自身**實際**最新（T2，unfiltered），非 windowed 內最新（T1）
      expect(coffee.latest).toEqual({
        fetchedAt: T2,
        avgMonthlySearches: 30,
        competition: 'MEDIUM',
        cpc: 3,
      });
    });

    it('empty window but member has snapshots → empty series, yet latest still populated (member table survives)', () => {
      const members = [member({ normalizedText: 'coffee' })];
      const unfilteredLatest = [
        snap({ normalizedText: 'coffee', fetchedAt: T2, avgMonthlySearches: 30 }),
      ];

      const res = assembleVolumeSeries(LIST, members, [], unfilteredLatest);

      expect(res.axis).toEqual([]); // windowed 空 → 空狀態 chart
      expect(res.summary.latestFetchedAt).toBeNull();
      expect(res.members[0].series).toEqual([]);
      expect(res.members[0].latest).toMatchObject({ fetchedAt: T2, avgMonthlySearches: 30 });
    });

    it('latestSnapshots defaults to the windowed set when omitted (un-windowed callers unaffected)', () => {
      const members = [member({ normalizedText: 'coffee' })];
      const snapshots = [
        snap({ normalizedText: 'coffee', fetchedAt: T0, avgMonthlySearches: 10 }),
        snap({ normalizedText: 'coffee', fetchedAt: T1, avgMonthlySearches: 20 }),
      ];

      const res = assembleVolumeSeries(LIST, members, snapshots);
      expect(res.members[0].latest).toMatchObject({ fetchedAt: T1, avgMonthlySearches: 20 });
    });
  });

  describe('cpc derivation = cpcLow ÷ 1e6, null micros → null (correctness single-point)', () => {
    it('non-null micros → micros/1e6; null micros → null; 0 → 0 (never fabricates 0)', () => {
      const members = [member({ normalizedText: 'coffee' })];
      const snapshots = [
        snap({ normalizedText: 'coffee', fetchedAt: T0, cpcLowMicros: 2500000n }), // 2.5
        snap({ normalizedText: 'coffee', fetchedAt: T1, cpcLowMicros: null }), // null（不補 0）
        snap({ normalizedText: 'coffee', fetchedAt: T2, cpcLowMicros: 0n }), // 真實 0（與 null 區分）
      ];

      const res = assembleVolumeSeries(LIST, members, snapshots);
      const cpcs = res.members[0].series.map((p) => p.cpc);

      expect(cpcs).toEqual([2.5, null, 0]);
    });
  });
});
