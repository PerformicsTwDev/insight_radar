import { decideRunStatus, PHASE_PERCENT } from './decide-run-status';
import { TOPIC_PHASES } from './topic-run.types';

describe('decideRunStatus (T8.9 / NFR-12)', () => {
  it('completed when no stage degraded', () => {
    expect(decideRunStatus({ serpDegraded: false, namingDegraded: false })).toBe('completed');
  });

  it('partial when SERP degraded', () => {
    expect(decideRunStatus({ serpDegraded: true, namingDegraded: false })).toBe('partial');
  });

  it('partial when naming degraded', () => {
    expect(decideRunStatus({ serpDegraded: false, namingDegraded: true })).toBe('partial');
  });

  it('partial when both degraded', () => {
    expect(decideRunStatus({ serpDegraded: true, namingDegraded: true })).toBe('partial');
  });
});

describe('PHASE_PERCENT', () => {
  it('is monotonic across the pipeline phases and ends at 100', () => {
    let previous = 0;
    for (const phase of TOPIC_PHASES) {
      expect(PHASE_PERCENT[phase]).toBeGreaterThan(previous);
      previous = PHASE_PERCENT[phase];
    }
    expect(PHASE_PERCENT.persist).toBe(100);
  });
});
