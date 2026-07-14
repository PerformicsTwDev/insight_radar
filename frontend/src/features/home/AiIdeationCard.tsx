import { useState, type FormEvent } from 'react';
import { generateIdeas } from '../../api/aiIdeation';
import { AI_IDEATION_TEMPLATES } from '../../lib/aiIdeation';

/**
 * "詢問 AI 輔助發想" sub-card (T1.5, FR-20; AC-20.1; TC-31). Pick one of 10
 * templates and 送出 → `POST /ai-ideation { template, seeds }` (stub), where
 * `seeds` are the **existing seeds already in the form** (passed via `seeds`;
 * per FR-20/AC-20.1 「現有 seeds」 and the mockup's template-picker-only UI —
 * there is no card-local seed field). The generated keywords are handed to the
 * host via {@link onGenerated}, which de-dupes (C7) and appends them into the
 * seeds field. It **never creates an analysis** — that stays an explicit user
 * action. A non-2xx shows a generic error; a pulsing state shows while
 * generating. Tokens only (no hardcoded hex).
 */

const GENERIC_ERROR = 'AI 發想失敗，請稍後再試。';
const FIELD_LABEL = 'block text-sm font-medium text-white/80';
const TEXT_INPUT =
  'mt-1 w-full rounded-lg bg-bg-input px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-brand';

export function AiIdeationCard({
  seeds,
  onGenerated,
}: {
  seeds: string[];
  onGenerated: (keywords: string[]) => void;
}) {
  const [template, setTemplate] = useState(AI_IDEATION_TEMPLATES[0].id);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = seeds.length > 0 && !generating;

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (seeds.length === 0) return; // guard the Enter-key path (button is also disabled)
    setError(null);
    setGenerating(true);
    const result = await generateIdeas({ template, seeds });
    setGenerating(false);
    if (result.ok) onGenerated(result.keywords);
    else setError(GENERIC_ERROR);
  }

  return (
    <section
      aria-labelledby="ai-ideation-heading"
      className="mt-8 rounded-xl border border-white/10 bg-bg-input/40 p-4"
    >
      <h3 id="ai-ideation-heading" className="text-sm font-semibold text-white/90">
        詢問 AI 輔助發想
      </h3>
      <p className="mt-1 text-xs text-white/40">
        依上方種子關鍵字選一個模板生成，結果會去重後加入種子欄。
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-trend-negative">
          {error}
        </p>
      ) : null}

      <form
        aria-label="AI 輔助發想"
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div>
          <label htmlFor="ai-template" className={FIELD_LABEL}>
            發想模板
          </label>
          <select
            id="ai-template"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className={TEXT_INPUT}
          >
            {AI_IDEATION_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            aria-busy={generating}
            className="rounded-lg bg-brand/90 px-4 py-2 text-sm font-medium text-bg-body enabled:hover:bg-brand disabled:cursor-not-allowed disabled:opacity-40"
          >
            送出
          </button>
          {generating ? <span className="animate-pulse text-xs text-white/50">生成中…</span> : null}
        </div>
      </form>
    </section>
  );
}
