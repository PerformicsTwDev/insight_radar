import { parseCookies } from './cookie.util';

/** TC-59（FR-24）支援：session cookie header 解析（logout/me 讀 sid）——分支全覆蓋。 */
describe('parseCookies (auth cookie util)', () => {
  it('header 缺（undefined）→ 空物件', () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it('空字串 → 空物件', () => {
    expect(parseCookies('')).toEqual({});
  });

  it('單一 cookie', () => {
    expect(parseCookies('sid=abc123')).toEqual({ sid: 'abc123' });
  });

  it('多個 cookie（以 ; 分隔、去空白）', () => {
    expect(parseCookies('sid=abc123; theme=dark ; lang=zh-TW')).toEqual({
      sid: 'abc123',
      theme: 'dark',
      lang: 'zh-TW',
    });
  });

  it('略過無 = 的畸形片段', () => {
    expect(parseCookies('garbage; sid=xyz')).toEqual({ sid: 'xyz' });
  });

  it('略過名稱為空的片段（=value）', () => {
    expect(parseCookies('=orphan; sid=ok')).toEqual({ sid: 'ok' });
  });

  it('保留值中的 = （base64url/padding 等）', () => {
    expect(parseCookies('sid=a=b=c')).toEqual({ sid: 'a=b=c' });
  });
});
