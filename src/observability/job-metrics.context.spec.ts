import { JobMetrics } from './job-metrics';
import { JobMetricsContext } from './job-metrics.context';

describe('JobMetricsContext (T7.2 AsyncLocalStorage)', () => {
  it('exposes the current metrics inside run(), undefined outside', async () => {
    const ctx = new JobMetricsContext();
    const metrics = new JobMetrics('an-1');

    expect(ctx.current()).toBeUndefined(); // 不在任何 run 內

    const inside = await ctx.run(metrics, () => Promise.resolve(ctx.current()));
    expect(inside).toBe(metrics);

    expect(ctx.current()).toBeUndefined(); // run 結束後回無上下文
  });

  it('keeps the store across async awaits (increments attribute to the running job)', async () => {
    const ctx = new JobMetricsContext();
    const metrics = new JobMetrics('an-1');

    await ctx.run(metrics, async () => {
      await Promise.resolve();
      ctx.current()?.addExternalCalls(); // 跨 await 仍取回同一 metrics
    });

    expect(metrics.toLogFields('completed').externalCalls).toBe(1);
  });

  it('isolates concurrent jobs (each run() has its own store)', async () => {
    const ctx = new JobMetricsContext();
    const a = new JobMetrics('a');
    const b = new JobMetrics('b');

    await Promise.all([
      ctx.run(a, async () => {
        await Promise.resolve();
        ctx.current()?.addExternalCalls(2);
      }),
      ctx.run(b, async () => {
        await Promise.resolve();
        ctx.current()?.addExternalCalls(5);
      }),
    ]);

    expect(a.toLogFields('completed').externalCalls).toBe(2); // 並發不互相污染
    expect(b.toLogFields('completed').externalCalls).toBe(5);
  });
});
