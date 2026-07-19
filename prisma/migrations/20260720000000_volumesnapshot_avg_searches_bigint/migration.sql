-- Widen volume_snapshots.avg_monthly_searches from INT4 to BIGINT (#469).
-- Google Ads `avgMonthlySearches` is int64; a mega-term (> INT4 max 2,147,483,647)
-- overflowed on insert ('integer out of range'). BIGINT covers the full range;
-- read boundaries convert to JS number (values stay < 2^53). Roll-forward only.
-- Nullable is preserved (correctness rule: missing = NULL, never coerced to 0).
ALTER TABLE "volume_snapshots" ALTER COLUMN "avg_monthly_searches" SET DATA TYPE BIGINT;
