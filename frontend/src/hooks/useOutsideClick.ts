import { useEffect, useRef, type RefObject } from 'react';

/**
 * Dismiss-on-outside-click (M7-R9, FR-6 / TC-59 v4 fidelity) — the single point behind
 * every self-built popover (filter chips, trend 篩選搜尋詞), so "click away closes it" is
 * not re-implemented per popover. Attach the returned ref to the popover container. While
 * `active`, a capture-phase `pointerdown` anywhere outside the popover (and outside the
 * optional `ignoreRef` trigger, so the trigger's own onClick still toggles) invokes
 * `onOutside`. Because pressing another chip's trigger is "outside" this popover, it also
 * yields effective single-open. Mirrors {@link useFocusTrap}'s ref-based shape.
 */
export function useOutsideClick<T extends HTMLElement>(
  active: boolean,
  onOutside: () => void,
  ignoreRef?: RefObject<HTMLElement | null>,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Keep the callback current without re-running the effect (which would reinstall the
  // listener on every parent re-render). Same pattern as useFocusTrap's escapeRef.
  const cbRef = useRef(onOutside);
  cbRef.current = onOutside;

  useEffect(() => {
    if (!active) return;
    function onPointerDown(event: PointerEvent): void {
      // `contains(null)` is spec'd to return false, so a null target falls through to onOutside.
      const target = event.target as Node | null;
      if (ref.current?.contains(target)) return; // inside the popover → keep open
      if (ignoreRef?.current?.contains(target)) return; // on the trigger → let its onClick toggle
      cbRef.current();
    }
    // Capture phase: observe the press before React's bubbling handlers run.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
    // Reinstalls only when `active` flips; `ref`/`ignoreRef` are stable ref objects read
    // via `.current`, and `onOutside` is read via `cbRef`.
  }, [active, ignoreRef]);

  return ref;
}
