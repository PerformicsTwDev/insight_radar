import { useEffect, useRef, type RefObject } from 'react';

/**
 * Modal keyboard trap (NFR-7 / TC-24) — the single point behind every self-built
 * dialog (`ConfirmDialog`, `CustomClassifyModal`), so focus behaviour is not
 * re-implemented per modal. Attach the returned ref to the dialog container; on
 * mount it moves focus to the first focusable inside (or the container itself),
 * keeps Tab / Shift+Tab cycling within it, invokes `onEscape` on Esc, and restores
 * focus to the opener when it unmounts.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusablesIn(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true',
  );
}

export function useFocusTrap<T extends HTMLElement>(onEscape?: () => void): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Keep the escape handler current without re-running the mount effect (which would
  // re-steal focus on every parent re-render).
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const initial = focusablesIn(node);
    (initial[0] ?? node).focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        escapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusablesIn(node as HTMLElement);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
    // Mount-only: the trap installs once per open and tears down on close. Only refs
    // are read inside (exhaustive-deps ignores ref access), so `[]` is correct.
  }, []);

  return ref;
}
