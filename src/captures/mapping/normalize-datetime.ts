/**
 * 中文在地化時間字串 → ISO-8601（AC-37.3 / FR-46；Design §18.5）——純函式。
 *
 * 例：`2025年11月21日 星期五 上午2:01` → `2025-11-21T02:01:00+08:00`。
 * - 解析 `YYYY年MM月DD日`；可選 `星期X`（忽略）；可選 `<meridiem> H:mm[:ss]`。
 * - meridiem：上午/凌晨/早上/清晨 = AM（12→00）；下午/中午 = 正午（12→12、其餘 +12）；
 *   晚上/傍晚 = 夜晚（**12→00 午夜**、1–11 → +12）；無 → 24 小時制原值。
 * - 無時間 → 當日 `T00:00:00`。**月曆有效性**（非僅 `day≤31`）：`2月30日`/`4月31日`/非閏年 `2月29日` → null；
 *   時分秒越界（時>23、分/秒>59）→ null（畸形，不靜默拼裝）。
 * - `offset` 參數（預設 `+08:00`，zh-TW / Threads 來源脈絡；來源字串本身無位移）——輸出的位移由呼叫端脈絡決定。
 * - 已是 ISO-8601（`YYYY-MM-DDThh:...`）→ **先做範圍驗證**（月曆 + 時分秒與 CJK 分支同標準；界外 → null），
 *   合法則原樣返回（honor 既有 offset，不重解讀）；純 ISO 日期 → 補 `T00:00:00`+offset。
 * - 缺值 / 非字串 / 不可解析 → **null**（不編造、不阻斷同批他筆，AC-37.4）。
 *
 * ⚠ 預設 `+08:00` 為骨架期依 zh-TW 來源脈絡的收斂選擇（來源字串無位移資訊）；Design §18.5 未明定位移，
 * 見任務筆記。跨來源 merge / 落庫轉 `Timestamptz` 屬 FR-46（T16.5），非本 task。
 */
const AM_MERIDIEMS = new Set(['上午', '凌晨', '早上', '清晨']);
// 正午系（下午/中午）：12→12（正午）、其餘 +12。
const NOON_MERIDIEMS = new Set(['下午', '中午']);
// 夜晚系（晚上/傍晚）：12→00（午夜，colloquial 半夜）、1–11 → +12。
const NIGHT_MERIDIEMS = new Set(['晚上', '傍晚']);

// 完整 ISO-8601 datetime（捕捉組件供範圍驗證；秒/小數秒/位移皆可選）。
const ISO_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CJK_DATE = /(\d{4})年(\d{1,2})月(\d{1,2})日/;
const CJK_TIME = /(上午|下午|凌晨|晚上|中午|傍晚|早上|清晨)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 月曆有效性：year/month/day 是否為存在的日期（含閏年 2 月）。month 為 1–12。 */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day <= maxDay;
}

/** 時分秒範圍（時 0–23、分/秒 0–59）。 */
function isValidTime(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

/**
 * 12 小時制 + meridiem → 24 小時制小時。
 * - AM（上午…）：12→0、其餘原值。
 * - 正午系（下午/中午）：12→12、其餘 +12。
 * - 夜晚系（晚上/傍晚）：12→0（午夜）、其餘 +12。
 * - 無 meridiem：原值（24 小時制）。
 */
function resolveHour(hour: number, meridiem: string | undefined): number {
  if (meridiem && AM_MERIDIEMS.has(meridiem)) {
    return hour === 12 ? 0 : hour;
  }
  if (meridiem && NIGHT_MERIDIEMS.has(meridiem)) {
    return hour === 12 ? 0 : hour + 12;
  }
  if (meridiem && NOON_MERIDIEMS.has(meridiem)) {
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

  // 已是完整 ISO-8601 → 先做範圍驗證（月曆 + 時分秒，與 CJK 分支同標準），合法則原樣返回（不重解讀既有位移）。
  const iso = ISO_DATETIME.exec(trimmed);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const hour = Number(iso[4]);
    const minute = Number(iso[5]);
    const second = iso[6] === undefined ? 0 : Number(iso[6]);
    if (!isValidCalendarDate(year, month, day) || !isValidTime(hour, minute, second)) {
      return null;
    }
    return trimmed;
  }
  // 純 ISO 日期（無時間）→ 補當日 00:00:00 + offset。
  const isoDate = ISO_DATE.exec(trimmed);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    if (!isValidCalendarDate(year, month, day)) {
      return null;
    }
    return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}T00:00:00${offset}`;
  }

  const date = CJK_DATE.exec(trimmed);
  if (!date) {
    return null;
  }
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  if (!isValidCalendarDate(year, month, day)) {
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
    if (!isValidTime(hour, minute, second)) {
      return null;
    }
  }

  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${offset}`;
}
