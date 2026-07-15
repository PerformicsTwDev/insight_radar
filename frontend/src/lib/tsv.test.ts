import { describe, expect, it } from 'vitest';
import { escapeTsvCell, toTsv } from './tsv';

/**
 * TC-6 (FR-13) — TSV export escaping. Spreadsheet paste rules: a cell containing a
 * tab / newline / carriage-return / double-quote is wrapped in double quotes with
 * internal quotes doubled; everything else passes through. A `null` / `undefined`
 * cell is an **empty string**, never the text "null" (C: null 不輸出字樣).
 */

describe('TC-6 · escapeTsvCell', () => {
  it('passes plain text through unchanged', () => {
    expect(escapeTsvCell('running shoes')).toBe('running shoes');
  });

  it('stringifies a number', () => {
    expect(escapeTsvCell(1200)).toBe('1200');
  });

  it('renders 0 as "0" (a real value, not empty)', () => {
    expect(escapeTsvCell(0)).toBe('0');
  });

  it('null → empty string (never the text "null")', () => {
    expect(escapeTsvCell(null)).toBe('');
  });

  it('undefined → empty string', () => {
    expect(escapeTsvCell(undefined)).toBe('');
  });

  it('leaves an empty string empty (not quoted)', () => {
    expect(escapeTsvCell('')).toBe('');
  });

  it('quote-wraps a cell containing a tab', () => {
    expect(escapeTsvCell('a\tb')).toBe('"a\tb"');
  });

  it('quote-wraps a cell containing a newline', () => {
    expect(escapeTsvCell('a\nb')).toBe('"a\nb"');
  });

  it('quote-wraps a cell containing a carriage return', () => {
    expect(escapeTsvCell('a\rb')).toBe('"a\rb"');
  });

  it('quote-wraps and doubles internal double-quotes', () => {
    expect(escapeTsvCell('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('TC-6 · toTsv', () => {
  it('joins header + rows with tabs / newlines, escaping each cell (null → empty)', () => {
    const tsv = toTsv(
      ['詞', '搜尋量'],
      [
        ['running', 12000],
        ['a\tb', null],
      ],
    );
    expect(tsv).toBe('詞\t搜尋量\nrunning\t12000\n"a\tb"\t');
  });

  it('escapes special characters in a header cell too', () => {
    expect(toTsv(['a"b'], [])).toBe('"a""b"');
  });

  it('round-trips simple columns/rows (paste back restores the grid)', () => {
    const tsv = toTsv(['x', 'y'], [['1', '2']]);
    expect(tsv.split('\n').map((r) => r.split('\t'))).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });
});
