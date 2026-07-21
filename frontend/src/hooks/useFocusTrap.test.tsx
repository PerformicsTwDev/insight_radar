import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useFocusTrap } from './useFocusTrap';

/**
 * TC-24 (NFR-7) — the shared modal keyboard contract: initial focus moves into the
 * trapped container, Tab / Shift+Tab cycle within it, Esc invokes the escape
 * handler, and focus is restored to the opener on unmount.
 */

function Dialog({ onEscape }: { onEscape?: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>(onEscape);
  return (
    <div ref={ref} role="dialog" aria-label="t" tabIndex={-1}>
      <button type="button">A</button>
      <button type="button">B</button>
      <button type="button">C</button>
    </div>
  );
}

function Toggle({ onEscape }: { onEscape?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      {open ? (
        <>
          <Dialog onEscape={onEscape} />
          <button type="button" onClick={() => setOpen(false)}>
            unmount
          </button>
        </>
      ) : null}
    </>
  );
}

describe('TC-24 · useFocusTrap', () => {
  it('moves initial focus onto the first focusable inside the container', () => {
    render(<Dialog />);
    expect(screen.getByRole('button', { name: 'A' })).toHaveFocus();
  });

  it('wraps Tab from the last focusable back to the first', () => {
    render(<Dialog />);
    const c = screen.getByRole('button', { name: 'C' });
    c.focus();
    fireEvent.keyDown(c, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'A' })).toHaveFocus();
  });

  it('wraps Shift+Tab from the first focusable to the last', () => {
    render(<Dialog />);
    const a = screen.getByRole('button', { name: 'A' });
    a.focus();
    fireEvent.keyDown(a, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'C' })).toHaveFocus();
  });

  it('leaves focus alone when Tabbing off a middle element', () => {
    render(<Dialog />);
    const b = screen.getByRole('button', { name: 'B' });
    b.focus();
    fireEvent.keyDown(b, { key: 'Tab' });
    expect(b).toHaveFocus();
  });

  it('invokes onEscape when Escape is pressed', () => {
    const onEscape = vi.fn();
    render(<Dialog onEscape={onEscape} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('focuses the container and swallows Tab when it holds no focusables', () => {
    function Empty() {
      const ref = useFocusTrap<HTMLDivElement>();
      return <div ref={ref} role="dialog" aria-label="empty" tabIndex={-1} />;
    }
    render(<Empty />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' }); // no focusables → swallowed, no throw
    expect(dialog).toHaveFocus();
  });

  it('restores focus to the opener when the trap unmounts', () => {
    render(<Toggle />);
    const opener = screen.getByRole('button', { name: 'open' });
    opener.focus();
    fireEvent.click(opener);
    // focus is now inside the dialog…
    expect(screen.getByRole('button', { name: 'A' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'unmount' }));
    // …and returns to the opener on unmount.
    expect(opener).toHaveFocus();
  });
});
