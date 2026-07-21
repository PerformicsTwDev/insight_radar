import { intentMap } from './intentMap';

// Token 快照（C2）：鎖定 I/C/T/N 的 color + 中文 label——任一漂移即紅（顏色/中文為對外語意契約）。
describe('TC-5 · intentMap (C2: 意圖色/中文單一來源)', () => {
  it('locks the 4 intent colors + zh labels (drift guard)', () => {
    expect(intentMap).toEqual({
      informational: { color: '#5BC0EB', zh: '資訊型' },
      commercial: { color: '#52b788', zh: '商業型' },
      transactional: { color: '#FFD166', zh: '交易型' },
      // 導航型：T6.2 對比修正提亮 #9B5DE5 → #B088EE（於 bg-card 達 WCAG AA）。
      navigational: { color: '#B088EE', zh: '導航型' },
    });
  });
});
