import 'reflect-metadata'; // @Type/@Transform 需要（Nest app 於 bootstrap 匯入；unit 測試須自帶）
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FilterKeywordsQueryDto } from './filter-keywords-query.dto';

async function check(input: Record<string, unknown>): Promise<{
  dto: FilterKeywordsQueryDto;
  props: string[];
  count: number;
}> {
  const dto = plainToInstance(FilterKeywordsQueryDto, input);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, props: errors.map((e) => e.property), count: errors.length };
}

describe('FilterKeywordsQueryDto (T5.4 / FR-7 / TC-9)', () => {
  it('rejects min > max on volume / cpc / competitionIndex ranges', async () => {
    expect((await check({ volumeMin: 200, volumeMax: 100 })).props).toContain('volumeMin');
    expect((await check({ cpcMin: 5, cpcMax: 1 })).props).toContain('cpcMin');
    expect((await check({ competitionIndexMin: 80, competitionIndexMax: 10 })).props).toContain(
      'competitionIndexMin',
    );
  });

  it('accepts a valid range including the equal boundary', async () => {
    expect((await check({ volumeMin: 100, volumeMax: 200 })).count).toBe(0);
    expect((await check({ cpcMin: 5, cpcMax: 5 })).count).toBe(0);
  });

  it('rejects an unknown intentMode (not any/all)', async () => {
    expect((await check({ intentMode: 'bogus' })).props).toContain('intentMode');
  });

  it('accepts intentMode any/all and defaults to any', async () => {
    expect((await check({ intentMode: 'all' })).count).toBe(0);
    const { dto, count } = await check({});
    expect(count).toBe(0);
    expect(dto.intentMode).toBe('any');
  });

  it('coerces numeric query strings to numbers', async () => {
    const { dto, count } = await check({ volumeMin: '100', volumeMax: '200' });
    expect(count).toBe(0);
    expect(dto.volumeMin).toBe(100);
    expect(typeof dto.volumeMin).toBe('number');
  });

  it('normalizes a single intent/competition value into an array', async () => {
    const { dto } = await check({ intent: 'informational', competition: 'LOW' });
    expect(dto.intent).toEqual(['informational']);
    expect(dto.competition).toEqual(['LOW']);
  });

  it('keeps intent/competition arrays as arrays', async () => {
    const { dto, count } = await check({ intent: ['informational', 'commercial'] });
    expect(count).toBe(0);
    expect(dto.intent).toEqual(['informational', 'commercial']);
  });

  it('rejects an undeclared field (whitelist + forbidNonWhitelisted)', async () => {
    expect((await check({ bogus: 1 })).props).toContain('bogus');
  });

  it('rejects invalid sortBy / sortDir', async () => {
    expect((await check({ sortDir: 'sideways' })).props).toContain('sortDir');
    expect((await check({ sortBy: 'nope' })).props).toContain('sortBy');
  });

  it('accepts valid sort + pagination and coerces page/pageSize', async () => {
    const { dto, count } = await check({
      sortBy: 'cpcLow',
      sortDir: 'asc',
      page: '2',
      pageSize: '25',
      q: 'shoe',
    });
    expect(count).toBe(0);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(25);
    expect(dto.sortBy).toBe('cpcLow');
  });

  it('rejects page / pageSize < 1', async () => {
    expect((await check({ page: 0 })).props).toContain('page');
    expect((await check({ pageSize: 0 })).props).toContain('pageSize');
  });
});
