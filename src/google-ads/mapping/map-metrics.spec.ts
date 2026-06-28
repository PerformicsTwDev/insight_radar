import { mapMetrics } from './map-metrics';
import type { RawKeywordMetrics } from './map-metrics';

const CURRENCY = 'TWD';

describe('mapMetrics (TC-3)', () => {
  it('divides bid micros by 1,000,000 into cpcLow/cpcHigh', () => {
    const raw: RawKeywordMetrics = {
      avg_monthly_searches: 1000,
      low_top_of_page_bid_micros: '2500000',
      high_top_of_page_bid_micros: '4000000',
    };
    const out = mapMetrics(raw, CURRENCY);
    expect(out.cpcLow).toBe(2.5);
    expect(out.cpcHigh).toBe(4);
  });

  it('keeps the original micros as bigint-as-string', () => {
    const out = mapMetrics(
      { low_top_of_page_bid_micros: '2500000', high_top_of_page_bid_micros: '4000000' },
      CURRENCY,
    );
    expect(out.cpcLowMicros).toBe('2500000');
    expect(out.cpcHighMicros).toBe('4000000');
  });

  it('maps a null bid micros to cpc null (NOT 0) and micros null', () => {
    const out = mapMetrics(
      {
        avg_monthly_searches: 50,
        low_top_of_page_bid_micros: null,
        high_top_of_page_bid_micros: '4000000',
      },
      CURRENCY,
    );
    expect(out.cpcLow).toBeNull();
    expect(out.cpcLowMicros).toBeNull();
    expect(out.cpcHigh).toBe(4);
    expect(out.cpcHighMicros).toBe('4000000');
  });

  it('maps a missing avg_monthly_searches to null (not 0)', () => {
    const out = mapMetrics({ low_top_of_page_bid_micros: '1000000' }, CURRENCY);
    expect(out.avgMonthlySearches).toBeNull();
  });

  it('passes through a present avg_monthly_searches including 0', () => {
    expect(mapMetrics({ avg_monthly_searches: 0 }, CURRENCY).avgMonthlySearches).toBe(0);
    expect(mapMetrics({ avg_monthly_searches: 12345 }, CURRENCY).avgMonthlySearches).toBe(12345);
  });

  it('parses int64-as-string avg_monthly_searches (gax longs:String) and nulls blank/non-finite', () => {
    expect(mapMetrics({ avg_monthly_searches: '110000' }, CURRENCY).avgMonthlySearches).toBe(
      110000,
    );
    expect(mapMetrics({ avg_monthly_searches: '0' }, CURRENCY).avgMonthlySearches).toBe(0);
    expect(mapMetrics({ avg_monthly_searches: '' }, CURRENCY).avgMonthlySearches).toBeNull();
    expect(mapMetrics({ avg_monthly_searches: '   ' }, CURRENCY).avgMonthlySearches).toBeNull();
    expect(mapMetrics({ avg_monthly_searches: 'abc' }, CURRENCY).avgMonthlySearches).toBeNull();
  });

  it('carries the account currencyCode', () => {
    expect(mapMetrics({ low_top_of_page_bid_micros: '1000000' }, CURRENCY).currencyCode).toBe(
      'TWD',
    );
  });

  it('treats an empty-string bid as null cpc and null micros (not 0)', () => {
    const out = mapMetrics(
      { low_top_of_page_bid_micros: '', high_top_of_page_bid_micros: '4000000' },
      CURRENCY,
    );
    expect(out.cpcLow).toBeNull();
    expect(out.cpcLowMicros).toBeNull();
    expect(out.cpcHigh).toBe(4);
  });

  it('yields all-null cpc fields when both bids are absent', () => {
    const out = mapMetrics({ avg_monthly_searches: 10 }, CURRENCY);
    expect(out.cpcLow).toBeNull();
    expect(out.cpcHigh).toBeNull();
    expect(out.cpcLowMicros).toBeNull();
    expect(out.cpcHighMicros).toBeNull();
  });
});
