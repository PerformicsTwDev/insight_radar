import { parseConfig } from './env';

describe('config env schema (VITE_ · §14, fail-fast)', () => {
  it('applies defaults when vars are absent', () => {
    const c = parseConfig({});
    expect(c.apiBaseUrl).toBe('');
    expect(c.authProvider).toBe('session');
    expect(c.trendStableMax).toBe(5);
    expect(c.trendSurgeMin).toBe(20);
    expect(c.defaultPageSize).toBe(25);
    expect(c.maxPageSize).toBe(100);
    expect(c.offsetMaxPage).toBe(40);
    expect(c.trackingDefaultRange).toBe('12M');
    expect(c.aiChannels).toEqual(['AI Overview', 'AI Mode', 'Gemini', 'ChatGPT']);
  });

  it('parses VITE_AI_CHANNELS as a trimmed, order-preserving, non-empty CSV', () => {
    expect(parseConfig({ VITE_AI_CHANNELS: 'ChatGPT, Gemini ,, ' }).aiChannels).toEqual([
      'ChatGPT',
      'Gemini',
    ]);
  });

  it('parses & coerces provided values', () => {
    const c = parseConfig({
      VITE_API_BASE_URL: 'https://api.example.com',
      VITE_AUTH_PROVIDER: 'apiKey',
      VITE_DEFAULT_PAGE_SIZE: '50',
      VITE_TRACKING_DEFAULT_RANGE: '6M',
    });
    expect(c.apiBaseUrl).toBe('https://api.example.com');
    expect(c.authProvider).toBe('apiKey');
    expect(c.defaultPageSize).toBe(50);
    expect(c.trackingDefaultRange).toBe('6M');
  });

  it('fail-fasts on a non-numeric number value', () => {
    expect(() => parseConfig({ VITE_TREND_STABLE_MAX: 'abc' })).toThrow(/Invalid VITE_ config/);
  });

  it('fail-fasts on an invalid enum value', () => {
    expect(() => parseConfig({ VITE_AUTH_PROVIDER: 'oauth' })).toThrow(/Invalid VITE_ config/);
    expect(() => parseConfig({ VITE_TRACKING_DEFAULT_RANGE: '3M' })).toThrow(
      /Invalid VITE_ config/,
    );
  });
});
