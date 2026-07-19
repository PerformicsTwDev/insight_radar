/**
 * 中文在地化時間字串 → ISO-8601（AC-37.3 / FR-46；Design §18.5）——純函式。
 *
 * 例：`2025年11月21日 星期五 上午2:01` → `2025-11-21T02:01:00+08:00`。
 * - 解析 `YYYY年MM月DD日`；可選 `星期X`（忽略）；可選 `<meridiem> H:mm[:ss]`。
 * - meridiem：上午/凌晨/早上/清晨 = AM（12→00）；下午/晚上/中午/傍晚 = PM（+12，12→12）；無 → 24 小時制原值。
 * - 無時間 → 當日 `T00:00:00`。範圍越界（月>12、日>31、時>23…）→ null（畸形，不靜默拼裝）。
 * - `offset` 參數（預設 `+08:00`，zh-TW / Threads 來源脈絡；來源字串本身無位移）——輸出的位移由呼叫端脈絡決定。
 * - 已是 ISO-8601（`YYYY-MM-DDThh:...`）→ 原樣返回（honor 既有 offset，不重解讀）；純 ISO 日期 → 補 `T00:00:00`+offset。
 * - 缺值 / 非字串 / 不可解析 → **null**（不編造、不阻斷同批他筆，AC-37.4）。
 *
 * ⚠ 預設 `+08:00` 為骨架期依 zh-TW 來源脈絡的收斂選擇（來源字串無位移資訊）；Design §18.5 未明定位移，
 * 見任務筆記。跨來源 merge / 落庫轉 `Timestamptz` 屬 FR-46（T16.5），非本 task。
 */
const AM_MERIDIEMS = new Set(['上午', '凌晨', '早上', '清晨']);
const PM_MERIDIEMS = new Set(['下午', '晚上', '中午', '傍晚']);

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CJK_DATE = /(\d{4})年(\d{1,2})月(\d{1,2})日/;
const CJK_TIME = /(上午|下午|凌晨|晚上|中午|傍晚|早上|清晨)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 12 小時制 + meridiem → 24 小時制小時（上午12→0、下午12→12）；無 meridiem → 原值。 */
function resolveHour(hour: number, meridiem: string | undefined): number {
  if (meridiem && AM_MERIDIEMS.has(meridiem)) {
    return hour === 12 ? 0 : hour;
  }
  if (meridiem && PM_MERIDIEMS.has(meridiem)) {
    return hour === 12 ? 12 : hour + 12;
  }
  return hour;
}

export function normalizeChineseDateTime(value: unknown, offset = '+08:00'): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  // 已是完整 ISO-8601 → 原樣（不重解讀既有位移）。
  if (ISO_DATETIME.test(trimmed)) {
    return trimmed;
  }
  // 純 ISO 日期（無時間）→ 補當日 00:00:00 + offset。
  const isoDate = ISO_DATE.exec(trimmed);
  if (isoDate) {
    return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}T00:00:00${offset}`;
  }

  const date = CJK_DATE.exec(trimmed);
  if (!date) {
    return null;
  }
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  let hour = 0;
  let minute = 0;
  let second = 0;
  const time = CJK_TIME.exec(trimmed);
  if (time) {
    hour = resolveHour(Number(time[2]), time[1]);
    minute = Number(time[3]);
    second = time[4] === undefined ? 0 : Number(time[4]);
    if (hour > 23 || minute > 59 || second > 59) {
      return null;
    }
  }

  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${offset}`;
}
