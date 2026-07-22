import { useRef, useState, type ReactElement } from 'react';
import { generateIdeas } from '../../api/aiIdeation';
import { AI_IDEATION_TEMPLATES, parseIdeationSeed } from '../../lib/aiIdeation';

/**
 * "詢問 AI 輔助發想" sub-card — v4 interactive dropdown (T7.11, FR-2 修訂 e / FR-20;
 * AC-2.4 / TC-74). An input (placeholder 選擇發想模板) opens a dropdown of the 10 v4
 * templates; picking one fills the input with a prompt carrying a 「」 slot (e.g.
 * 發想「」的專業術語與技術規格) and puts the caret inside it. The user types a keyword
 * into 「」; 送出 sends `POST /ai-ideation { template: <key>, seeds: [「」content] }`
 * ({@link generateIdeas}) and hands the generated keywords to {@link onGenerated}, which
 * C7-de-dupes + appends them into the 輸入搜尋詞 textarea. It **never creates an
 * analysis**. 送出 is disabled until a template is picked AND the 「」 has content; a
 * non-2xx shows a generic error (no append). Tokens only (no hardcoded hex).
 */

const GENERIC_ERROR = 'AI 發想失敗，請稍後再試。';
const TEXT_INPUT =
  'w-full rounded-lg bg-bg-input px-3 py-2 pr-16 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-brand';

export function AiIdeationCard({
  onGenerated,
}: {
  onGenerated: (keywords: string[]) => void;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [templateKey, setTemplateKey] = useState(''); // '' = no template picked yet
  const [inputValue, setInputValue] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seed = parseIdeationSeed(inputValue);
  // 送出 is the single gate (disabled unless a template is picked AND 「」 has content) —
  // so `handleSubmit` never needs a defensive re-check.
  const canSubmit = templateKey.length > 0 && seed.length > 0 && !generating;

  function selectTemplate(id: string, label: string): void {
    setTemplateKey(id);
    setInputValue(label);
    setError(null);
    setOpen(false);
    // Put the caret inside the 「」 slot so the user can type the keyword straight away.
    const caret = label.indexOf('「');
    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret + 1, caret + 1);
    });
  }

  async function handleSubmit(): Promise<void> {
    setError(null);
    setGenerating(true);
    const result = await generateIdeas({ template: templateKey, seeds: [seed] });
    setGenerating(false);
    if (result.ok) onGenerated(result.keywords);
    else setError(GENERIC_ERROR);
  }

  return (
    <section
      aria-labelledby="ai-ideation-heading"
      className="mt-8 rounded-xl border border-white/5 bg-bg-input/40 p-4"
    >
      <div className="mb-3 flex items-center gap-2">
        <BoltIcon />
        <h3 id="ai-ideation-heading" className="text-sm font-bold text-white/70">
          詢問 AI 輔助發想
        </h3>
      </div>

      {error ? (
        <p role="alert" className="mb-3 text-sm text-trend-negative">
          {error}
        </p>
      ) : null}

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          aria-label="發想模板"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onClick={() => setOpen((o) => !o)}
          placeholder="選擇發想模板"
          autoComplete="off"
          className={TEXT_INPUT}
        />
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          aria-busy={generating}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-3 py-1.5 text-sm font-bold text-brand hover:bg-brand/10 disabled:cursor-not-allowed disabled:text-white/30 disabled:hover:bg-transparent"
        >
          {generating ? '發想中…' : '送出'}
        </button>

        {open ? (
          <ul
            aria-label="發想模板選項"
            className="absolute left-0 top-full z-20 mt-2 max-h-60 w-full overflow-y-auto rounded-lg border border-white/10 bg-bg-card shadow-xl"
          >
            {AI_IDEATION_TEMPLATES.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => selectTemplate(t.id, t.label)}
                  className="w-full border-b border-white/5 px-4 py-3 text-left text-[13.5px] text-white/80 last:border-b-0 hover:bg-white/5"
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/** Inline bolt affordance for the AI 發想 heading (decorative). */
function BoltIcon(): ReactElement {
  return (
    <svg
      className="h-4 w-4 text-brand"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  );
}
