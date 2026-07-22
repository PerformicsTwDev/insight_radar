import type { components } from '../api/schema';
import { appendDedupedSeeds } from './aiIdeation';
import { parseSeeds } from './createAnalysisForm';

/**
 * Pure AI-Search-home form helpers (T8.1, FR-22/FR-23). **No React / no IO** → core
 * `src/lib/**` (≥90% coverage gate). The React shells (`features/aiSearch/*`) are
 * thin containers over these; the validity gate mirrors the v4 `updateStartButtons`
 * (Search Insight and AI Insight_v4.html `#view-home-b`): 品牌名 + ≥1 別名 + ≥1 網站
 * are always required; 搜尋詞 only in 指定模式; ≥1 抓取渠道 always.
 */

/** AI-line explore mode (single-select pills). Distinct from the Search line's expand/exact. */
export type ExploreMode = 'brand' | 'specified';

/** Backend AI capture-channel enum (contract-bound; drift → compile error). */
export type AiChannel = components['schemas']['CreateAiSearchAnalysisDto']['channels'][number];

export interface AiChannelOption {
  readonly value: AiChannel;
  readonly label: string;
}

/**
 * The four v4 抓取渠道, mapped **bijectively onto the extension-primary channels**
 * (`chatGpt / geminiApp / googleAiMode / googleSearch`). extension is the primary
 * pipeline for every AI line (project invariant v3.4); the SerpAPI enums
 * (`aiOverview / aiMode / bingCopilot`) are reserved (disabled by default), so the
 * default UX never routes to a reserved source. AI Overview shows on the Google
 * Search page → captured by the `googleSearch` extension channel.
 */
export const AI_CHANNEL_OPTIONS: readonly AiChannelOption[] = [
  { value: 'googleSearch', label: 'AI Overview' },
  { value: 'googleAiMode', label: 'AI Mode' },
  { value: 'geminiApp', label: 'Gemini' },
  { value: 'chatGpt', label: 'ChatGPT' },
];

export interface ExploreModeOption {
  readonly value: ExploreMode;
  readonly label: string;
}

export const EXPLORE_MODE_OPTIONS: readonly ExploreModeOption[] = [
  { value: 'brand', label: '品牌整體模式' },
  { value: 'specified', label: '指定模式' },
];

/** One competitor row (v4 `競品`): 名稱 + 別名 chips + 網站 chips. */
export interface CompetitorEntry {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly sites: readonly string[];
}

/** Brand-profile card state (v4 `#brandOverallForm`). */
export interface BrandFormState {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly sites: readonly string[];
  readonly competitors: readonly CompetitorEntry[];
}

/** Whole AI-search-home form state. */
export interface AiSearchFormState {
  readonly exploreMode: ExploreMode;
  readonly brand: BrandFormState;
  readonly channels: readonly AiChannel[];
  readonly seedsRaw: string;
}

export const EMPTY_COMPETITOR: CompetitorEntry = { name: '', aliases: [], sites: [] };

export const EMPTY_BRAND: BrandFormState = { name: '', aliases: [], sites: [], competitors: [] };

export const INITIAL_AI_SEARCH_FORM: AiSearchFormState = {
  exploreMode: 'brand',
  brand: EMPTY_BRAND,
  channels: [],
  seedsRaw: '',
};

/** ✦ AI 補全 is enabled only once a non-blank brand name is entered (AC-22.1). */
export function canBrandAssist(name: string): boolean {
  return name.trim().length > 0;
}

/**
 * Ordered list of what is still missing (drives the CTA hint, mirroring the v4
 * `updateStartButtons`): 品牌名 → 品牌別名 → 品牌網站 → (指定模式) 搜尋詞 → 抓取渠道.
 */
export function missingAiSearchFields(state: AiSearchFormState): string[] {
  const missing: string[] = [];
  if (state.brand.name.trim().length === 0) missing.push('品牌名');
  if (state.brand.aliases.length === 0) missing.push('品牌別名');
  if (state.brand.sites.length === 0) missing.push('品牌網站');
  if (state.exploreMode === 'specified' && parseSeeds(state.seedsRaw).length === 0) {
    missing.push('搜尋詞');
  }
  if (state.channels.length === 0) missing.push('至少一個抓取渠道');
  return missing;
}

/** All required fields present → the CTA may fire the create flow. */
export function isAiSearchSubmittable(state: AiSearchFormState): boolean {
  return missingAiSearchFields(state).length === 0;
}

/** Multi-select toggle for a channel, order-stable (append on add, filter on remove). */
export function toggleChannel(channels: readonly AiChannel[], channel: AiChannel): AiChannel[] {
  return channels.includes(channel)
    ? channels.filter((c) => c !== channel)
    : [...channels, channel];
}

export type CreateBrandProfileBody = components['schemas']['CreateBrandProfileDto'];

/**
 * Brand-form state → the `CreateBrandProfileDto` (POST /brand-profiles) body: trims
 * the brand name, drops competitor rows whose name is blank (a half-typed row is not
 * a competitor), and trims kept competitor names. Alias/site chips are already
 * de-duped at the UI add-point (C7), so they pass through verbatim.
 */
export function toBrandProfilePayload(brand: BrandFormState): CreateBrandProfileBody {
  return {
    brand: {
      name: brand.name.trim(),
      aliases: [...brand.aliases],
      sites: [...brand.sites],
    },
    competitors: brand.competitors
      .filter((c) => c.name.trim().length > 0)
      .map((c) => ({ name: c.name.trim(), aliases: [...c.aliases], sites: [...c.sites] })),
  };
}

/**
 * The `keywords` for `POST /ai-search-analyses` (backend requires ArrayNotEmpty):
 * - 指定模式 → the parsed 搜尋詞 textarea.
 * - 品牌整體模式 → the brand + competitor universe (name + aliases), de-duped by the
 *   canonical C7 key so `Dyson`/`DYSON` collapse. The brand name is always present
 *   in this mode (gated by {@link missingAiSearchFields}), so the list is never empty.
 */
export function aiSearchKeywords(state: AiSearchFormState): string[] {
  if (state.exploreMode === 'specified') return parseSeeds(state.seedsRaw);
  const universe = [
    state.brand.name,
    ...state.brand.aliases,
    ...state.brand.competitors.flatMap((c) => [c.name, ...c.aliases]),
  ];
  return appendDedupedSeeds([], universe);
}
