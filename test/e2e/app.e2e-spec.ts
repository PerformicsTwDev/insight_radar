// T0.2 red：先放一個「必失敗」的 dummy，驗證 e2e runner 設定正確、會回報失敗（Task.md T0.2）。
// green 階段以真正的 e2e harness（用 createTestApp 啟動 Nest app + 驗 /api/v1 前綴）取代本檔。
describe('e2e runner (red placeholder)', () => {
  it('reports a deliberate failure (replaced by the real harness in green)', () => {
    expect('green').toBe('red');
  });
});
