import { deriveDomain, parseSerpApiResponse } from './parse-serpapi';
import type { SerpApiResponse } from './serp-api.types';

const GOLDEN: SerpApiResponse = {
  organic_results: [
    {
      position: 1,
      title: 'Best coffee makers',
      link: 'https://www.wirecutter.com/coffee',
      snippet: 'Top picks.',
    },
    {
      position: 2,
      title: 'How to brew',
      link: 'https://coffee.example.co.uk/brew',
      snippet: 'A guide.',
    },
    { position: 3, title: 'Third', link: 'https://third.com/x', snippet: 'x' },
  ],
  related_questions: [{ question: 'What is the best coffee?' }, { question: 'How much caffeine?' }],
  related_searches: [{ query: 'coffee beans' }, { query: 'coffee grinder' }],
};

describe('parseSerpApiResponse (T8.3 / TC-47 parse)', () => {
  it('maps organic (link→url, host→domain), PAA, and related', () => {
    const out = parseSerpApiResponse(GOLDEN, 5);

    expect(out.organic[0]).toEqual({
      position: 1,
      title: 'Best coffee makers',
      url: 'https://www.wirecutter.com/coffee',
      snippet: 'Top picks.',
      domain: 'www.wirecutter.com',
    });
    expect(out.organic[1].domain).toBe('coffee.example.co.uk');
    expect(out.paa).toEqual(['What is the best coffee?', 'How much caffeine?']);
    expect(out.related).toEqual(['coffee beans', 'coffee grinder']);
  });

  it('truncates organic to topN', () => {
    const out = parseSerpApiResponse(GOLDEN, 2);
    expect(out.organic).toHaveLength(2);
    expect(out.organic.map((o) => o.position)).toEqual([1, 2]);
  });

  it('fills missing position with the 1-based index and missing text with empty strings', () => {
    const out = parseSerpApiResponse({ organic_results: [{ link: 'https://a.com' }] }, 5);
    expect(out.organic[0]).toEqual({
      position: 1,
      title: '',
      url: 'https://a.com',
      snippet: '',
      domain: 'a.com',
    });
  });

  it('returns empty organic and omits paa/related for an empty response', () => {
    const out = parseSerpApiResponse({}, 5);
    expect(out).toEqual({ organic: [] });
    expect(out.paa).toBeUndefined();
    expect(out.related).toBeUndefined();
  });

  it('filters out empty PAA/related entries', () => {
    const out = parseSerpApiResponse(
      { related_questions: [{ question: '' }, { question: 'q' }], related_searches: [{}] },
      5,
    );
    expect(out.paa).toEqual(['q']);
    expect(out.related).toBeUndefined(); // 全空 → 略
  });

  it('deriveDomain returns host, or empty string for an invalid URL', () => {
    expect(deriveDomain('https://sub.example.com/p?q=1')).toBe('sub.example.com');
    expect(deriveDomain('not a url')).toBe('');
  });
});
