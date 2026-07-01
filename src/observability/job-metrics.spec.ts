import { LogField, LogPhase } from '../logger/log-fields';
import { JobMetrics } from './job-metrics';

/** 可控時鐘：回傳預設序列（每次呼叫取下一個），用來斷言 durationMs 而不依賴真實時間。 */
function fakeClock(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('JobMetrics (T7.2 / TC-30 / NFR-6)', () => {
  it('records per-phase durationMs from the injected clock', () => {
    const m = new JobMetrics('an-1', fakeClock([1000, 1250])); // start=1000, end=1250
    const end = m.startPhase(LogPhase.EXPAND);
    end();
    expect(m.toLogFields('completed').phases).toEqual({ expand: 250 });
  });

  it('records multiple phases independently', () => {
    const m = new JobMetrics('an-1', fakeClock([0, 100, 200, 500])); // expand 0→100, persist 200→500
    m.startPhase(LogPhase.EXPAND)();
    m.startPhase(LogPhase.PERSIST)();
    expect(m.toLogFields('completed').phases).toEqual({ expand: 100, persist: 300 });
  });

  it('clamps a non-monotonic clock to 0 (never negative durations)', () => {
    const m = new JobMetrics('an-1', fakeClock([1000, 900])); // clock went backwards
    m.startPhase(LogPhase.INTENT)();
    expect((m.toLogFields('completed').phases as Record<string, number>).intent).toBe(0);
  });

  it('emits structured fields: analysisId, status, counts (expanded/labeled/total)', () => {
    const m = new JobMetrics('an-42');
    m.setCounts({ expanded: 120, labeled: 118, total: 120 });

    const fields = m.toLogFields('partial');
    expect(fields[LogField.ANALYSIS_ID]).toBe('an-42');
    expect(fields.status).toBe('partial');
    expect(fields.expanded).toBe(120);
    expect(fields.labeled).toBe(118);
    expect(fields.total).toBe(120);
  });

  it('defaults counts to 0 and phases to empty before anything is recorded', () => {
    const fields = new JobMetrics('an-1').toLogFields('failed');
    expect(fields.phases).toEqual({});
    expect(fields).toMatchObject({ expanded: 0, labeled: 0, total: 0 });
  });

  it('accumulates cache hits/lookups into a hit-rate (0..1)', () => {
    const m = new JobMetrics('an-1');
    m.recordCacheLookup(3, 5);
    m.recordCacheLookup(1, 5); // total 4 hits / 10 lookups
    expect(m.toLogFields('completed')[LogField.CACHE_HIT_RATE]).toBe(0.4);
  });

  it('reports cacheHitRate=null when there were no lookups (缺值≠0)', () => {
    expect(new JobMetrics('an-1').toLogFields('completed')[LogField.CACHE_HIT_RATE]).toBeNull();
  });

  it('counts external calls and retries', () => {
    const m = new JobMetrics('an-1');
    m.addExternalCalls();
    m.addExternalCalls(2);
    m.addRetries();
    const fields = m.toLogFields('completed');
    expect(fields[LogField.EXTERNAL_CALLS]).toBe(3);
    expect(fields[LogField.RETRIES]).toBe(1);
  });
});
