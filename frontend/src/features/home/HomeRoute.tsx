import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { createKeywordAnalysis, type CreateKeywordAnalysisBody } from '../../api/keywordAnalyses';
import { checkValidity, mapFieldErrors, parseSeeds } from '../../lib/createAnalysisForm';

/**
 * Create-analysis home form (T1.2, FR-2). A thin container over the pure
 * `lib/createAnalysisForm` helpers (seeds parse / validity gate / field-error
 * mapping) + the typed `api/keywordAnalyses` egress (Design §3). On 202 it
 * navigates with the new `analysisId` in the URL search params (Design §5 —
 * URL is state); the progress rendering itself is T1.3, so this route just shows
 * a placeholder once `analysisId` is present. Tokens only (no hardcoded hex).
 *
 * No TanStack Query here (that lands in T1.3 for job tracking) — the POST is a
 * plain async handler with local loading / error state.
 */

type Mode = 'expand' | 'exact';
type Network = 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';

const FIELD_LABEL = 'block text-sm font-medium text-white/80';
const TEXT_INPUT =
  'mt-1 w-full rounded-lg bg-bg-input px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-brand';

export function HomeRoute() {
  const navigate = useNavigate();
  const analysisId = useSearch({ strict: false, select: (s) => s.analysisId });

  const [seedsRaw, setSeedsRaw] = useState('');
  const [geo, setGeo] = useState('');
  const [language, setLanguage] = useState('');
  const [mode, setMode] = useState<Mode>('expand');
  const [network, setNetwork] = useState<Network>('GOOGLE_SEARCH');
  const [includeAdult, setIncludeAdult] = useState(false);
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
      await navigate({ to: '/', search: (prev) => ({ ...prev, analysisId: result.analysisId }) });
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
    return (
      <section aria-labelledby="home-heading" className="max-w-2xl rounded-2xl bg-bg-card p-6">
        <h2 id="home-heading" className="text-xl font-semibold">
          關鍵字分析
        </h2>
        <p className="mt-2 text-sm text-white/60">分析已建立 · 進度將於 T1.3 上線。</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="home-heading" className="max-w-2xl rounded-2xl bg-bg-card p-6">
      <h2 id="home-heading" className="text-xl font-semibold">
        關鍵字分析
      </h2>
      <p className="mt-2 text-sm text-white/60">輸入種子關鍵字建立一份新的分析。</p>

      <form
        aria-label="建立分析"
        className="mt-6 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <div>
          <label htmlFor="seeds" className={FIELD_LABEL}>
            種子關鍵字
          </label>
          <p className="mt-1 text-xs text-white/40">以換行或逗號分隔，至少一個。</p>
          <textarea
            id="seeds"
            rows={4}
            value={seedsRaw}
            onChange={(e) => setSeedsRaw(e.target.value)}
            aria-invalid={fieldErrors.seeds ? true : undefined}
            aria-describedby={fieldErrors.seeds ? 'seeds-error' : undefined}
            className={TEXT_INPUT}
            placeholder={'running shoes\ntrail shoes'}
          />
          <FieldErrors id="seeds-error" messages={fieldErrors.seeds} />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={FIELD_LABEL}>擴充模式</legend>
          <div className="flex gap-4">
            {(['expand', 'exact'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="accent-brand"
                />
                {m === 'expand' ? '擴充 (expand)' : '精準 (exact)'}
              </label>
            ))}
          </div>
        </fieldset>

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

        {formError ? (
          <p role="alert" className="text-sm text-trend-negative">
            {formError}
          </p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={ctaDisabled}
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-bg-body enabled:hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? '建立中…' : '建立分析'}
          </button>
        </div>
      </form>
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
