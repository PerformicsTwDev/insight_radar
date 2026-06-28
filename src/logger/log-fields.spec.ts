import { LogField, LogPhase } from './log-fields';

describe('structured log schema', () => {
  it('exposes log field names', () => {
    expect(LogField.PHASE).toBe('phase');
    expect(LogField.ANALYSIS_ID).toBe('analysisId');
    expect(LogField.DURATION_MS).toBe('durationMs');
    expect(LogField.REQUEST_ID).toBe('requestId');
  });

  it('exposes pipeline phase names', () => {
    expect(LogPhase.EXPAND).toBe('expand');
    expect(LogPhase.METRICS).toBe('metrics');
    expect(LogPhase.INTENT).toBe('intent');
    expect(LogPhase.PERSIST).toBe('persist');
  });
});
