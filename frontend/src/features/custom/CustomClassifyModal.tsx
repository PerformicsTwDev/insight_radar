import { useCallback, useState, type ReactElement } from 'react';
import { generateCustomLabels } from '../../api/customClassifications';
import { ChipBox } from '../../components/ChipBox';
import { useInFlightGuard } from '../../hooks/useInFlightGuard';
import { appendDedupedSeeds } from '../../lib/aiIdeation';

/**
 * 自訂分類 HITL modal — **stage one** (T5.1, FR-16; backend FR-34 / AC-34.1). The user
 * gives a 名稱 + AI 分類指令 → `生成分類架構` (`POST /:id/custom-classifications`) → a set
 * of label chips. AI labels **accumulate** across generations (de-duplicated by the
 * C7 normalized key, the same `appendDedupedSeeds` behind AI-ideation), and the user
 * can add / remove chips by hand (HITL). `開始分析` (stage two — wired at T5.2) is
 * disabled until at least one label exists, so the user cannot advance before
 * generating (AC — 生成前 disabled). The generate + start triggers are re-entrancy
 * guarded (M4-R1) so a fast double-click never fires a duplicate. Tokens only.
 */

export interface CustomClassifyModalProps {
  readonly analysisId: string;
  readonly onClose: () => void;
  /**
   * Advance to stage-two classification (T5.2): the assignment job needs the stage-one
   * classification the modal generated (its `id` = the `cid` the assignment run posts to,
   * its `name` = the dynamic tab label) plus the HITL-confirmed label strings. The
   * classification is the **last** successful generate (labels accumulate across
   * generates; the last cid receives the confirmed set, last-write-wins).
   */
  readonly onConfirm: (
    classification: { id: string; name: string },
    labels: readonly string[],
  ) => void | Promise<void>;
}

const GENERIC_ERROR = '生成分類架構失敗，請稍後再試。';
const FIELD_LABEL = 'block text-sm font-medium text-white/80';
const TEXT_INPUT =
  'mt-1 w-full rounded-lg bg-bg-input px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-brand';
const GEN_BTN =
  'rounded-lg bg-brand/90 px-4 py-2 text-sm font-medium text-bg-body enabled:hover:bg-brand disabled:cursor-not-allowed disabled:opacity-40';
const SEC_BTN = 'rounded-lg px-4 py-2 text-sm text-white/70 ring-1 ring-white/10 hover:bg-white/5';
const PRIMARY_BTN =
  'rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-bg-body enabled:hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40';

export function CustomClassifyModal({
  analysisId,
  onClose,
  onConfirm,
}: CustomClassifyModalProps): ReactElement {
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [labels, setLabels] = useState<readonly string[]>([]);
  // The last successful stage-one generate — carries the cid + name into stage two (T5.2).
  const [classification, setClassification] = useState<{ id: string; name: string } | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canGenerate = name.trim().length > 0 && instruction.trim().length > 0;
  const canStart = labels.length > 0;

  // Both triggers stay clickable until their async work resolves, so a fast
  // double-click would otherwise fire a duplicate — guard re-entry (M4-R1, #603).
  const guardGenerate = useInFlightGuard();
  const guardStart = useInFlightGuard();

  const handleGenerate = useCallback(
    () =>
      guardGenerate(async () => {
        setError(null);
        setGenerating(true);
        const result = await generateCustomLabels(analysisId, {
          name: name.trim(),
          instruction: instruction.trim(),
        });
        setGenerating(false);
        if (result.ok) {
          // AI labels ACCUMULATE onto the current set, de-duplicated (C7 single point).
          setLabels((prev) =>
            appendDedupedSeeds(
              [...prev],
              result.classification.labels.map((l) => l.label),
            ),
          );
          // Track the classification the confirmed labels will be assigned to (T5.2 seam).
          setClassification({ id: result.classification.id, name: result.classification.name });
          setHasGenerated(true);
        } else {
          setError(GENERIC_ERROR);
        }
      }),
    [analysisId, name, instruction, guardGenerate],
  );

  // Manual add shares the ONE dedupe point with the AI-append path.
  const addLabel = useCallback((label: string) => {
    setLabels((prev) => appendDedupedSeeds([...prev], [label]));
  }, []);
  const removeLabel = useCallback((label: string) => {
    setLabels((prev) => prev.filter((existing) => existing !== label));
  }, []);

  // Takes the (narrowed, non-null) classification from the render scope so there is no
  // nullable guard — the button only wires this handler once a generate has produced one.
  const handleStart = useCallback(
    (cls: { id: string; name: string }) =>
      guardStart(async () => {
        await onConfirm(cls, [...labels]);
      }),
    [guardStart, onConfirm, labels],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-modal-title"
      className="fixed inset-0 z-[100] flex items-center justify-center"
    >
      <div
        onClick={onClose}
        aria-hidden="true"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />
      <div className="relative max-h-[90vh] w-[92%] max-w-md overflow-y-auto rounded-2xl bg-bg-card p-6 shadow-2xl ring-1 ring-white/10">
        <div className="flex items-start justify-between">
          <h3 id="custom-modal-title" className="text-base font-bold text-white">
            新增自訂分類
          </h3>
          <button
            type="button"
            aria-label="關閉"
            onClick={onClose}
            className="leading-none text-white/40 hover:text-white"
          >
            ✕
          </button>
        </div>
        <p className="mb-5 mt-1 text-xs leading-relaxed text-white/40">
          輸入分類視角與 AI 指令，AI 會先提出建議的分類標籤，你可以微調後再開始分析。
        </p>

        {error ? (
          <p role="alert" className="mb-3 text-sm text-trend-negative">
            {error}
          </p>
        ) : null}

        <div className="mb-4">
          <label htmlFor="custom-name" className={FIELD_LABEL}>
            分類視角名稱
          </label>
          <input
            id="custom-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如「競爭優勢」"
            autoComplete="off"
            className={TEXT_INPUT}
          />
        </div>

        <div>
          <label htmlFor="custom-instruction" className={FIELD_LABEL}>
            AI 分類指令
          </label>
          <textarea
            id="custom-instruction"
            rows={4}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="例如「請判斷這些搜尋詞是注重價格、還是品質，並依此分組...」"
            className={`${TEXT_INPUT} resize-none leading-relaxed`}
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={!canGenerate}
              aria-busy={generating}
              onClick={() => void handleGenerate()}
              className={GEN_BTN}
            >
              生成分類架構
            </button>
            {generating ? (
              <span className="animate-pulse text-xs text-white/50">生成中…</span>
            ) : null}
          </div>
        </div>

        {hasGenerated ? (
          <div className="mt-5">
            <label className={FIELD_LABEL}>
              分類標籤{' '}
              <span className="font-normal text-white/30">
                （AI 生成會累加 · 也可手動輸入後按 Enter）
              </span>
            </label>
            <div className="mt-1">
              <ChipBox labels={labels} onAdd={addLabel} onRemove={removeLabel} />
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className={SEC_BTN}>
            取消
          </button>
          <button
            type="button"
            disabled={!canStart}
            onClick={classification ? () => void handleStart(classification) : undefined}
            className={PRIMARY_BTN}
          >
            開始分析
          </button>
        </div>
      </div>
    </div>
  );
}
