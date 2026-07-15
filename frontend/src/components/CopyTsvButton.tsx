import { useState, type ReactElement } from 'react';

/**
 * "複製" button (T2.7, FR-13): writes the TSV produced by {@link getTsv} to the
 * clipboard and shows a ✓ confirmation. The TSV itself comes from the pure
 * `lib/tsv` (this is just the clipboard shell), so the table and the AI-insight
 * sidebar (T4.3) share one export path. A denied / unavailable clipboard leaves
 * the label unchanged (no false ✓). Tokens only — no hardcoded hex.
 */
export function CopyTsvButton({
  getTsv,
  label = '複製表格',
}: {
  getTsv: () => string;
  label?: string;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  function handleCopy(): void {
    // Both settlement paths handled → no unhandled rejection; ✓ only on success.
    void navigator.clipboard.writeText(getTsv()).then(
      () => setCopied(true),
      () => undefined,
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-lg px-3 py-1.5 text-xs font-medium text-white/70 ring-1 ring-white/10 hover:text-white hover:ring-white/20"
    >
      {copied ? '✓ 已複製' : label}
    </button>
  );
}
