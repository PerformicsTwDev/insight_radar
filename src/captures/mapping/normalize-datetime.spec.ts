import { normalizeChineseDateTime } from './normalize-datetime';

describe('normalizeChineseDateTime (AC-37.3 / FR-46 中文時間 → ISO)', () => {
  it('標準例：年月日 + 星期（忽略）+ 上午/下午時間 → ISO（預設 +08:00）', () => {
    expect(normalizeChineseDateTime('2025年11月21日 星期五 上午2:01')).toBe(
      '2025-11-21T02:01:00+08:00',
    );
    expect(normalizeChineseDateTime('2025年11月21日 星期五 下午2:01')).toBe(
      '2025-11-21T14:01:00+08:00',
    );
  });

  it('補零：個位月/日/時 → 兩位', () => {
    expect(normalizeChineseDateTime('2025年1月5日 上午9:07')).toBe('2025-01-05T09:07:00+08:00');
  });

  it('12 小時制邊界：上午12→00（午夜）、下午12→12（正午）', () => {
    expect(normalizeChineseDateTime('2025年11月21日 上午12:30')).toBe('2025-11-21T00:30:00+08:00');
    expect(normalizeChineseDateTime('2025年11月21日 下午12:30')).toBe('2025-11-21T12:30:00+08:00');
  });

  it('凌晨（AM）/ 晚上（PM）別名', () => {
    expect(normalizeChineseDateTime('2025年11月21日 凌晨3:00')).toBe('2025-11-21T03:00:00+08:00');
    expect(normalizeChineseDateTime('2025年11月21日 晚上8:00')).toBe('2025-11-21T20:00:00+08:00');
  });

  it('含秒 / 24 小時制無 meridiem', () => {
    expect(normalizeChineseDateTime('2025年11月21日 下午2:01:30')).toBe(
      '2025-11-21T14:01:30+08:00',
    );
    expect(normalizeChineseDateTime('2025年11月21日 14:05')).toBe('2025-11-21T14:05:00+08:00');
  });

  it('無時間部分 → 當日 00:00:00', () => {
    expect(normalizeChineseDateTime('2025年11月21日')).toBe('2025-11-21T00:00:00+08:00');
  });

  it('offset 參數可覆寫（來源脈絡非 zh-TW 時）', () => {
    expect(normalizeChineseDateTime('2025年11月21日', '+00:00')).toBe('2025-11-21T00:00:00+00:00');
  });

  it('已是 ISO-8601 → 原樣（honor 既有 offset、不重解讀）', () => {
    expect(normalizeChineseDateTime('2025-11-21T02:01:00+08:00')).toBe('2025-11-21T02:01:00+08:00');
    expect(normalizeChineseDateTime('2025-11-14T16:00:00Z')).toBe('2025-11-14T16:00:00Z');
  });

  it('純 ISO 日期（無 T）→ 補 00:00:00 + offset', () => {
    expect(normalizeChineseDateTime('2025-11-21')).toBe('2025-11-21T00:00:00+08:00');
  });

  it('缺值 / 不可解析 / 非字串 → null（不編造，不阻斷同批）', () => {
    expect(normalizeChineseDateTime(null)).toBeNull();
    expect(normalizeChineseDateTime(undefined)).toBeNull();
    expect(normalizeChineseDateTime('')).toBeNull();
    expect(normalizeChineseDateTime('hello world')).toBeNull();
    expect(normalizeChineseDateTime(1_732_000_000)).toBeNull();
    expect(normalizeChineseDateTime({})).toBeNull();
  });

  it('超出範圍的年月日 → null（畸形，不靜默拼裝）', () => {
    expect(normalizeChineseDateTime('2025年13月01日')).toBeNull();
    expect(normalizeChineseDateTime('2025年12月32日')).toBeNull();
    expect(normalizeChineseDateTime('2025年11月21日 下午25:00')).toBeNull();
  });
});
