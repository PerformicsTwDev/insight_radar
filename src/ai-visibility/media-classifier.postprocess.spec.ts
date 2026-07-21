import { MEDIA_TYPES } from './media-classifier.schema';
import {
  type MediaReference,
  type RawMediaBatch,
  postProcessMedia,
} from './media-classifier.postprocess';

/** 便利建構 id'd reference（link 對 postProcess 無影響——LLM 已判好 type，此處只對回 + 清洗）。 */
const ref = (id: string): MediaReference => ({ id, link: `https://${id}.example/path` });

describe('TC-78: postProcessMedia (引用媒體後處理——9-enum 驗證邊界 + partial 不污染)', () => {
  describe('9 類 enum 映射（各合法類別保留、非法值收斂 other）', () => {
    it('LLM 回各合法 enum（9 類）→ 原樣保留', () => {
      const parsed: RawMediaBatch = { references: MEDIA_TYPES.map((t) => ({ id: t, type: t })) };
      const out = postProcessMedia(
        MEDIA_TYPES.map((t) => ref(t)),
        parsed,
      );
      expect(out).toEqual(MEDIA_TYPES.map((t) => ({ id: t, type: t })));
    });

    it('LLM 回非 enum 的雜訊 type → 收斂為 other（驗證邊界，不讓非法值污染下游 enum）', () => {
      const parsed: RawMediaBatch = {
        references: [{ id: 'r0', type: 'wikipedia' }],
      };
      const out = postProcessMedia([ref('r0')], parsed);
      expect(out).toEqual([{ id: 'r0', type: 'other' }]);
    });
  });

  describe('對回每個輸入 ref + partial 不污染他筆（AC-42.5）', () => {
    it('LLM 缺某 ref → 該 ref 補 other（不污染他筆、不崩）', () => {
      const parsed: RawMediaBatch = { references: [{ id: 'r1', type: 'news' }] };
      const out = postProcessMedia([ref('r0'), ref('r1')], parsed);
      expect(out).toEqual([
        { id: 'r0', type: 'other' }, // 缺漏 → 補 other（AC-42.5）
        { id: 'r1', type: 'news' },
      ]);
    });

    it('依輸入順序輸出、恰每 ref 一列（含補值 ref）', () => {
      const parsed: RawMediaBatch = {
        references: [
          { id: 'r2', type: 'blog' },
          { id: 'r0', type: 'gov' },
        ],
      };
      const out = postProcessMedia([ref('r0'), ref('r1'), ref('r2')], parsed);
      expect(out.map((r) => r.id)).toEqual(['r0', 'r1', 'r2']);
      expect(out).toEqual([
        { id: 'r0', type: 'gov' },
        { id: 'r1', type: 'other' },
        { id: 'r2', type: 'blog' },
      ]);
    });

    it('同 ref id 多筆結果 → 以最後一筆為準（沿用 last-wins）', () => {
      const parsed: RawMediaBatch = {
        references: [
          { id: 'r0', type: 'news' },
          { id: 'r0', type: 'social' },
        ],
      };
      const out = postProcessMedia([ref('r0')], parsed);
      expect(out).toEqual([{ id: 'r0', type: 'social' }]);
    });

    it('無 ref（空輸入）→ 空輸出', () => {
      expect(postProcessMedia([], { references: [] })).toEqual([]);
    });
  });
});
