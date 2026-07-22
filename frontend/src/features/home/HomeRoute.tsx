import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { createKeywordAnalysis, type CreateKeywordAnalysisBody } from '../../api/keywordAnalyses';
import { appendDedupedSeeds } from '../../lib/aiIdeation';
import { checkValidity, mapFieldErrors, parseSeeds } from '../../lib/createAnalysisForm';
import { AnalysisDashboard } from '../dashboard/AnalysisDashboard';
import { AiIdeationCard } from './AiIdeationCard';

/**
 * Create-analysis home form — v4 keyword-pool layout (T7.2, FR-2 / TC-57; re-align
 * of T1.2). A thin container over the pure `lib/createAnalysisForm` helpers (seeds
 * parse / validity gate / field-error mapping) + the typed `api/keywordAnalyses`
 * egress (Design §3). On 202 it navigates with the new `analysisId` in the URL
 * search params (Design §5 — URL is state); the progress rendering itself is T1.3.
 *
 * **v4 alignment (match layout / keep real inputs, Design §15).** The wide centred
 * keyword-pool card exposes only 輸入搜尋詞 (seeds) up front; geo / language /
 * network / includeAdult collapse behind a ⚙ 齒輪「進階選項」 toggle **without
 * relaxing validation** (geo / language stay required — a collapsed-but-empty pair
 * keeps the CTA disabled, and a backend 400 on a collapsed field auto-expands the
 * section so the inline error is never hidden). 探索模式 is a pills pair
 * (指定=exact〔v4 default〕 / 拓展=expand — values/semantics unchanged). Import
 * From GAD/GSC are disabled roadmap chips (NG3): clicking shows 即將推出 and fires
 * **no** request. Tokens only (no hardcoded hex).
 *
 * No TanStack Query here (that lands in T1.3 for job tracking) — the POST is a
 * plain async handler with local loading / error state.
 */

type Mode = 'expand' | 'exact';
type Network = 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';

/** Advanced (collapsed) fields — a 400 on any of these auto-expands the section. */
const ADVANCED_FIELDS = new Set(['geo', 'language', 'network', 'includeAdult']);

const FIELD_LABEL = 'block text-sm font-medium text-white/80';
const TEXT_INPUT =
  'mt-1 w-full rounded-lg bg-bg-input px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-brand';
const IMPORT_CHIP =
  'rounded-lg bg-bg-input px-3 py-1.5 text-xs text-white/40 ring-1 ring-white/10 hover:text-white/60';

/** Explore-mode helper copy (updates with the selected pill; v4 `#exploreModeHelperA`). */
const MODE_HELPER: Readonly<Record<Mode, string>> = {
  exact: '精準分析上方輸入的搜尋詞，不額外新增字詞。',
  expand: '系統將依輸入的搜尋詞擴充相關關鍵字。',
};

