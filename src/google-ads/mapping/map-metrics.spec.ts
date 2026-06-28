import { mapMetrics } from './map-metrics';
import type { RawKeywordMetrics } from './map-metrics';

const CURRENCY = 'TWD';

describe('mapMetrics (TC-3)', () => {
  it('divides bid micros by 1,000,000 into cpcLow/cpcHigh', () => {
    const raw: RawKeywordMetrics = {
      avgMonthlySearches: 1000,
      lowTopOfPageBidMicros: '2500000',
      highTopOfPageBidMicros: '4000000',
    };
    const out = mapMetrics(raw, CURRENCY);
    expect(out.cpcLow).toBe(2.5);
    expect(out.cpcHigh).toBe(4);
  });

  it('keeps the original micros as bigint-as-string', () => {
    const out = mapMetrics(
      { lowTopOfPageBidMicros: '2500000', highTopOfPageBidMicros: '4000000' },
      CURRENCY,
    );
    expect(out.cpcLowMicros).toBe('2500000');
    expect(out.cpcHighMicros).toBe('4000000');
  });

  it('maps a null bid micros to cpc null (NOT 0) and micros null', () => {
    const out = mapMetrics(
      { avgMonthlySearches: 50, lowTopOfPageBidMicros: null, highTopOfPageBidMicros: '4000000' },
      CURRENCY,
    );
    expect(out.cpcLow).toBeNull();
    expect(out.cpcLowMicros).toBeNull();
    expect(out.cpcHigh).toBe(4);
    expect(out.cpcHighMicros).toBe('4000000');
  });

  it('maps a missing avgMonthlySearches to null (not 0)', () => {
    const out = mapMetrics({ lowTopOfPageBidMicros: '1000000' }, CURRENCY);
    expect(out.avgMonthlySearches).toBeNull();
  });

  it('passes through a present avgMonthlySearches including 0', () => {
    expect(mapMetrics({ avgMonthlySearches: 0 }, CURRENCY).avgMonthlySearches).toBe(0);
    expect(mapMetrics({ avgMonthlySearches: 12345 }, CURRENCY).avgMonthlySearches).toBe(12345);
  });

  it('carries the account currencyCode', () => {
    expect(mapMetrics({ lowTopOfPageBidMicros: '1000000' }, CURRENCY).currencyCode).toBe('TWD');
  });

  it('yields all-null cpc fields when both bids are absent', () => {
    const out = mapMetrics({ avgMonthlySearches: 10 }, CURRENCY);
    expect(out.cpcLow).toBeNull();
    expect(out.cpcHigh).toBeNull();
    expect(out.cpcLowMicros).toBeNull();
    expect(out.cpcHighMicros).toBeNull();
  });
});
