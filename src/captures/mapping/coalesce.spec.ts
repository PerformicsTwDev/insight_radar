import {
  asRecord,
  capturedAtToIso,
  coerceString,
  collectUnknownFields,
  normalizeReferences,
  pickAlias,
} from './coalesce';

describe('capturedAtToIso', () => {
  it('Date → ISO 字串；既有字串 → 原樣', () => {
    expect(capturedAtToIso(new Date('2025-11-21T00:00:00.000Z'))).toBe('2025-11-21T00:00:00.000Z');
    expect(capturedAtToIso('2025-11-21T00:00:00+08:00')).toBe('2025-11-21T00:00:00+08:00');
  });
});

describe('asRecord', () => {
  it('物件 → 同一 record；陣列/primitive/null → null', () => {
    const obj = { a: 1 };
    expect(asRecord(obj)).toBe(obj);
    expect(asRecord([])).toBeNull();
    expect(asRecord(null)).toBeNull();
    expect(asRecord('str')).toBeNull();
    expect(asRecord(5)).toBeNull();
    expect(asRecord(undefined)).toBeNull();
  });
});

describe('pickAlias (異名欄位收斂 author|channelName|name)', () => {
  const aliases = ['author', 'channelName', 'name'] as const;

  it('取 alias 順序第一個有值者', () => {
    expect(pickAlias({ channelName: 'foo' }, aliases)).toBe('foo');
    expect(pickAlias({ name: 'a', author: 'b' }, aliases)).toBe('b');
  });

  it('跳過 undefined/null 值、續取下一 alias', () => {
    expect(pickAlias({ author: null, channelName: 'c' }, aliases)).toBe('c');
    expect(pickAlias({ author: undefined, name: 'n' }, aliases)).toBe('n');
  });

  it('保留 0 / 空字串（非 null/undefined 即有值——metrics 0 為真實值）', () => {
    expect(pickAlias({ likes: 0 }, ['likes'])).toBe(0);
    expect(pickAlias({ content: '' }, ['content'])).toBe('');
  });

  it('全部缺 → undefined', () => {
    expect(pickAlias({}, aliases)).toBeUndefined();
  });
});

describe('coerceString', () => {
  it('trim 後非空字串 → 該字串', () => {
    expect(coerceString('hello')).toBe('hello');
    expect(coerceString('  hi  ')).toBe('hi');
  });

  it('空白 / 非字串 / 缺值 → null', () => {
    expect(coerceString('')).toBeNull();
    expect(coerceString('   ')).toBeNull();
    expect(coerceString(123)).toBeNull();
    expect(coerceString(null)).toBeNull();
    expect(coerceString(undefined)).toBeNull();
    expect(coerceString({})).toBeNull();
  });
});

describe('collectUnknownFields (未知欄位漂移預警 AC-37.4)', () => {
  const recognized = new Set(['query', 'blocks', 'references']);

  it('回傳不在白名單的欄位名', () => {
    expect(collectUnknownFields({ query: 'q', weird: 1 }, recognized)).toEqual(['weird']);
    expect(collectUnknownFields({ query: 'q', blocks: [] }, recognized)).toEqual([]);
  });

  it('多個未知欄位保持出現順序', () => {
    expect(collectUnknownFields({ a: 1, query: 'q', b: 2 }, recognized)).toEqual(['a', 'b']);
  });
});

describe('normalizeReferences (AC-37.3/39.3 統一 {title,link,snippet?,source?,index})', () => {
  it('缺（undefined/null）→ []（grounding 缺失不編造，§18.3）', () => {
    expect(normalizeReferences(undefined)).toEqual({ references: [], issues: [] });
    expect(normalizeReferences(null)).toEqual({ references: [], issues: [] });
    expect(normalizeReferences([])).toEqual({ references: [], issues: [] });
  });

  it('非陣列 → 形狀不符 issue（不拋）', () => {
    expect(normalizeReferences({ title: 'x' })).toEqual({
      references: [],
      issues: ['references:not_array'],
    });
    expect(normalizeReferences('str').issues).toContain('references:not_array');
  });

  it('AI Overview 形狀（已含 title/link/snippet/source/index）原樣收斂', () => {
    const { references, issues } = normalizeReferences([
      { title: 'T', link: 'https://a', snippet: 's', source: 'news', index: 0 },
    ]);
    expect(issues).toEqual([]);
    expect(references).toEqual([
      { title: 'T', link: 'https://a', snippet: 's', source: 'news', index: 0 },
    ]);
  });

  it('Gemini 形狀 {name,url} → {title:name, link:url}', () => {
    const { references } = normalizeReferences([{ name: 'N', url: 'https://u' }]);
    expect(references).toEqual([{ title: 'N', link: 'https://u', index: 0 }]);
  });

  it('index 缺 → 依位置補；有 index → 尊重', () => {
    const { references } = normalizeReferences([
      { title: 'a', link: 'https://x' },
      { title: 'b', link: 'https://y' },
    ]);
    expect(references.map((r) => r.index)).toEqual([0, 1]);
    expect(
      normalizeReferences([{ title: 'a', link: 'https://x', index: 5 }]).references[0].index,
    ).toBe(5);
  });

  it('snippet/source 缺 → 省略該鍵（optional）', () => {
    const { references } = normalizeReferences([{ title: 'a', link: 'https://x' }]);
    expect(references[0]).not.toHaveProperty('snippet');
    expect(references[0]).not.toHaveProperty('source');
  });

  it('缺 link → missing_link issue（仍保留 best-effort）', () => {
    const { references, issues } = normalizeReferences([{ title: 'a' }]);
    expect(references[0].link).toBe('');
    expect(issues).toContain('reference[0]:missing_link');
  });

  it('非物件元素 → not_object issue 並跳過（不阻斷其他元素）', () => {
    const { references, issues } = normalizeReferences([{ title: 'a', link: 'https://x' }, 'bad']);
    expect(references).toHaveLength(1);
    expect(references[0]).toEqual({ title: 'a', link: 'https://x', index: 0 });
    expect(issues).toContain('reference[1]:not_object');
  });
});
