import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { createKeywordAnalysis, type CreateKeywordAnalysisBody } from '../../api/keywordAnalyses';
import { appendDedupedSeeds } from '../../lib/aiIdeation';
import { checkValidity, mapFieldErrors, parseSeeds } from '../../lib/createAnalysisForm';
import { useAnalysisSettingsStore } from '../../stores/analysisSettingsStore';
import { AnalysisDashboard } from '../dashboard/AnalysisDashboard';
import { AiIdeationCard } from './AiIdeationCard';
import { TrackingContinueSection } from './TrackingContinueSection';

/**
 * Create-analysis home form — v4 slim keyword-pool layout (T7.10, FR-2 修訂
 * 2026-07-23 第二次; re-align of T7.2). The input screen now shows ONLY the 輸入搜尋詞
 * pool (+ explore-mode pills + inline AI 發想) — `geo` / `language` are adopted from the
 * top-nav 分析設定 (`analysisSettingsStore`, T7.9; persisted, defaults `TW` / `zh-TW`),
 * and `network` / `includeAdult` are FIXED (`GOOGLE_SEARCH_AND_PARTNERS` / `true`). So
 * the ⚙ 進階選項 gear, the geo/language/network/includeAdult inputs, and the Import
 * GAD/GSC chips are all removed. On 202 it navigates with the new `analysisId` in the
 * URL (Design §5). Tokens only (no hardcoded hex).
 */

type Mode = 'expand' | 'exact';

/** Fixed create-analysis inputs no longer surfaced in the UI (FR-2 修訂 c). */
const FIXED_NETWORK = 'GOOGLE_SEARCH_AND_PARTNERS' as const;
const FIXED_INCLUDE_ADULT = true;

const FIELD_LABEL = 'block text-sm font-medium text-white/80';
const TEXT_INPUT =
  'mt-1 w-full rounded-lg bg-bg-input px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-brand';

/** Explore-mode helper copy (updates with the selected pill; v4 `#exploreModeHelperA`). */
const MODE_HELPER: Readonly<Record<Mode, string>> = {
  exact: '精準分析上方輸入的搜尋詞，不額外新增字詞。',
  expand: '系統將依輸入的搜尋詞擴充相關關鍵字。',
};

export function HomeRoute() {
  const navigate = useNavigate();
  const analysisId = useSearch({ strict: false, select: (s) => s.analysisId });

  // geo/language come from the persisted top-nav settings (T7.9), not the form.
  const geo = useAnalysisSettingsStore((s) => s.geo);
  const language = useAnalysisSettingsStore((s) => s.language);
  const setGeo = useAnalysisSettingsStore((s) => s.setGeo);
  const setLanguage = useAnalysisSettingsStore((s) => s.setLanguage);

  const [seedsRaw, setSeedsRaw] = useState('');
  const [mode, setMode] = useState<Mode>('exact');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // geo/language are always present (settings default TW/zh-TW), so the CTA gate reduces
  // to "seeds non-empty" — but we reuse the pure validity helper for the single source.
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
      network: FIXED_NETWORK,
      includeAdult: FIXED_INCLUDE_ADULT,
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

  const ctaHint = validity.fields.seeds ? null : '請完成：搜尋詞';

  return (
    <section aria-labelledby="home-heading" className="mx-auto max-w-3xl">
      <h2 id="home-heading" className="sr-only">
        關鍵字分析
      </h2>

      {/* 從追蹤清單繼續 (T7.7): hidden when the owner has no lists / the read fails. Continuing
          loads that list's members as seeds (C7-deduped) + adopts its geo/language settings. */}
      <TrackingContinueSection
        onContinue={(loadedSeeds, listGeo, listLanguage) => {
          setSeedsRaw((prev) => appendDedupedSeeds(parseSeeds(prev), loadedSeeds).join('\n'));
          setGeo(listGeo);
          setLanguage(listLanguage);
        }}
        onSeeMore={() => void navigate({ to: '/tracking' })}
      />

      {/* Keyword-pool card: 輸入搜尋詞 + inline AI 發想 (no gear / no advanced / no Import). */}
      <div className="rounded-2xl bg-bg-card p-6 shadow-lg ring-1 ring-white/10">
        <label htmlFor="seeds" className="mb-4 block text-base font-bold text-white/90">
          輸入搜尋詞
        </label>

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
            placeholder={
              '請輸入搜尋詞，可用逗號或換行分隔，例如：\n無線吸塵器, 掃地機器人\n吸塵器推薦'
            }
          />
          <FieldErrors id="seeds-error" messages={fieldErrors.seeds} />
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
