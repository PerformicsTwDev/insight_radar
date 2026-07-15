import { Fragment, useState, type ReactElement } from 'react';
import { EM_DASH, formatVolume, resolveIntent } from '../../lib/keywordsTable';
import type { TopicsResponse } from '../../api/topics';

/**
 * 主題表 (T3.3, FR-8; TC-19 表格). One row per cluster — 主題 (topicName) / 意圖
 * (intentLabel via the resolveIntent zh + token-color SSOT, C2) / 搜尋量加總
 * (clusterVolume; null → — via formatVolume, never 0, C12) / 關鍵字數 — with an
 * accessible 相關搜尋詞 collapse/expand (button + aria-expanded) that reveals that
 * cluster's classified keywords (`keywords[]` filtered by topicName). Tokens only.
 *
 * **Omitted columns (spec/contract gap, documented):** the mockup 主題表 also shows
 * sparkline / 競爭度 / CPC / ✦ per cluster, but the backend `TopicsResponse.clusters[]`
 * carries no per-cluster search-volume series or CPC/competition — fabricating them
 * would violate C12. They are left out until the contract provides them (treemap is
 * T3.4).
 */
export function TopicsTable({ topics }: { topics: TopicsResponse | undefined }): ReactElement {
  // Expanded state keyed by row index — `topicName` is not guaranteed unique across
  // clusters, so keying by it would collide (one toggle opening two rows).
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const clusters = topics?.clusters ?? [];
  const keywords = topics?.keywords ?? [];

  if (clusters.length === 0) {
    return (
      <p
        role="status"
        className="rounded-lg border border-white/10 bg-bg-card p-8 text-center text-sm text-white/50"
      >
        尚無主題資料
      </p>
    );
  }

  const toggle = (index: number): void =>
    setExpanded((prev) => ({ ...prev, [index]: !prev[index] }));

  return (
    <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-white/10">
      <table aria-label="意圖主題表" className="w-full border-collapse text-sm text-white/80">
        <thead className="bg-bg-raised text-xs text-white/60">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              主題
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              意圖
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              搜尋量加總
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              關鍵字數
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              相關搜尋詞
            </th>
          </tr>
        </thead>
        <tbody>
          {clusters.map((cluster, index) => {
            const isOpen = Boolean(expanded[index]);
            const related = keywords.filter((k) => k.topicName === cluster.topicName);
            const detailId = `topic-detail-${index}`;
            return (
              <Fragment key={index}>
                <tr className="border-t border-white/5">
                  <td className="px-3 py-2 font-medium text-white">{cluster.topicName}</td>
                  <td className="px-3 py-2">
                    <IntentTag label={cluster.intentLabel} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatVolume(cluster.clusterVolume)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {cluster.keywordCount}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={detailId}
                      onClick={() => toggle(index)}
                      className="rounded px-2 py-1 text-xs text-white/70 ring-1 ring-white/10 hover:text-white hover:ring-white/20"
                    >
                      相關搜尋詞 {isOpen ? '▲' : '▼'}
                    </button>
                  </td>
                </tr>
                {isOpen ? (
                  <tr id={detailId} className="border-t border-white/5 bg-bg-input/30">
                    <td colSpan={5} className="px-3 py-2">
                      {related.length ? (
                        <ul className="flex flex-wrap gap-2">
                          {related.map((k) => (
                            <li
                              key={k.normalizedText}
                              className="rounded bg-bg-raised px-2 py-1 text-xs text-white/70"
                            >
                              {k.text}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-white/40">無相關搜尋詞</p>
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Intent chip via the intentMap SSOT (C2); empty label → — (C12), unknown → raw text. */
function IntentTag({ label }: { label: string }): ReactElement {
  if (!label) {
    return <span className="text-white/40">{EM_DASH}</span>;
  }
  const { zh, color } = resolveIntent(label);
  // Color is a runtime value from the intentMap SSOT (C2) → applied inline, not via a
  // Tailwind token class (a label→color lookup can't be JIT-safelisted without a safelist).
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs ring-1 ring-white/10"
      style={color ? { color } : undefined}
    >
      {zh}
    </span>
  );
}
