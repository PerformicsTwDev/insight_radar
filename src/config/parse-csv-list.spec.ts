import { parseCsvList } from './parse-csv-list';

// M13-R6 [14]：共用 CSV list 解析單點（`app.parseOrigins` + `ingest.parseCsv` 去重委派之）。
// 特徵測試釘死現行為（split(',') → trim → filter-empty），確保抽取後行為守恆。
describe('parseCsvList (M13-R6)', () => {
  it('undefined → 空陣列（走 `?? ""` 分支）', () => {
    expect(parseCsvList(undefined)).toEqual([]);
  });

  it('空字串 → 空陣列', () => {
    expect(parseCsvList('')).toEqual([]);
  });

  it('單值 → 單元素陣列', () => {
    expect(parseCsvList('v1')).toEqual(['v1']);
  });

  it('去每個 token 的前後空白', () => {
    expect(parseCsvList('  v1  ')).toEqual(['v1']);
    expect(parseCsvList('v1, v2 ,  v3')).toEqual(['v1', 'v2', 'v3']);
  });

  it('多值逗號分隔 → 依序陣列', () => {
    expect(parseCsvList('http://a.test,http://b.test')).toEqual(['http://a.test', 'http://b.test']);
  });

  it('全空白/逗號 → 濾盡成空陣列', () => {
    expect(parseCsvList('   ,  ,')).toEqual([]);
  });

  it('中間空 token（連續逗號）→ 濾除', () => {
    expect(parseCsvList('v1,,v2')).toEqual(['v1', 'v2']);
  });
});
