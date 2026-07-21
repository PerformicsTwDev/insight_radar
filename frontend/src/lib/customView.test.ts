import { describe, expect, it } from 'vitest';
import {
  customAssignStreamPath,
  customViewName,
  deepLinkTab,
  DEEP_LINK_TAB_NAME,
  nextActiveCid,
  removeTab,
  upsertTab,
  type CustomTab,
} from './customView';

/**
 * TC-26 (stage two, pure core) — the custom-view tab helpers (T5.2, FR-16). All the
 * dynamic-tab branching lives here (pure, ≥90 core gate) so the container stays a thin
 * shell: the `custom:{cid}` view name + assignments SSE sub-path, and the tab-list
 * reducers (upsert dedupe / remove / next-active selection after a delete).
 */

const A: CustomTab = { cid: 'a', name: '競爭優勢' };
const B: CustomTab = { cid: 'b', name: '使用情境' };

describe('TC-26 · customViewName', () => {
  it('prefixes the classification id with `custom:` (the view-router view name)', () => {
    expect(customViewName('abc')).toBe('custom:abc');
  });
});

describe('TC-26 · deepLinkTab (#647, AC-1.2 deep-link seed)', () => {
  it('builds the single seed tab for a custom:{cid} deep-link cid (generic display name)', () => {
    expect(deepLinkTab('abc')).toEqual({ cid: 'abc', name: DEEP_LINK_TAB_NAME });
  });
});

describe('TC-26 · customAssignStreamPath', () => {
  it('builds the assignments SSE sub-path for the cid', () => {
    expect(customAssignStreamPath('abc')).toBe('custom-classifications/abc/assignments/stream');
  });
});

describe('TC-26 · upsertTab', () => {
  it('appends a new tab', () => {
    expect(upsertTab([A], B)).toEqual([A, B]);
  });

  it('is idempotent on cid (a re-run of the same classification adds no duplicate tab)', () => {
    expect(upsertTab([A, B], { cid: 'a', name: '競爭優勢' })).toEqual([A, B]);
  });
});

describe('TC-26 · removeTab', () => {
  it('removes the tab with the given cid', () => {
    expect(removeTab([A, B], 'a')).toEqual([B]);
  });

  it('is a no-op for an unknown cid', () => {
    expect(removeTab([A, B], 'zzz')).toEqual([A, B]);
  });
});

describe('TC-26 · nextActiveCid', () => {
  it('keeps the current active when a different tab was removed', () => {
    expect(nextActiveCid([A], 'b', 'a')).toBe('a');
  });

  it('activates the first remaining tab when the active one was removed', () => {
    expect(nextActiveCid([B], 'a', 'a')).toBe('b');
  });

  it('returns null when the removed active tab was the last one', () => {
    expect(nextActiveCid([], 'a', 'a')).toBeNull();
  });
});
