import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useOutsideClick } from './useOutsideClick';

function Fixture({ active, onOutside }: { active: boolean; onOutside: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ref = useOutsideClick<HTMLDivElement>(active, onOutside, triggerRef);
  return (
    <div>
      <button ref={triggerRef} data-testid="trigger" type="button">
        trigger
      </button>
      <div ref={ref} data-testid="pop">
        <span data-testid="inside">inside</span>
      </div>
      <span data-testid="outside">outside</span>
    </div>
  );
}

describe('useOutsideClick (M7-R9)', () => {
  it('invokes onOutside for a pointer-down outside the popover and trigger', () => {
    const cb = vi.fn();
    const { getByTestId } = render(<Fixture active onOutside={cb} />);
    fireEvent.pointerDown(getByTestId('outside'));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('ignores a pointer-down inside the popover', () => {
    const cb = vi.fn();
    const { getByTestId } = render(<Fixture active onOutside={cb} />);
    fireEvent.pointerDown(getByTestId('inside'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores a pointer-down on the trigger (ignoreRef)', () => {
    const cb = vi.fn();
    const { getByTestId } = render(<Fixture active onOutside={cb} />);
    fireEvent.pointerDown(getByTestId('trigger'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('does nothing while inactive (no listener installed)', () => {
    const cb = vi.fn();
    const { getByTestId } = render(<Fixture active={false} onOutside={cb} />);
    fireEvent.pointerDown(getByTestId('outside'));
    expect(cb).not.toHaveBeenCalled();
  });
});
