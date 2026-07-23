import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config/env';
import { useAnalysisSettingsStore } from '../stores/analysisSettingsStore';
import { NavSettings } from './NavSettings';

/**
 * TC-72 (T7.9) / TC-75 (T7.12) — the top-nav 分析設定 control: shows the active
 * geo · language as FRIENDLY labels, opens a popover with curated `<select>` pickers, and
 * writes the persisted store (localStorage) with the **resource-name** value.
 */
describe('TC-72/TC-75 · NavSettings (top-nav geo/language picker)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAnalysisSettingsStore.setState({
      geo: config.defaultGeo,
      language: config.defaultLanguage,
    });
  });

  it('shows the active geo · language as friendly labels (not raw resource names)', () => {
    render(<NavSettings />);
    const toggle = screen.getByRole('button', { name: '分析設定' });
    expect(toggle).toHaveTextContent('台灣');
    expect(toggle).toHaveTextContent('繁體中文（台灣）');
    expect(toggle).not.toHaveTextContent('geoTargetConstants');

    // Popover closed initially → fields not in the DOM.
    expect(screen.queryByLabelText('地區 (geo)')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByLabelText('地區 (geo)')).toBeInTheDocument();
    expect(screen.getByLabelText('語言 (language)')).toBeInTheDocument();
  });

  it('renders the supported locales as options whose value is a resource name', () => {
    render(<NavSettings />);
    fireEvent.click(screen.getByRole('button', { name: '分析設定' }));
    const geoSelect = screen.getByLabelText('地區 (geo)') as HTMLSelectElement;
    const values = Array.from(geoSelect.options).map((o) => o.value);
    expect(values).toContain('geoTargetConstants/2158');
    expect(values.every((v) => v.startsWith('geoTargetConstants/'))).toBe(true);
    expect(Array.from(geoSelect.options).map((o) => o.textContent)).toContain('台灣');
  });

  it('keeps an unlisted current value selectable (self-labelled fallback option)', () => {
    // e.g. a resource name carried in from a history-row context we do not curate.
    useAnalysisSettingsStore.setState({
      geo: 'geoTargetConstants/9999',
      language: config.defaultLanguage,
    });
    render(<NavSettings />);
    // Chip falls back to the raw value (no friendly label known).
    expect(screen.getByRole('button', { name: '分析設定' })).toHaveTextContent(
      'geoTargetConstants/9999',
    );
    fireEvent.click(screen.getByRole('button', { name: '分析設定' }));
    const geoSelect = screen.getByLabelText('地區 (geo)') as HTMLSelectElement;
    expect(geoSelect.value).toBe('geoTargetConstants/9999');
    expect(Array.from(geoSelect.options).map((o) => o.value)).toContain('geoTargetConstants/9999');
  });

  it('selecting a locale stores the resource-name value and persists it', () => {
    render(<NavSettings />);
    fireEvent.click(screen.getByRole('button', { name: '分析設定' }));
    fireEvent.change(screen.getByLabelText('地區 (geo)'), {
      target: { value: 'geoTargetConstants/2840' },
    });
    fireEvent.change(screen.getByLabelText('語言 (language)'), {
      target: { value: 'languageConstants/1000' },
    });

    expect(useAnalysisSettingsStore.getState().geo).toBe('geoTargetConstants/2840');
    expect(useAnalysisSettingsStore.getState().language).toBe('languageConstants/1000');

    const persisted = JSON.parse(localStorage.getItem('ir.settings') ?? '{}') as {
      state?: { geo?: string; language?: string };
    };
    expect(persisted.state).toMatchObject({
      geo: 'geoTargetConstants/2840',
      language: 'languageConstants/1000',
    });
  });
});
