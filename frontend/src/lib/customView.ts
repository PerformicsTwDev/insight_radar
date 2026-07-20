/** RED shell (T5.2) — replaced by the real pure helpers in green. */

export interface CustomTab {
  readonly cid: string;
  readonly name: string;
}

export function customViewName(_cid: string): string {
  throw new Error('not implemented: customViewName');
}

export function customAssignStreamPath(_cid: string): string {
  throw new Error('not implemented: customAssignStreamPath');
}

export function upsertTab(_tabs: readonly CustomTab[], _tab: CustomTab): readonly CustomTab[] {
  throw new Error('not implemented: upsertTab');
}

export function removeTab(_tabs: readonly CustomTab[], _cid: string): readonly CustomTab[] {
  throw new Error('not implemented: removeTab');
}

export function nextActiveCid(
  _remaining: readonly CustomTab[],
  _removedCid: string,
  _currentActive: string | null,
): string | null {
  throw new Error('not implemented: nextActiveCid');
}
