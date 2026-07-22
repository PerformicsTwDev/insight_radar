import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { createAiSearchAnalysis } from '../../api/aiSearchAnalyses';
import { createBrandProfile } from '../../api/brandProfiles';
import { SegmentedControl } from '../../components/SegmentedControl';
import { useInFlightGuard } from '../../hooks/useInFlightGuard';
import { appendDedupedSeeds } from '../../lib/aiIdeation';
import {
  AI_CHANNEL_OPTIONS,
  EXPLORE_MODE_OPTIONS,
  INITIAL_AI_SEARCH_FORM,
  aiSearchKeywords,
  isAiSearchSubmittable,
  missingAiSearchFields,
  toBrandProfilePayload,
  toggleChannel,
  type AiSearchFormState,
  type ExploreMode,
} from '../../lib/aiSearchForm';
import { parseSeeds } from '../../lib/createAnalysisForm';
import { AiIdeationCard } from '../home/AiIdeationCard';
import { BrandProfileForm } from './BrandProfileForm';

/**
 * AI Search Insight home (T8.1, FR-22/FR-23; v4 `#view-home-b`). A thin container
 * over the pure `lib/aiSearchForm` gate + the typed `brandProfiles` / `aiSearchAnalyses`
 * egress (Design §16 — the AI line reuses the async create + URL-is-state, no parallel
 * machinery). Submit = create the BrandProfile then enqueue the capture job; on 202 it
 * navigates with the new `jobId` in the URL (job tracking itself is T8.2). Tokens only.
 */

const CHANNEL_BTN_BASE =
  'rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors disabled:cursor-not-allowed';
const CHANNEL_ON = 'bg-brand/15 text-white ring-brand/50';
const CHANNEL_OFF = 'text-white/70 ring-white/15 hover:ring-white/30';
const PRIMARY_BTN =
  'rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-bg-body enabled:hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40';

