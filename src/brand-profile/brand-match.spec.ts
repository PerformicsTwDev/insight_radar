import {
  brandMatches,
  createBrandMatcher,
  findMatchingBrand,
  normalizedAliasUnion,
} from './brand-match';

/**
 * TC-76（FR-40 / AC-40.3）：aliases 聯集正規化比對純函式。以 `name + aliases` 聯集、經與去重/快取**同一套**
 * `normalizeText`（S4：NFKC → trim → collapse whitespace → lowercase）正規化後比對（如 `華碩→ASUS`）。
 * 供 FR-42 品牌抽取（M15）比對 AI 回答中的品牌提及共用。
 */
describe('TC-76: brand-match (aliases 聯集正規化比對純函式 · FR-40/AC-40.3)', () => {
  const asus = { name: 'ASUS', aliases: ['華碩', 'Asus'] };

  describe('normalizedAliasUnion', () => {
    it('聯集 name + aliases，各經 normalizeText 正規化（lowercase）', () => {
      expect(normalizedAliasUnion(asus)).toEqual(new Set(['asus', '華碩']));
    });

    it('去重（name 與某 alias 正規化後同一 → 只留一份）', () => {
      // 'ASUS' 與 alias 'asus' 正規化皆 'asus' → 聯集去重。
      const union = normalizedAliasUnion({ name: 'ASUS', aliases: ['asus', 'ASUS'] });
      expect(union).toEqual(new Set(['asus']));
      expect(union.size).toBe(1);
    });

    it('剔除空字串 / 純空白別名（正規化後為空不入聯集）', () => {
      const union = normalizedAliasUnion({ name: 'Acme', aliases: ['', '   ', '\t'] });
      expect(union).toEqual(new Set(['acme']));
    });

    it('NFKC + collapse whitespace + lowercase（全形/多空白收斂）', () => {
      // 全形 'ＡＳＵＳ' 經 NFKC → 'ASUS' → lowercase 'asus'；'Trail  Shoes' 多空白收斂。
      const union = normalizedAliasUnion({ name: 'ＡＳＵＳ', aliases: ['Trail  Shoes'] });
      expect(union.has('asus')).toBe(true);
      expect(union.has('trail shoes')).toBe(true);
    });

    it('無別名（空 aliases）→ 僅 name', () => {
      expect(normalizedAliasUnion({ name: 'Acme', aliases: [] })).toEqual(new Set(['acme']));
    });
  });

  describe('brandMatches', () => {
    it('別名命中：`華碩` → ASUS（AC-40.3 範例）', () => {
      expect(brandMatches('華碩', asus)).toBe(true);
    });

    it('大小寫不敏感：`asus` / `ASUS` 皆命中', () => {
      expect(brandMatches('asus', asus)).toBe(true);
      expect(brandMatches('  ASUS ', asus)).toBe(true); // 前後空白經 trim
    });

    it('name 本身命中', () => {
      expect(brandMatches('ASUS', asus)).toBe(true);
    });

    it('非該品牌 → 不命中', () => {
      expect(brandMatches('Acer', asus)).toBe(false);
    });

    it('空提及 → 不命中（正規化後為空，不在聯集）', () => {
      expect(brandMatches('   ', asus)).toBe(false);
    });
  });

  describe('findMatchingBrand', () => {
    const acer = { name: 'Acer', aliases: ['宏碁'] };
    const brands = [asus, acer];

    it('回第一個匹配的品牌（本品牌先於競品，呼叫端優先序）', () => {
      expect(findMatchingBrand('華碩', brands)).toBe(asus);
      expect(findMatchingBrand('宏碁', brands)).toBe(acer);
    });

    it('皆不匹配 → null', () => {
      expect(findMatchingBrand('Dell', brands)).toBeNull();
    });

    it('空清單 → null', () => {
      expect(findMatchingBrand('華碩', [])).toBeNull();
    });

    it('空提及（正規化後為空）→ null（不進聯集比對）', () => {
      expect(findMatchingBrand('   ', brands)).toBeNull();
    });

    it('多品牌含同義：正規化後比對（大小寫/全形不影響）', () => {
      expect(findMatchingBrand('ａｃｅｒ', brands)).toBe(acer); // 全形 → 'acer'
    });
  });

  // M14-R7/#583 [9]：預算式比對器——語意須與 findMatchingBrand 一致，且 union 於建構時快照一次（重用不重建）。
  describe('createBrandMatcher (預算式重用)', () => {
    const acer = { name: 'Acer', aliases: ['宏碁'] };
    const brands = [asus, acer];

    it('回傳可重複比對多個 mention 的比對器（語意同 findMatchingBrand）', () => {
      const match = createBrandMatcher(brands);
      expect(match('華碩')).toBe(asus);
      expect(match('宏碁')).toBe(acer);
      expect(match('ａｃｅｒ')).toBe(acer); // 全形 → 'acer'
      expect(match('Dell')).toBeNull();
      expect(match('   ')).toBeNull(); // 空提及（正規化後為空）
    });

    it('空品牌清單 → 比對器恆回 null', () => {
      const match = createBrandMatcher([]);
      expect(match('華碩')).toBeNull();
    });

    it('預算一次：建構後改動來源陣列不影響已建立的比對器（union 已快照）', () => {
      const mutable = [{ name: 'ASUS', aliases: ['華碩'] }];
      const match = createBrandMatcher(mutable);
      mutable.push({ name: 'Acer', aliases: ['宏碁'] });
      expect(match('宏碁')).toBeNull(); // 建構後才加入 → 不在預算表
      expect(match('華碩')).toBe(mutable[0]);
    });
  });
});
