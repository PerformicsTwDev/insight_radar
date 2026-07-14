import { intentMap } from './intentMap';

// Token 快照（C2）：鎖定 I/C/T/N 的 color + 中文 label——任一漂移即紅（顏色/中文為對外語意契約）。
describe('intentMap (C2: 意圖色/中文單一來源)', () => {
  it('locks the 4 intent colors + zh labels (drift guard)', () => {
    expect(intentMap).toEqual({
      informational: { color: '#5BC0EB', zh: '資訊型' },
      commercial: { color: '#52b788', zh: '商業型' },
      transactional: { color: '#FFD166', zh: '交易型' },
      navigational: { color: '#9B5DE5', zh: '導航型' },
    });
  });
});
