import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config/env';
import { useAnalysisSettingsStore } from '../stores/analysisSettingsStore';
import { NavSettings } from './NavSettings';

/**
 * TC-72 (T7.9) — the top-nav 分析設定 control: shows the active geo · language, opens a
 * popover to edit them, and writes the persisted store (localStorage).
 */
describe('TC-72 · NavSettings (top-nav geo/language)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAnalysisSettingsStore.setState({
      geo: config.defaultGeo,
      language: config.defaultLanguage,
    });
  });

  it('shows the active geo · language and opens a popover to edit them', () => {
    render(<NavSettings />);
    const toggle = screen.getByRole('button', { name: '分析設定' });
    expect(toggle).toHaveTextContent('TW');
    expect(toggle).toHaveTextContent('zh-TW');

    // Popover closed initially → fields not in the DOM.
    expect(screen.queryByLabelText('地區 (geo)')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByLabelText('地區 (geo)')).toBeInTheDocument();
    expect(screen.getByLabelText('語言 (language)')).toBeInTheDocument();
  });

  it('editing geo/language updates the store and persists to localStorage', () => {
    render(<NavSettings />);
    fireEvent.click(screen.getByRole('button', { name: '分析設定' }));
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'US' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'en' } });

    expect(useAnalysisSettingsStore.getState().geo).toBe('US');
    expect(useAnalysisSettingsStore.getState().language).toBe('en');

    const persisted = JSON.parse(localStorage.getItem('ir.settings') ?? '{}') as {
      state?: { geo?: string; language?: string };
    };
    expect(persisted.state).toMatchObject({ geo: 'US', language: 'en' });
  });
});
