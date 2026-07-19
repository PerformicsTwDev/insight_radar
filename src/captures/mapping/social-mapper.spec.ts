import type { MapperInput } from './canonical.types';
import { mapSocialPost } from './social-mapper';

const capturedAt = new Date('2025-11-21T00:00:00.000Z');

function socialInput(payload: unknown, overrides: Partial<MapperInput> = {}): MapperInput {
  return {
    source: 'extension',
    platform: 'threads',
    schemaVersion: 'v1',
    payload,
    capturedAt,
    ...overrides,
  };
}

describe('mapSocialPost (FR-37/46/51 → SocialPost 中立形狀)', () => {
  it('完整代表輸入 → ok：欄位收斂 + 計數(8K→8000) + 中文時間 → ISO + postKey', () => {
    const result = mapSocialPost(
      socialInput({
        author: 'u',
        content: 'hello',
        permalink: 'https://threads.net/@u/p/1',
        publishedAt: '2025年11月21日 上午2:01',
        likesCount: '8K',
        commentsCount: 12,
        shareCount: '1.2K',
      }),
    );
    expect(result.mapStatus).toBe('ok');
    expect(result.reasons).toEqual([]);
    expect(result.canonical).toEqual({
      source: 'extension',
      platform: 'threads',
      schemaVersion: 'v1',
      postKey: 'https://threads.net/@u/p/1',
      author: 'u',
      profileLink: null,
      content: 'hello',
      publishedAt: '2025-11-21T02:01:00+08:00',
      likes: 8000,
      comments: 12,
      reposts: null,
      shares: 1200,
      capturedAt: '2025-11-21T00:00:00.000Z',
    });
  });

  it('author 異名欄位收斂（channelName / name）', () => {
    expect(
      mapSocialPost(socialInput({ channelName: 'chan', content: 'x', url: 'https://a/b' }))
        .canonical?.author,
    ).toBe('chan');
    expect(
      mapSocialPost(socialInput({ name: 'nm', content: 'x', link: 'https://a/b' })).canonical
        ?.author,
    ).toBe('nm');
  });

  it('metrics 缺 → null（S14 缺值≠0），非 issue', () => {
    const result = mapSocialPost(socialInput({ content: 'x', permalink: 'https://a/b' }));
    expect(result.mapStatus).toBe('ok');
    expect(result.canonical).toMatchObject({
      likes: null,
      comments: null,
      reposts: null,
      shares: null,
    });
  });

  it('缺 content → failed（核心欄缺、canonical null、raw 保留）', () => {
    const payload = { permalink: 'https://a/b' };
    const result = mapSocialPost(socialInput(payload));
    expect(result.mapStatus).toBe('failed');
    expect(result.canonical).toBeNull();
    expect(result.reasons).toContain('missing:content');
    expect(result.raw).toBe(payload);
  });

  it('缺 permalink/url（無 postKey）→ failed（無去重鍵）', () => {
    const result = mapSocialPost(socialInput({ content: 'x' }));
    expect(result.mapStatus).toBe('failed');
    expect(result.reasons).toContain('missing:postKey');
  });

  it('未知欄位 → partial（漂移預警）', () => {
    const result = mapSocialPost(
      socialInput({ content: 'x', permalink: 'https://a/b', mystery: 1 }),
    );
    expect(result.mapStatus).toBe('partial');
    expect(result.reasons).toContain('unknown_field:mystery');
  });

  it('publishedAt 缺 → null 且非 issue；present 但不可解析 → partial + null', () => {
    const absent = mapSocialPost(socialInput({ content: 'x', permalink: 'https://a/b' }));
    expect(absent.canonical?.publishedAt).toBeNull();
    expect(absent.reasons).not.toContain('unparseable:publishedAt');

    const bad = mapSocialPost(
      socialInput({ content: 'x', permalink: 'https://a/b', publishedAt: 'garbage' }),
    );
    expect(bad.mapStatus).toBe('partial');
    expect(bad.canonical?.publishedAt).toBeNull();
    expect(bad.reasons).toContain('unparseable:publishedAt');
  });

  it('metric present 但不可解析 → partial + null（不補 0）', () => {
    const result = mapSocialPost(
      socialInput({ content: 'x', permalink: 'https://a/b', likesCount: 'abc' }),
    );
    expect(result.mapStatus).toBe('partial');
    expect(result.canonical?.likes).toBeNull();
    expect(result.reasons).toContain('unparseable:likes');
  });

  it('payload 非物件 → failed（payload_not_object、raw 保留）', () => {
    const result = mapSocialPost(socialInput(['array']));
    expect(result.mapStatus).toBe('failed');
    expect(result.canonical).toBeNull();
    expect(result.reasons).toContain('payload_not_object');
  });

  it('缺 platform（未經 registry 分派）→ failed', () => {
    const result = mapSocialPost(
      socialInput({ content: 'x', permalink: 'https://a/b' }, { platform: undefined }),
    );
    expect(result.mapStatus).toBe('failed');
    expect(result.reasons).toContain('missing_platform');
  });
});
