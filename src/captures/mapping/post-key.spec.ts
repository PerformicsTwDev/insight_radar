import { normalizePostKey } from './post-key';

describe('normalizePostKey (T13.4 / S13 / AC-46.1 唯一去重鍵 / TC-73)', () => {
  it('去 query、去 fragment、去尾斜線；只收斂 scheme+host、保留 path 大小寫', () => {
    // path 的 @User / shortcode ABC123 大小寫敏感（保留）；host 已 lowercase。
    expect(normalizePostKey('https://www.threads.net/@User/post/ABC123?utm=x#frag')).toBe(
      'https://www.threads.net/@User/post/ABC123',
    );
    expect(normalizePostKey('https://example.com/path/')).toBe('https://example.com/path');
    expect(normalizePostKey('https://example.com/Path///')).toBe('https://example.com/Path');
    // scheme + host 收斂為小寫、path 保留。
    expect(normalizePostKey('HTTPS://Example.com/A?b=1')).toBe('https://example.com/A');
  });

  it('前後空白 trim', () => {
    expect(normalizePostKey('  https://x.com/y  ')).toBe('https://x.com/y');
  });

  it('[9] scheme-less：純 host 收斂小寫；有 path 則保留 path 大小寫', () => {
    expect(normalizePostKey('WWW.Example.COM')).toBe('www.example.com');
    expect(normalizePostKey('WWW.Example.COM/Post/AbC')).toBe('www.example.com/Post/AbC');
  });

  it('同貼文不同 query → 同一 key（跨來源/跨平台 merge 去重）', () => {
    expect(normalizePostKey('https://t.co/p1?a=1')).toBe(normalizePostKey('https://t.co/p1?b=2'));
  });

  it('[9] 只 lowercase scheme+host、保留 path/shortcode 大小寫（host 仍收斂）', () => {
    expect(normalizePostKey('https://t.co/AbC')).toBe('https://t.co/AbC');
    expect(normalizePostKey('HTTPS://T.CO/AbC')).toBe('https://t.co/AbC');
  });

  it('[9] 大小寫不同的 path/shortcode → 不同 key（不因整串 lowercase 碰撞 @@unique）', () => {
    expect(normalizePostKey('https://t.co/AbC')).not.toBe(normalizePostKey('https://t.co/abc'));
    expect(normalizePostKey('https://www.threads.net/@u/post/C1a2B3')).not.toBe(
      normalizePostKey('https://www.threads.net/@u/post/c1a2b3'),
    );
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
