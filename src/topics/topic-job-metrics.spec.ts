import { LogField } from '../logger/log-fields';
import { TOPIC_PHASES } from './topic-run.types';
import { TOPIC_LATENCY_BUDGET_MS, TopicJobMetrics } from './topic-job-metrics';

/** 可控時鐘：依序回傳給定值。 */
function fakeClock(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('TopicJobMetrics (T8.12 / NFR-11)', () => {
  it('times a phase as end - start (clock injected)', () => {
    const metrics = new TopicJobMetrics('run-1', fakeClock(100, 175));
    const end = metrics.startPhase('embed');
    end();

    const fields = metrics.toLogFields('completed');
    expect((fields[LogField.PHASES] as Record<string, number>).embed).toBe(75);
  });

  it('clamps a non-monotonic clock to 0 (never negative)', () => {
    const metrics = new TopicJobMetrics('run-1', fakeClock(200, 100));
    const end = metrics.startPhase('cluster');
    end();

    expect(
      (metrics.toLogFields('completed')[LogField.PHASES] as Record<string, number>).cluster,
    ).toBe(0);
  });

  it('emits counts, status, degraded and topicJobId as structured fields', () => {
    const metrics = new TopicJobMetrics('run-9');
    metrics.setCounts({ keywordCount: 30, clusterCount: 4, noiseCount: 6 });
    metrics.setDegraded(true);

    expect(metrics.toLogFields('partial')).toMatchObject({
      [LogField.TOPIC_JOB_ID]: 'run-9',
      [LogField.STATUS]: 'partial',
      [LogField.KEYWORD_COUNT]: 30,
      [LogField.CLUSTER_COUNT]: 4,
      [LogField.NOISE_COUNT]: 6,
      [LogField.DEGRADED]: true,
    });
  });

  it('defaults counts to 0 and degraded to false', () => {
    expect(new TopicJobMetrics('r').toLogFields('completed')).toMatchObject({
      [LogField.KEYWORD_COUNT]: 0,
      [LogField.CLUSTER_COUNT]: 0,
      [LogField.NOISE_COUNT]: 0,
      [LogField.DEGRADED]: false,
    });
  });

  it('a repeated phase timing takes the last value', () => {
    const metrics = new TopicJobMetrics('r', fakeClock(0, 10, 100, 130));
    metrics.startPhase('name')();
    metrics.startPhase('name')();
    expect((metrics.toLogFields('completed')[LogField.PHASES] as Record<string, number>).name).toBe(
      30,
    );
  });
});

describe('TOPIC_LATENCY_BUDGET_MS', () => {
  it('defines a positive budget for every pipeline phase (NFR-11 reference)', () => {
    for (const phase of TOPIC_PHASES) {
      expect(TOPIC_LATENCY_BUDGET_MS[phase]).toBeGreaterThan(0);
    }
  });
});
