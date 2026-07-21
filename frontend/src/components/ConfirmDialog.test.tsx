import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../test/axe';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * TC-24 (NFR-7) — the shared destructive-confirm dialog is an accessible modal:
 * role/aria-modal + a labelled heading, keyboard-reachable (Esc dismisses, focus is
 * trapped and lands inside on open), and the backdrop-dismiss behaviour is
 * conserved. axe finds no WCAG violation.
 */

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const result = render(
    <ConfirmDialog
      title="刪除清單"
      body="確定要刪除「寵物用品」嗎？此動作無法復原。"
      confirmLabel="確定刪除"
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onCancel, onConfirm, ...result };
}

describe('TC-24 · ConfirmDialog a11y', () => {
  it('is a modal dialog labelled by its title', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: '刪除清單' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('has no axe violations', async () => {
    const { container } = renderDialog();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('moves focus into the dialog on open (the cancel button)', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  });

  it('closes on Escape (invokes onCancel)', () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('traps Tab within the dialog (last → first)', () => {
    renderDialog();
    const confirm = screen.getByRole('button', { name: '確定刪除' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  });

  it('still confirms and cancels via the buttons', () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '確定刪除' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('still dismisses on a backdrop click (behaviour conserved)', () => {
    const { onCancel } = renderDialog();
    // The backdrop is the aria-hidden overlay behind the panel.
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
