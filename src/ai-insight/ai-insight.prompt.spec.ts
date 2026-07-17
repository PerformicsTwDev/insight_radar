import type { ViewResult } from '../keywords/views';
import { buildAiInsightMessages } from './ai-insight.prompt';

const AGG = {
  view: 'keywords',
  columns: [{ key: 'text', label: 'kw', type: 'text' }],
  rows: [{ text: 'a' }],
  pagination: { total: 1, page: 1, pageSize: 200, cursor: null },
} as unknown as ViewResult;

describe('buildAiInsightMessages (FR-32 prompt)', () => {
  it('returns a system message then a user message', () => {
    const msgs = buildAiInsightMessages('keywords', AGG);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });

  it('embeds the view name and the aggregated result JSON in the user message', () => {
    const [, user] = buildAiInsightMessages('keywords', AGG);
    expect(user.content).toContain('keywords');
    expect(user.content).toContain(JSON.stringify(AGG));
  });

  it('instructs the model not to treat null metrics as zero (S2 correctness single-point)', () => {
    const [system] = buildAiInsightMessages('cpc_histogram', AGG);
    expect(system.content.toLowerCase()).toContain('null');
  });

  describe('M12-R2: bounded-sample coverage disclosure', () => {
    it('injects a coverage note when the table is truncated (total > shown rows)', () => {
      const truncated = {
        view: 'keywords',
        rows: [{ text: 'a' }, { text: 'b' }], // 2 shown
        pagination: { total: 1200, page: 1, pageSize: 200, cursor: null },
      } as unknown as ViewResult;
      const [system, user] = buildAiInsightMessages('keywords', truncated);
      expect(user.content).toContain('Coverage:');
      expect(user.content).toContain('1200'); // total M
      expect(user.content).toContain('top 2'); // shown N
      // the system prompt instructs honoring the coverage note (no bounded-sample-as-whole)
      expect(system.content).toContain('top N of M');
    });

    it('does NOT add a coverage note when the whole table fits (total <= shown)', () => {
      const whole = {
        view: 'keywords',
        rows: [{ text: 'a' }],
        pagination: { total: 1, page: 1, pageSize: 200, cursor: null },
      } as unknown as ViewResult;
      expect(buildAiInsightMessages('keywords', whole)[1].content).not.toContain('Coverage:');
    });

    it('does NOT add a coverage note for a chart-grain view (no pagination)', () => {
      const chart = {
        view: 'cpc_histogram',
        series: [{ bucket: 0, count: 10 }],
      } as unknown as ViewResult;
      expect(buildAiInsightMessages('cpc_histogram', chart)[1].content).not.toContain('Coverage:');
    });
  });
});
