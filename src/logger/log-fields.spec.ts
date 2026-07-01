import { LogField, LogPhase } from './log-fields';

describe('structured log schema', () => {
  it('exposes log field names', () => {
    expect(LogField.PHASE).toBe('phase');
    expect(LogField.ANALYSIS_ID).toBe('analysisId');
    expect(LogField.DURATION_MS).toBe('durationMs');
    expect(LogField.REQUEST_ID).toBe('requestId');
  });

  it('exposes the per-job metric field names (T7.2)', () => {
    expect(LogField.CACHE_HIT_RATE).toBe('cacheHitRate');
    expect(LogField.EXTERNAL_CALLS).toBe('externalCalls');
    expect(LogField.RETRIES).toBe('retries');
    expect(LogField.STATUS).toBe('status');
    expect(LogField.PHASES).toBe('phases');
    expect(LogField.EXPANDED).toBe('expanded');
    expect(LogField.LABELED).toBe('labeled');
    expect(LogField.TOTAL).toBe('total');
  });

  it('exposes pipeline phase names', () => {
    expect(LogPhase.EXPAND).toBe('expand');
    expect(LogPhase.METRICS).toBe('metrics');
    expect(LogPhase.INTENT).toBe('intent');
    expect(LogPhase.PERSIST).toBe('persist');
  });
});