export function AiSearchHome() {
  const navigate = useNavigate();
  const jobId = useSearch({ strict: false, select: (s) => s.jobId });

  const [form, setForm] = useState<AiSearchFormState>(INITIAL_AI_SEARCH_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const runGuarded = useInFlightGuard();

  const missing = missingAiSearchFields(form);
  const submittable = isAiSearchSubmittable(form);
  const ctaDisabled = !submittable || submitting;

  async function handleSubmit(): Promise<void> {
    if (!submittable) return;
    await runGuarded(async () => {
      setSubmitting(true);
      setFormError(null);

      const brandResult = await createBrandProfile(toBrandProfilePayload(form.brand));
      if (!brandResult.ok) {
        setSubmitting(false);
        setFormError(
          brandResult.status === 409
            ? '品牌名已存在，請換一個名稱。'
            : '建立品牌檔案失敗，請稍後再試。',
        );
        return;
      }

      const analysisResult = await createAiSearchAnalysis({
        keywords: aiSearchKeywords(form),
        channels: [...form.channels],
        brandProfileId: brandResult.profile.id,
      });
      if (!analysisResult.ok) {
        setSubmitting(false);
        setFormError('建立分析失敗，請稍後再試。');
        return;
      }

      await navigate({
        to: '/ai-search',
        search: (prev) => ({ ...prev, jobId: analysisResult.jobId }),
      });
    });
  }

  if (jobId) {
    return (
      <section
        aria-labelledby="ai-search-created-heading"
        className="max-w-2xl rounded-2xl bg-bg-card p-6"
      >
        <h2 id="ai-search-created-heading" className="text-xl font-semibold">
          AI Search 分析建立中
        </h2>
        <p className="mt-2 text-sm text-white/60">
          抓取工作已排入佇列（job <span className="font-mono text-white/80">{jobId}</span>
          ）。進度追蹤將於後續版本提供。
        </p>
        <button
          type="button"
          onClick={() => void navigate({ to: '/ai-search', search: {} })}
          className="mt-5 rounded-lg px-4 py-2 text-sm text-white/80 ring-1 ring-white/15 hover:ring-white/30"
        >
          建立另一個分析
        </button>
      </section>
    );
  }

  const specified = form.exploreMode === 'specified';

  return (
    <section aria-labelledby="ai-search-heading" className="mx-auto max-w-3xl">
      <h2 id="ai-search-heading" className="text-xl font-semibold">
        AI Search Insight
      </h2>
      <p className="mt-2 text-sm text-white/60">
        分析品牌與競品在 AI 回答中的能見度。填妥品牌資料、選擇抓取渠道即可建立分析。
      </p>

      <form
        aria-label="建立 AI Search 分析"
        className="mt-6 flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <div>
          <span className="mb-2 block text-sm font-bold text-white/80">
            探索模式<span className="ml-1 text-xs font-normal text-white/40">（單選）</span>
          </span>
          <SegmentedControl<ExploreMode>
            options={EXPLORE_MODE_OPTIONS}
            value={form.exploreMode}
            onChange={(exploreMode) => setForm((f) => ({ ...f, exploreMode }))}
            ariaLabel="探索模式"
          />
          <p className="mt-2 text-xs text-white/50">
            {specified
              ? '系統將分析此品牌與競品在指定搜尋詞下的 AI 能見度。'
              : '系統將分析此品牌與競品在 AI 回答中的整體能見度。'}
          </p>
        </div>

        <BrandProfileForm
          value={form.brand}
          onChange={(brand) => setForm((f) => ({ ...f, brand }))}
        />

        {specified ? (
          <div className="rounded-2xl border border-white/10 bg-bg-card p-5">
            <label htmlFor="ai-seeds" className="block text-sm font-bold text-white/80">
              搜尋詞
            </label>
            <p className="mt-1 text-xs text-white/40">以換行或逗號分隔，至少一個。</p>
            <textarea
              id="ai-seeds"
              rows={4}
              value={form.seedsRaw}
              onChange={(e) => setForm((f) => ({ ...f, seedsRaw: e.target.value }))}
              className="mt-2 w-full rounded-lg bg-bg-input px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-brand"
              placeholder={'dyson 吸塵器\n吸塵器推薦'}
            />
          </div>
        ) : null}

        <fieldset>
          <legend className="mb-2 text-sm font-bold text-white/80">
            抓取渠道<span className="ml-1 text-xs font-normal text-white/40">（複選）</span>
          </legend>
          <div className="flex flex-wrap gap-3">
            {AI_CHANNEL_OPTIONS.map((option) => {
              const on = form.channels.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setForm((f) => ({ ...f, channels: toggleChannel(f.channels, option.value) }))
                  }
                  className={`${CHANNEL_BTN_BASE} ${on ? CHANNEL_ON : CHANNEL_OFF}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {formError ? (
          <p role="alert" className="text-sm text-trend-negative">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-col items-start gap-2">
          <button type="submit" disabled={ctaDisabled} className={PRIMARY_BTN}>
            {submitting ? '建立中…' : '開始分析'}
          </button>
          {missing.length > 0 ? (
            <p className="text-xs text-warn">請完成：{missing.join('、')}</p>
          ) : null}
        </div>
      </form>

      {/* The FR-20 AI 發想 sub-card carries its own <form>; keep it a SIBLING of the
          create-analysis <form> (never nested — invalid HTML / hydration warning).
          Mirrors HomeRoute; only shown in 指定模式 where 搜尋詞 seeds apply. */}
      {specified ? (
        <AiIdeationCard
          seeds={parseSeeds(form.seedsRaw)}
          onGenerated={(keywords) =>
            setForm((f) => ({
              ...f,
              seedsRaw: appendDedupedSeeds(parseSeeds(f.seedsRaw), keywords).join('\n'),
            }))
          }
        />
      ) : null}
    </section>
  );
}
