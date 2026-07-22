import { useState } from 'react';
import { suggestBrandTerms } from '../../api/brandProfiles';
import { ChipBox } from '../../components/ChipBox';
import { useInFlightGuard } from '../../hooks/useInFlightGuard';
import { appendDedupedSeeds } from '../../lib/aiIdeation';
import { canBrandAssist, type BrandFormState, type CompetitorEntry } from '../../lib/aiSearchForm';

/**
 * 品牌與競品資料 card (T8.1, FR-22; v4 `#brandOverallForm`). Controlled — the parent
 * (`AiSearchHome`) owns `value` + `onChange` so the CTA validity gate lives in one
 * place. Reuses `ChipBox` (alias / site chips) and the C7 dedupe (`appendDedupedSeeds`).
 *
 * ✦ AI 別名補全 is **HITL**: pressing it fetches candidate aliases (`suggestBrandTerms`
 * → the delivered ideation endpoint, since AC-40.2's dedicated route is undelivered)
 * and renders them as suggestion chips — nothing is written until the user clicks a
 * candidate (de-duped on add; AC-22.1 「不自動寫入」). Tokens only — no hardcoded hex.
 */

const FIELD_LABEL = 'block text-sm font-medium text-white/80';
const TEXT_INPUT =
  'mt-1 w-full rounded-lg bg-bg-input px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-brand';
const ASSIST_BTN =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-brand ring-1 ring-brand/40 enabled:hover:bg-brand/10 disabled:cursor-not-allowed disabled:text-white/30 disabled:ring-white/10';
const SUGGEST_CHIP =
  'inline-flex items-center gap-1 rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand ring-1 ring-brand/40 hover:bg-brand/20';
const SEC_BTN =
  'rounded-lg px-3 py-1.5 text-xs font-medium text-white/80 ring-1 ring-white/15 hover:ring-white/30';

export interface BrandProfileFormProps {
  readonly value: BrandFormState;
  readonly onChange: (next: BrandFormState) => void;
}

