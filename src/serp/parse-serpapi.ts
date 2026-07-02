import type { SerpApiResponse } from './serp-api.types';
import type { SerpResult } from './serp.types';

/** 由 URL 萃取 domain（host）；非法 URL → 空字串（不拋）。 */
export function deriveDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * 解析 serpapi 回應 → 中立 `SerpResult`（T8.3，FR-15）。純函式：organic 取前 `topN`（position 缺則以序號補、
 * domain 由 link 萃取）、PAA（related_questions.question）、related（related_searches.query），皆濾掉空值。
 */
export function parseSerpApiResponse(response: SerpApiResponse, topN: number): SerpResult {
  const organic = (response.organic_results ?? []).slice(0, topN).map((result, index) => ({
    position: result.position ?? index + 1,
    title: result.title ?? '',
    url: result.link ?? '',
    snippet: result.snippet ?? '',
    domain: result.link ? deriveDomain(result.link) : '',
  }));

  const paa = (response.related_questions ?? [])
    .map((question) => question.question)
    .filter((question): question is string => Boolean(question));
  const related = (response.related_searches ?? [])
    .map((search) => search.query)
    .filter((query): query is string => Boolean(query));

  return {
    organic,
    ...(paa.length > 0 ? { paa } : {}),
    ...(related.length > 0 ? { related } : {}),
  };
}
