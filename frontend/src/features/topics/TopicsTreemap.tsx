import type { ReactElement } from 'react';
import { formatVolume } from '../../lib/keywordsTable';
import { squarify } from '../../lib/squarify';
import type { TopicsResponse } from '../../api/topics';
import { pickShade } from './treemapPalette';

/**
 * 意圖主題 treemap (T3.4, FR-8; TC-19 圖表). Rectangle **area ∝ clusterVolume** via
 * the pure `squarify` layout, coloured by the 8-shade green ramp (`treemapPalette`),
 * each cell showing the 主題 (topicName) + its share (pct) · 搜尋量 (formatVolume).
 * Cells are positioned in percent of a fixed-aspect container, so the map is
 * responsive; the outer wrapper scrolls if it must.
 *
 * C12: a cluster whose `clusterVolume` is null **or** ≤ 0 is NOT fabricated into a
 * sized rect — it is excluded from the map and only acknowledged in a small count
 * note. No positive-volume cluster at all → an accessible empty note. Aside from the
 * decorative ramp (one module, applied inline), no scattered hex — tokens only.
 */

/** Fixed layout viewBox (16:10) — cells render as % so the map scales responsively. */
const VIEW_WIDTH = 160;
const VIEW_HEIGHT = 100;
/** Gutter between cells (px), trimmed off each cell's percentage size. */
const GUTTER_PX = 4;

export function TopicsTreemap({ topics }: { topics: TopicsResponse | undefined }): ReactElement {
  const clusters = topics?.clusters ?? [];
  const positive = clusters
    .flatMap((cluster) =>
      cluster.clusterVolume !== null && cluster.clusterVolume > 0
        ? [{ topicName: cluster.topicName, volume: cluster.clusterVolume }]
        : [],
    )
    // Largest first → deepest shade + top-left prominence (rank order).
    .sort((a, b) => b.volume - a.volume);
  const excludedCount = clusters.length - positive.length;

  if (positive.length === 0) {
    return (
      <p
        role="status"
        className="rounded-lg border border-white/10 bg-bg-card p-8 text-center text-sm text-white/50"
      >
        尚無可視化的搜尋量資料
      </p>
    );
  }

  const total = positive.reduce((sum, item) => sum + item.volume, 0);
  const rects = squarify(
    positive.map((item) => ({ value: item.volume })),
    VIEW_WIDTH,
    VIEW_HEIGHT,
  );

  return (
    <div className="overflow-x-auto rounded-xl bg-bg-card p-2 ring-1 ring-white/10">
      <div role="img" aria-label="意圖佔比樹狀圖" className="relative aspect-[16/10] w-full">
        {rects.map((rect, index) => {
          const item = positive[index];
          const pct = ((item.volume / total) * 100).toFixed(1);
          const meta = `${pct}% · ${formatVolume(item.volume)}`;
          return (
            <div
              key={index}
              data-testid="tm-cell"
              className="absolute flex flex-col justify-end overflow-hidden rounded-lg p-2 ring-1 ring-inset ring-white/10"
              style={{
                left: `${(rect.x / VIEW_WIDTH) * 100}%`,
                top: `${(rect.y / VIEW_HEIGHT) * 100}%`,
                width: `calc(${(rect.width / VIEW_WIDTH) * 100}% - ${GUTTER_PX}px)`,
                height: `calc(${(rect.height / VIEW_HEIGHT) * 100}% - ${GUTTER_PX}px)`,
                backgroundColor: pickShade(index),
              }}
            >
              <span className="truncate text-sm font-bold text-white">{item.topicName}</span>
              <span className="mt-0.5 font-mono text-xs text-white/85">{meta}</span>
            </div>
          );
        })}
      </div>
      {excludedCount > 0 ? (
        <p className="mt-2 px-1 text-xs text-white/40">
          {`${excludedCount} 個主題無搜尋量資料，未納入圖表`}
        </p>
      ) : null}
    </div>
  );
}