export function BrandProfileForm({ value, onChange }: BrandProfileFormProps) {
  const runGuarded = useInFlightGuard();
  const [assisting, setAssisting] = useState(false);
  const [assistError, setAssistError] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const assistEnabled = canBrandAssist(value.name);

  function addAlias(label: string): void {
    onChange({ ...value, aliases: appendDedupedSeeds([...value.aliases], [label]) });
  }
  function removeAlias(label: string): void {
    onChange({ ...value, aliases: value.aliases.filter((a) => a !== label) });
  }
  function addSite(label: string): void {
    onChange({ ...value, sites: appendDedupedSeeds([...value.sites], [label]) });
  }
  function removeSite(label: string): void {
    onChange({ ...value, sites: value.sites.filter((s) => s !== label) });
  }

  function patchCompetitor(index: number, patch: Partial<CompetitorEntry>): void {
    onChange({
      ...value,
      competitors: value.competitors.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    });
  }
  function addCompetitor(): void {
    onChange({
      ...value,
      competitors: [...value.competitors, { name: '', aliases: [], sites: [] }],
    });
  }
  function removeCompetitor(index: number): void {
    onChange({ ...value, competitors: value.competitors.filter((_, i) => i !== index) });
  }

  async function handleAssist(): Promise<void> {
    if (!assistEnabled) return;
    await runGuarded(async () => {
      setAssistError(false);
      setAssisting(true);
      const result = await suggestBrandTerms(value.name);
      setAssisting(false);
      if (result.ok) setSuggestions(result.keywords);
      else setAssistError(true);
    });
  }

  return (
    <section
      aria-labelledby="brand-profile-heading"
      className="rounded-2xl border border-white/10 bg-bg-card p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="brand-profile-heading" className="text-sm font-bold text-white">
            品牌與競品資料
          </h3>
          <p className="mt-1 text-xs text-white/50">
            先輸入品牌名，再用 AI 補全品牌別名、網站與建議競品。
          </p>
        </div>
        <button
          type="button"
          disabled={!assistEnabled || assisting}
          aria-busy={assisting}
          onClick={() => void handleAssist()}
          className={ASSIST_BTN}
        >
          <span aria-hidden="true">✦</span>
          {assistEnabled ? 'AI 補全品牌資料與競品' : '先輸入品牌名以啟用 AI 補全'}
        </button>
      </div>

      {assisting ? (
        <p role="status" className="mt-2 animate-pulse text-xs text-white/50">
          AI 查找中…
        </p>
      ) : null}
      {assistError ? (
        <p role="alert" className="mt-2 text-xs text-trend-negative">
          AI 補全失敗，請稍後再試或手動輸入。
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <div className="flex items-baseline gap-1">
            <label htmlFor="brand-name" className="text-sm font-medium text-white/80">
              品牌名
            </label>
            <span aria-hidden="true" className="text-trend-negative">
              *
            </span>
          </div>
          <input
            id="brand-name"
            type="text"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            className={TEXT_INPUT}
            placeholder="例如：Dyson"
          />
        </div>

        <div>
          <span className={FIELD_LABEL}>
            品牌別名
            <span aria-hidden="true" className="text-trend-negative">
              {' '}
              *
            </span>
            <span className="ml-1 text-xs font-normal text-white/40">Enter 新增</span>
          </span>
          <div className="mt-1">
            <ChipBox
              labels={value.aliases}
              onAdd={addAlias}
              onRemove={removeAlias}
              inputAriaLabel="新增品牌別名"
              placeholder="例如：戴森"
            />
          </div>
        </div>

        <div>
          <span className={FIELD_LABEL}>
            品牌網站
            <span aria-hidden="true" className="text-trend-negative">
              {' '}
              *
            </span>
            <span className="ml-1 text-xs font-normal text-white/40">Enter 新增</span>
          </span>
          <div className="mt-1">
            <ChipBox
              labels={value.sites}
              onAdd={addSite}
              onRemove={removeSite}
              inputAriaLabel="新增品牌網站"
              placeholder="例如：https://www.dyson.tw"
            />
          </div>
        </div>
      </div>

      {suggestions.length > 0 ? (
        <div className="mt-4">
          <p className={FIELD_LABEL}>
            AI 建議別名
            <span className="ml-1 text-xs font-normal text-white/40">點擊加入品牌別名</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((term) => (
              <button
                key={term}
                type="button"
                aria-label={`加入品牌別名 ${term}`}
                onClick={() => addAlias(term)}
                className={SUGGEST_CHIP}
              >
                <span aria-hidden="true">＋</span>
                {term}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className={FIELD_LABEL}>
            競品<span className="ml-1 text-xs font-normal text-white/40">（選填）</span>
          </span>
          <button type="button" onClick={addCompetitor} className={SEC_BTN}>
            ＋ 新增競品
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {value.competitors.map((competitor, index) => (
            <fieldset
              key={index}
              className="grid grid-cols-1 gap-2 rounded-xl border border-white/10 bg-bg-input/40 p-3 md:grid-cols-3"
            >
              <legend className="px-1 text-xs font-medium text-white/60">競品 {index + 1}</legend>
              <input
                type="text"
                aria-label={`競品 ${index + 1} 名稱`}
                value={competitor.name}
                onChange={(e) => patchCompetitor(index, { name: e.target.value })}
                className={TEXT_INPUT}
                placeholder="競品名稱"
              />
              <ChipBox
                labels={competitor.aliases}
                onAdd={(label) =>
                  patchCompetitor(index, {
                    aliases: appendDedupedSeeds([...competitor.aliases], [label]),
                  })
                }
                onRemove={(label) =>
                  patchCompetitor(index, {
                    aliases: competitor.aliases.filter((a) => a !== label),
                  })
                }
                inputAriaLabel={`競品 ${index + 1} 別名`}
                placeholder="別名"
              />
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <ChipBox
                    labels={competitor.sites}
                    onAdd={(label) =>
                      patchCompetitor(index, {
                        sites: appendDedupedSeeds([...competitor.sites], [label]),
                      })
                    }
                    onRemove={(label) =>
                      patchCompetitor(index, {
                        sites: competitor.sites.filter((s) => s !== label),
                      })
                    }
                    inputAriaLabel={`競品 ${index + 1} 網站`}
                    placeholder="網站"
                  />
                </div>
                <button
                  type="button"
                  aria-label={`移除競品 ${index + 1}`}
                  onClick={() => removeCompetitor(index)}
                  className="mt-1 shrink-0 rounded-md px-2 py-1 text-xs text-white/50 hover:text-trend-negative"
                >
                  ✕
                </button>
              </div>
            </fieldset>
          ))}
        </div>
      </div>
    </section>
  );
}
