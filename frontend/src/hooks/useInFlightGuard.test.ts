import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useInFlightGuard } from './useInFlightGuard';

/**
 * M4-R1 (#603) — the re-entrancy guard behind the ✦ batch / journey double-submit fix.
 * Runs a task only when no prior invocation is outstanding; a concurrent re-entry is a
 * silent no-op, and the flag clears on settle so a later (e.g. retry) call runs again.
 */
describe('useInFlightGuard', () => {
  it('runs a concurrent second invocation as a no-op, then lets a later call run again', async () => {
    const { result } = renderHook(() => useInFlightGuard());

    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = async () => {
      calls += 1;
      await gate;
    };

    await act(async () => {
      const first = result.current(task); // takes the flag, stays in flight on `gate`
      const second = result.current(task); // re-entry while first outstanding → no-op
      release();
      await Promise.all([first, second]);
    });
    expect(calls).toBe(1);

    // Flag cleared in `finally` → a fresh call after the first settled runs the task.
    await act(async () => {
      await result.current(() => {
        calls += 1;
        return Promise.resolve();
      });
    });
    expect(calls).toBe(2);
  });

  it('clears the flag even when the task rejects (a later call is not permanently blocked)', async () => {
    const { result } = renderHook(() => useInFlightGuard());
    let calls = 0;

    await act(async () => {
      await expect(
        result.current(() => {
          calls += 1;
          return Promise.reject(new Error('boom'));
        }),
      ).rejects.toThrow('boom');
    });

    await act(async () => {
      await result.current(() => {
        calls += 1;
        return Promise.resolve();
      });
    });
    expect(calls).toBe(2);
  });
});
