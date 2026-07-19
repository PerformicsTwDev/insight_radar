import 'reflect-metadata'; // @Transform 需要（Nest app 於 bootstrap 匯入；unit 測試須自帶）
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetSeriesQueryDto, normalizeIsoBoundary } from './get-series-query.dto';

/**
 * TC-66（FR-30 · AC-30.3）：`GET /tracking-lists/:listId/series` 的 `from`/`to` ISO 8601 邊界解析——
 * **deployment-tz-independent**。核心 bug（#471-2）：`new Date('2026-01-15T00:00:00')`（無 offset 的 date-TIME）
 * 依 JS 規範以**伺服器本地時區**解析，而 date-only `'2026-01-15'` 以 **UTC** 解析——同一 API 兩種畸形基準、
 * 非 UTC 部署上視窗邊界會位移 UTC offset。修正：無 offset 的輸入一律以 **UTC** 解讀（與 date-only 一致、
 * 部署時區無關），顯式帶 offset（`Z` / `±HH:MM`）則尊重之。
 *
 * 純字串正規化 `normalizeIsoBoundary` 為 **tz-independent** 斷言（不依賴跑測機器時區），DTO 端到端 epoch
 * 斷言則用顯式/UTC 基準（同樣 tz-independent）。
 */

async function transform(input: Record<string, unknown>): Promise<{
  dto: GetSeriesQueryDto;
  props: string[];
}> {
  const dto = plainToInstance(GetSeriesQueryDto, input);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, props: errors.map((e) => e.property) };
}

describe('TC-66: GetSeriesQueryDto from/to ISO parsing (unit · FR-30 · AC-30.3)', () => {
  describe('normalizeIsoBoundary: offsetless → UTC, explicit offset honored (tz-independent)', () => {
    it('appends Z to an offsetless date-time (parse as UTC, not server-local)', () => {
      expect(normalizeIsoBoundary('2026-01-15T00:00:00')).toBe('2026-01-15T00:00:00Z');
      expect(normalizeIsoBoundary('2026-01-15T12:30')).toBe('2026-01-15T12:30Z');
      expect(normalizeIsoBoundary('2026-01-15T12:30:00.123')).toBe('2026-01-15T12:30:00.123Z');
    });

    it('leaves a date-only value untouched (already UTC per ES spec)', () => {
      expect(normalizeIsoBoundary('2026-01-15')).toBe('2026-01-15');
    });

    it('honors an explicit UTC (Z) or numeric offset — no rewrite', () => {
      expect(normalizeIsoBoundary('2026-01-15T00:00:00Z')).toBe('2026-01-15T00:00:00Z');
      expect(normalizeIsoBoundary('2026-01-15T00:00:00+08:00')).toBe('2026-01-15T00:00:00+08:00');
      expect(normalizeIsoBoundary('2026-01-15T00:00:00-0530')).toBe('2026-01-15T00:00:00-0530');
    });

    it('leaves non-ISO garbage untouched (→ Invalid Date → 400 downstream, not silently coerced)', () => {
      expect(normalizeIsoBoundary('garbage')).toBe('garbage');
    });
  });

  describe('DTO transform: window boundaries land on deterministic UTC epochs', () => {
    it('offsetless date-time → UTC midnight (deployment-tz independent)', async () => {
      const { dto, props } = await transform({ from: '2026-01-15T00:00:00' });
      expect(props).toEqual([]);
      expect(dto.from?.getTime()).toBe(Date.UTC(2026, 0, 15, 0, 0, 0));
    });

    it('date-only → UTC midnight (consistent with the date-time case)', async () => {
      const { dto } = await transform({ to: '2026-01-15' });
      expect(dto.to?.getTime()).toBe(Date.UTC(2026, 0, 15, 0, 0, 0));
    });

    it('explicit +08:00 offset is honored (not reinterpreted as UTC/local)', async () => {
      const { dto, props } = await transform({ from: '2026-01-15T00:00:00+08:00' });
      expect(props).toEqual([]);
      // 2026-01-15 00:00 +08:00 == 2026-01-14 16:00Z
      expect(dto.from?.getTime()).toBe(Date.UTC(2026, 0, 14, 16, 0, 0));
    });

    it('explicit Z is honored', async () => {
      const { dto } = await transform({ to: '2026-01-15T06:30:00Z' });
      expect(dto.to?.getTime()).toBe(Date.UTC(2026, 0, 15, 6, 30, 0));
    });

    it('empty string / missing → undefined (no bound set)', async () => {
      const { dto } = await transform({ from: '', to: undefined });
      expect(dto.from).toBeUndefined();
      expect(dto.to).toBeUndefined();
    });

    it('malformed value → validation error (400), never a silent Invalid Date', async () => {
      const { props } = await transform({ from: 'not-a-date' });
      expect(props).toContain('from');
    });
  });
});
