import { ChipBox } from '../../components/ChipBox';
import { appendDedupedSeeds } from '../../lib/aiIdeation';
import type { BrandFormState, CompetitorEntry } from '../../lib/aiSearchForm';

/**
 * 品牌與競品資料 card (T8.1, FR-22; v4 `#brandOverallForm`). Controlled — the parent
 * (`AiSearchHome`) owns `value` + `onChange` so the CTA validity gate lives in one
 * place. Reuses `ChipBox` (alias / site chips) and the C7 dedupe (`appendDedupedSeeds`).
 *
 * ✦ AI 別名補全 is a **disabled roadmap affordance** (FR-22 revision 2026-07-23): the
 * dedicated brand-alias-extractor (`backend:AC-40.2`) is undelivered, and the FR-20
 * `/ai-ideation` endpoint returns competitor/comparison terms — NOT same-brand aliases
 * — so wiring it would pollute the canonical `BrandProfile.aliases`. Until the backend
 * endpoint lands, manual alias entry (the ChipBox) is the supported path. Tokens only.
 */

const FIELD_LABEL = 'block text-sm font-medium text-white/80';
const TEXT_INPUT =
  'mt-1 w-full rounded-lg bg-bg-input px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-brand';
const ASSIST_BTN =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-brand ring-1 ring-brand/40 enabled:hover:bg-brand/10 disabled:cursor-not-allowed disabled:text-white/30 disabled:ring-white/10';
const SEC_BTN =
  'rounded-lg px-3 py-1.5 text-xs font-medium text-white/80 ring-1 ring-white/15 hover:ring-white/30';

export interface BrandProfileFormProps {
  readonly value: BrandFormState;
  readonly onChange: (next: BrandFormState) => void;
}

export function BrandProfileForm({ value, onChange }: BrandProfileFormProps) {
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
            手動輸入品牌別名、網站與競品；AI 別名補全即將推出。
          </p>
        </div>
        {/* Roadmap affordance: disabled until the backend brand-alias-extractor
            (backend:AC-40.2) ships — never wired to /ai-ideation (competitor terms,
            not aliases). Manual entry via the ChipBox below is the supported path. */}
        <button
          type="button"
          disabled
          title="AI 別名補全即將推出（依賴後端 brand-alias-extractor）——暫以手動輸入品牌別名"
          className={ASSIST_BTN}
        >
          <span aria-hidden="true">✦</span>
          AI 補全別名（即將推出）
        </button>
      </div>

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
