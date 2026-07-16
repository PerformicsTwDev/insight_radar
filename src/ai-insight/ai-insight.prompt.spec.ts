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
});
