import { normalizePostKey } from './post-key';

describe('normalizePostKey (S13 / AC-46.1 唯一去重鍵)', () => {
  it('去 query、去 fragment、去尾斜線、大小寫收斂', () => {
    expect(normalizePostKey('https://www.threads.net/@User/post/ABC123?utm=x#frag')).toBe(
      'https://www.threads.net/@user/post/abc123',
    );
    expect(normalizePostKey('https://example.com/path/')).toBe('https://example.com/path');
    expect(normalizePostKey('https://example.com/Path///')).toBe('https://example.com/path');
    expect(normalizePostKey('HTTPS://Example.com/A?b=1')).toBe('https://example.com/a');
  });

  it('前後空白 trim', () => {
    expect(normalizePostKey('  https://x.com/y  ')).toBe('https://x.com/y');
  });

  it('同貼文不同 query → 同一 key（跨來源/跨平台 merge 去重）', () => {
    expect(normalizePostKey('https://t.co/p1?a=1')).toBe(normalizePostKey('https://t.co/p1?b=2'));
  });

  it('僅 fragment 也剝除', () => {
    expect(normalizePostKey('https://x.com/y#section')).toBe('https://x.com/y');
  });

  it('缺值 / 空 / 非字串 → null（無法產生去重鍵）', () => {
    expect(normalizePostKey(null)).toBeNull();
    expect(normalizePostKey(undefined)).toBeNull();
    expect(normalizePostKey('')).toBeNull();
    expect(normalizePostKey('   ')).toBeNull();
    expect(normalizePostKey(123)).toBeNull();
    expect(normalizePostKey({})).toBeNull();
  });
});
