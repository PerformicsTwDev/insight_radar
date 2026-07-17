import {
  isTerminalEvent,
  planSseResponse,
  terminalSnapshot,
  toMessageEvent,
} from './custom-classify-assign-sse';

const TERMINAL = new Set(['completed', 'failed']);

describe('custom-classify SSE pure logic (T12.8 / FR-34 / AC-34.2)', () => {
  describe('isTerminalEvent', () => {
    it('is true for completed and failed, false otherwise', () => {
      expect(isTerminalEvent({ type: 'completed', data: {} })).toBe(true);
      expect(isTerminalEvent({ type: 'failed', data: 'x' })).toBe(true);
      expect(isTerminalEvent({ type: 'progress', data: { percent: 40 } })).toBe(false);
    });
  });

  describe('toMessageEvent', () => {
    it('wraps a failed event reason into { error }', () => {
      expect(toMessageEvent({ type: 'failed', data: 'boom' })).toEqual({
        type: 'failed',
        data: { error: 'boom' },
      });
    });

    it('passes a non-failed event through (type + data)', () => {
      expect(toMessageEvent({ type: 'progress', data: { percent: 40 } })).toEqual({
        type: 'progress',
        data: { percent: 40 },
      });
    });
  });

  describe('terminalSnapshot', () => {
    it('maps a completed run to a completed snapshot', () => {
      expect(terminalSnapshot({ runId: 'run-1', status: 'completed' })).toEqual({
        type: 'completed',
        data: { runId: 'run-1', status: 'completed' },
      });
    });

    it('maps a non-completed terminal run (failed) to a failed snapshot', () => {
      expect(terminalSnapshot({ runId: 'run-1', status: 'failed' })).toEqual({
        type: 'failed',
        data: { error: 'failed' },
      });
    });
  });

  describe('planSseResponse', () => {
    it('plans an empty stream when there is no run', () => {
      expect(planSseResponse(null, TERMINAL)).toEqual({ kind: 'empty' });
    });

    it('plans a terminal snapshot for a completed run (no live subscription)', () => {
      expect(planSseResponse({ runId: 'run-1', status: 'completed' }, TERMINAL)).toEqual({
        kind: 'terminal',
        event: { type: 'completed', data: { runId: 'run-1', status: 'completed' } },
      });
    });

    it('plans a terminal snapshot for a failed run', () => {
      expect(planSseResponse({ runId: 'run-1', status: 'failed' }, TERMINAL)).toEqual({
        kind: 'terminal',
        event: { type: 'failed', data: { error: 'failed' } },
      });
    });

    it('plans a live subscription for an in-progress run', () => {
      expect(planSseResponse({ runId: 'run-1', status: 'running' }, TERMINAL)).toEqual({
        kind: 'live',
        runId: 'run-1',
      });
    });
  });
});
