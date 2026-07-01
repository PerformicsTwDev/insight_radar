import { computeChecksum, type SnapshotRowData } from './result-snapshot.checksum';

function row(over: Partial<SnapshotRowData> = {}): SnapshotRowData {
  return {
    text: 'Coffee Maker',
    normalizedText: 'coffee maker',
    avgMonthlySearches: 1000,
    competition: 'LOW',
    competitionIndex: 10,
    cpcLow: 1.5,
    cpcHigh: 3.0,
    intent: ['commercial', 'transactional'],
    monthlyVolumes: [{ year: 2026, month: 1, searches: 100 }],
    ...over,
  };
}

describe('computeChecksum (T3.10 / NFR-7 immutability)', () => {
  it('is deterministic for identical content (sha256 hex)', () => {
    expect(computeChecksum([row()])).toBe(computeChecksum([row()]));
    expect(computeChecksum([row()])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is independent of row order (canonical by normalizedText)', () => {
    const a = row({ normalizedText: 'a', text: 'A' });
    const b = row({ normalizedText: 'b', text: 'B' });
    expect(computeChecksum([a, b])).toBe(computeChecksum([b, a]));
  });

  it('is independent of object key order', () => {
    const ordered: SnapshotRowData = row();
    const shuffled: SnapshotRowData = {
      intent: ordered.intent,
      cpcHigh: ordered.cpcHigh,
      normalizedText: ordered.normalizedText,
      text: ordered.text,
      competition: ordered.competition,
      avgMonthlySearches: ordered.avgMonthlySearches,
      competitionIndex: ordered.competitionIndex,
      cpcLow: ordered.cpcLow,
      monthlyVolumes: ordered.monthlyVolumes,
    };
    expect(computeChecksum([shuffled])).toBe(computeChecksum([ordered]));
  });

  it('changes when any metric or intent changes (content-addressed)', () => {
    const base = computeChecksum([row()]);
    expect(computeChecksum([row({ avgMonthlySearches: 999 })])).not.toBe(base);
    expect(computeChecksum([row({ intent: ['informational'] })])).not.toBe(base);
    expect(computeChecksum([row({ cpcLow: null })])).not.toBe(base);
  });

  it('includes monthlyVolumes in the checksum, preserving series order (§5.1)', () => {
    const base = computeChecksum([row()]);
    expect(
      computeChecksum([row({ monthlyVolumes: [{ year: 2026, month: 2, searches: 9 }] })]),
    ).not.toBe(base);
    // 有序序列：canonical 保序 → 不同月份順序 = 不同內容 = 不同 checksum。
    const orderA = row({
      monthlyVolumes: [
        { year: 2026, month: 1, searches: 1 },
        { year: 2026, month: 2, searches: 2 },
      ],
    });
    const orderB = row({
      monthlyVolumes: [
        { year: 2026, month: 2, searches: 2 },
        { year: 2026, month: 1, searches: 1 },
      ],
    });
    expect(computeChecksum([orderA])).not.toBe(computeChecksum([orderB]));
  });

  it('distinguishes different keyword sets', () => {
    expect(computeChecksum([row({ normalizedText: 'x' })])).not.toBe(
      computeChecksum([row({ normalizedText: 'y' })]),
    );
  });
});
