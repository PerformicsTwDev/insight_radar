import type { Prisma } from '@prisma/client';
import {
  readCompetitorList,
  readStringList,
  toAliasWriteList,
  toBrandProfileView,
  toCompetitorWriteList,
} from './brand-profile.mapper';

/**
 * TC-76（FR-40）：BrandProfile 純映射（DB 列 ↔ 對外形狀）。write：DTO → 扁平欄 + JSON（缺省 []）；read：JSON 欄
 * （`Prisma.JsonValue`）→ typed `BrandEntry`，含**防禦性收斂**（非陣列/非字串/缺欄的髒 JSON → 安全預設，不外洩）。
 */
describe('TC-76: brand-profile mapper (row ↔ view 純映射 · FR-40)', () => {
  const createdAt = new Date('2026-07-20T00:00:00.000Z');

  describe('write mappers', () => {
    it('toAliasWriteList：undefined → []；否則原樣', () => {
      expect(toAliasWriteList(undefined)).toEqual([]);
      expect(toAliasWriteList(['華碩', 'Asus'])).toEqual(['華碩', 'Asus']);
    });

    it('toCompetitorWriteList：undefined → []；收斂 {name,aliases[],sites[]}（缺省 []）', () => {
      expect(toCompetitorWriteList(undefined)).toEqual([]);
      expect(
        toCompetitorWriteList([{ name: 'Acer', aliases: ['宏碁'], sites: ['acer.com'] }]),
      ).toEqual([{ name: 'Acer', aliases: ['宏碁'], sites: ['acer.com'] }]);
      // aliases/sites 缺 → []
      expect(toCompetitorWriteList([{ name: 'Dell' }])).toEqual([
        { name: 'Dell', aliases: [], sites: [] },
      ]);
    });
  });

  describe('toBrandProfileView', () => {
    it('扁平欄 → 巢狀 brand + competitors；不含 ownerId', () => {
      const view = toBrandProfileView({
        id: 'id-1',
        name: 'ASUS',
        aliases: ['華碩'],
        sites: ['asus.com'],
        competitors: [{ name: 'Acer', aliases: ['宏碁'], sites: ['acer.com'] }],
        createdAt,
      });
      expect(view).toEqual({
        id: 'id-1',
        brand: { name: 'ASUS', aliases: ['華碩'], sites: ['asus.com'] },
        competitors: [{ name: 'Acer', aliases: ['宏碁'], sites: ['acer.com'] }],
        createdAt,
      });
    });
  });

  describe('readStringList (防禦性收斂)', () => {
    it('陣列 → 原樣（僅保留字串元素）', () => {
      expect(readStringList(['a', 'b'])).toEqual(['a', 'b']);
      expect(readStringList(['a', 1, null, 'b'] as Prisma.JsonValue)).toEqual(['a', 'b']);
    });

    it('非陣列（object/string/null）→ []', () => {
      expect(readStringList({ foo: 'bar' })).toEqual([]);
      expect(readStringList('nope')).toEqual([]);
      expect(readStringList(null)).toEqual([]);
    });
  });

  describe('readCompetitorList (防禦性收斂)', () => {
    it('非陣列 → []', () => {
      expect(readCompetitorList({ foo: 'bar' })).toEqual([]);
      expect(readCompetitorList(null)).toEqual([]);
    });

    it('缺 name / 非物件元素 → name=""、aliases/sites 收斂 []', () => {
      expect(
        readCompetitorList([
          { aliases: ['x'] },
          'not-an-object',
          { name: 'Ok', sites: ['ok.com'] },
        ]),
      ).toEqual([
        { name: '', aliases: ['x'], sites: [] },
        { name: '', aliases: [], sites: [] },
        { name: 'Ok', aliases: [], sites: ['ok.com'] },
      ]);
    });
  });
});