export function HomeRoute() {
  const navigate = useNavigate();
  const analysisId = useSearch({ strict: false, select: (s) => s.analysisId });

  const [seedsRaw, setSeedsRaw] = useState('');
  const [geo, setGeo] = useState('');
  const [language, setLanguage] = useState('');
  const [mode, setMode] = useState<Mode>('exact');
  const [network, setNetwork] = useState<Network>('GOOGLE_SEARCH');
  const [includeAdult, setIncludeAdult] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [importHint, setImportHint] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const validity = checkValidity({ seedsRaw, geo, language });
  const ctaDisabled = !validity.isSubmittable || submitting;

  async function handleSubmit() {
    if (!validity.isSubmittable) return;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    const requestBody: CreateKeywordAnalysisBody = {
      seeds: parseSeeds(seedsRaw),
      geo: geo.trim(),
      language: language.trim(),
      mode,
      network,
      includeAdult,
    };

    const result = await createKeywordAnalysis(requestBody);
    if (result.ok) {
      // Carry the analysis (geo, language) context in the URL alongside `analysisId`
      // (Design §5) so the ready 搜尋詞總表 can seed list-layer-fixed tracking
      // selections (FR-19) without a per-row backend field.
      await navigate({
        to: '/',
        search: (prev) => ({
          ...prev,
          analysisId: result.analysisId,
          geo: requestBody.geo,
          language: requestBody.language,
        }),
      });
      return;
    }

    setSubmitting(false);
    const mapped = mapFieldErrors(result.error?.fields);
    if (Object.keys(mapped).length > 0) {
      setFieldErrors(mapped);
      // A field error on a collapsed advanced field must never be hidden — expand
      // the section so the inline error is visible (AC-2.2).
      if (Object.keys(mapped).some((f) => ADVANCED_FIELDS.has(f))) setAdvancedOpen(true);
    } else {
      setFormError('建立分析失敗，請稍後再試。');
    }
  }

  if (analysisId) {
    // URL carries an analysis → the dashboard resolves the active `view` to content
    // (running → job progress; ready → per-view content, T6.0/FR-1). The create form
    // itself only shows when no analysis is in the URL.
    return <AnalysisDashboard analysisId={analysisId} />;
  }

  // CTA gate hint: name the still-missing required fields; when a missing field lives
  // in the collapsed advanced section, point the user at the ⚙ toggle (AC-2.2).
  const missing: string[] = [];
  if (!validity.fields.seeds) missing.push('搜尋詞');
  if (!validity.fields.geo) missing.push('地區');
  if (!validity.fields.language) missing.push('語言');
  const missingInAdvanced = !advancedOpen && (!validity.fields.geo || !validity.fields.language);
  const ctaHint =
    missing.length > 0
      ? `請完成：${missing.join(' / ')}${missingInAdvanced ? '（於進階選項 ⚙）' : ''}`
      : null;

  return (
    <section aria-labelledby="home-heading" className="mx-auto max-w-3xl">
      <h2 id="home-heading" className="sr-only">
        關鍵字分析
      </h2>

      {/* Keyword-pool card: 輸入搜尋詞 + ⚙ advanced + Import roadmap chips + inline AI 發想. */}
      <div className="rounded-2xl bg-bg-card p-6 shadow-lg ring-1 ring-white/10">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="seeds" className="text-base font-bold text-white/90">
              輸入搜尋詞
            </label>
            <button
              type="button"
              aria-label="進階選項"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((o) => !o)}
              className="rounded-md p-1.5 text-white/50 hover:bg-white/5 hover:text-white"
            >
              <GearIcon />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setImportHint(true)} className={IMPORT_CHIP}>
              Import From GAD
            </button>
            <button type="button" onClick={() => setImportHint(true)} className={IMPORT_CHIP}>
              Import From GSC
            </button>
          </div>
        </div>

        {importHint ? (
          <p role="status" className="mb-3 text-xs text-white/50">
            即將推出
          </p>
        ) : null}

        <form
          aria-label="建立分析"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <textarea
            id="seeds"
            rows={10}
            value={seedsRaw}
            onChange={(e) => setSeedsRaw(e.target.value)}
            aria-invalid={fieldErrors.seeds ? true : undefined}
            aria-describedby={fieldErrors.seeds ? 'seeds-error' : undefined}
            className={`${TEXT_INPUT} resize-y`}
            placeholder={'請輸入搜尋詞，可用逗號或換行分隔，例如：\n無線吸塵器, 掃地機器人\n吸塵器推薦'}
          />
          <FieldErrors id="seeds-error" messages={fieldErrors.seeds} />

          {advancedOpen ? (
            <fieldset className="mt-5 flex flex-col gap-5 rounded-xl bg-bg-input/40 p-4">
              <legend className="px-1 text-xs font-semibold text-white/50">
                進階選項（Google Ads 參數）
              </legend>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="geo" className={FIELD_LABEL}>
                    地區 (geo)
                  </label>
                  <input
                    id="geo"
                    type="text"
                    value={geo}
                    onChange={(e) => setGeo(e.target.value)}
                    aria-invalid={fieldErrors.geo ? true : undefined}
                    aria-describedby={fieldErrors.geo ? 'geo-error' : undefined}
                    className={TEXT_INPUT}
                    placeholder="TW"
                  />
                  <FieldErrors id="geo-error" messages={fieldErrors.geo} />
                </div>
                <div>
                  <label htmlFor="language" className={FIELD_LABEL}>
                    語言 (language)
                  </label>
                  <input
                    id="language"
                    type="text"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    aria-invalid={fieldErrors.language ? true : undefined}
                    aria-describedby={fieldErrors.language ? 'language-error' : undefined}
                    className={TEXT_INPUT}
                    placeholder="zh-TW"
                  />
                  <FieldErrors id="language-error" messages={fieldErrors.language} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="network" className={FIELD_LABEL}>
                    搜尋網路 (network)
                  </label>
                  <select
                    id="network"
                    value={network}
                    onChange={(e) => setNetwork(e.target.value as Network)}
                    className={TEXT_INPUT}
                  >
                    <option value="GOOGLE_SEARCH">Google 搜尋</option>
                    <option value="GOOGLE_SEARCH_AND_PARTNERS">Google 搜尋 + 夥伴</option>
                  </select>
                </div>
                <label className="flex items-end gap-2 text-sm text-white/80">
                  <input
                    type="checkbox"
                    checked={includeAdult}
                    onChange={(e) => setIncludeAdult(e.target.checked)}
                    className="mb-2 accent-brand"
                  />
                  包含成人內容 (includeAdult)
                </label>
              </div>
            </fieldset>
          ) : null}
        </form>

        <AiIdeationCard
          seeds={parseSeeds(seedsRaw)}
          onGenerated={(keywords) =>
            setSeedsRaw((prev) => appendDedupedSeeds(parseSeeds(prev), keywords).join('\n'))
          }
        />
      </div>

      {/* 探索模式 pills (指定=exact 〔v4 default〕 / 拓展=expand). */}
      <fieldset className="mt-8">
        <legend className={FIELD_LABEL}>
          探索模式 <span className="text-white/40">（單選）</span>
        </legend>
        <div className="mt-3 flex gap-3">
          {(['exact', 'expand'] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(m)}
                className={
                  active
                    ? 'rounded-lg border border-brand/50 bg-brand/10 px-4 py-2 text-sm font-medium text-brand'
                    : 'rounded-lg px-4 py-2 text-sm text-white/60 ring-1 ring-white/10 hover:text-white'
                }
              >
                {m === 'exact' ? '指定模式' : '拓展模式'}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[13px] text-white/50">{MODE_HELPER[mode]}</p>
      </fieldset>

      {formError ? (
        <p role="alert" className="mt-6 text-center text-sm text-trend-negative">
          {formError}
        </p>
      ) : null}

      {/* Centred CTA — type="button" (fires handleSubmit); the form's onSubmit covers Enter. */}
      <div className="mt-8 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={ctaDisabled}
          className="h-12 w-80 rounded-lg bg-brand text-base font-semibold text-bg-body enabled:hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? '建立中…' : '開始分析'}
        </button>
        {ctaHint ? <p className="text-xs text-white/40">{ctaHint}</p> : null}
      </div>
    </section>
  );
}

/** Inline gear affordance for the 進階選項 toggle (decorative; the button is labelled). */
function GearIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <circle cx="12" cy="12" r="3" strokeWidth="2" />
    </svg>
  );
}

/** Inline per-field error list (accessible via `role="alert"`; nothing when empty). */
function FieldErrors({ id, messages }: { id: string; messages: string[] | undefined }) {
  if (!messages || messages.length === 0) return null;
  return (
    <ul id={id} role="alert" className="mt-1 flex flex-col gap-0.5 text-xs text-trend-negative">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}
