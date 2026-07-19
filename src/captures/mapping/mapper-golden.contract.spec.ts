import {
  aiChatGptV1Golden,
  aiGoogleAiModeV1Golden,
  mapperGoldens,
  socialThreadsSearchV1Golden,
} from './__fixtures__';
import type { MapperInput } from './canonical.types';
import { normalize } from './registry';

/**
 * TC-73（FR-37 AC-37.2 / NFR-17）——per-source/per-platform mapper 的 **golden fixtures + contract test（漂移守衛）**。
 *
 * 每個 `(source, discriminator, schemaVersion)` 一份 golden（`__fixtures__/`）：對 `normalize(rawInput)` 做 deep-equal
 * `expectedCanonical` + `mapStatus` + `reasons`；上游/extension raw 形狀改變 → 紅燈（漂移早期預警）。
 *
 * ⚠ 權威來源限制：golden **grounded in Design §18.2/§18.3/§18.5**（extension `type.ts` 不在本 workspace），
 * 待 **T13.6** 對照真實 `type.ts` 對帳（各 fixture header 註記）。`full-map`＝骨架完整收斂；`skeleton-partial`＝核心欄在、
 * per-channel/per-platform 專屬欄位尚未進骨架白名單 → `partial`（AC-37.4，**非 bug**；white-list 擴充屬 M14 T14.4 / M16 T16.5）。
 */
function payloadOf(golden: { input: MapperInput }): Record<string, unknown> {
  return golden.input.payload as Record<string, unknown>;
}

/** 淺拷貝並移除單一鍵（模擬上游 rename/移除欄位；避免 unused-var 的 rest-destructure）。 */
function omitKey(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const clone = { ...payload };
  delete clone[key];
  return clone;
}

describe('TC-73: capture mapper golden fixtures (contract + drift guard)', () => {
  describe('contract：normalize(rawInput) deep-equals golden expected', () => {
    it.each(mapperGoldens.map((golden) => [golden.id, golden] as const))('%s', (_id, golden) => {
      const result = normalize(golden.input);

      expect(result.mapStatus).toBe(golden.expected.mapStatus);
      expect(result.reasons).toEqual(golden.expected.reasons);
      expect(result.canonical).toEqual(golden.expected.canonical);
      // INV-4：raw 恆保留、identity 不換（可 reparse）。
      expect(result.raw).toBe(golden.input.payload);
    });
  });

  describe('golden 集合完整性（每 (source,discriminator,schemaVersion) 一份、涵蓋指定渠道/平台）', () => {
    it('六份 golden、id 唯一，涵蓋 AI 四渠道 + threadsSearch/threadsApi', () => {
      const ids = mapperGoldens.map((g) => g.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(
        expect.arrayContaining([
          'extension|chatGpt|v1',
          'extension|geminiApp|v1',
          'extension|googleAiMode|v1',
          'extension|googleSearch|v1',
          'extension|threads|v1',
          'threadsApi|threads|v1',
        ]),
      );
    });

    it('每份 golden 的 coverage 標記與實際 mapStatus 一致（full-map=ok、skeleton-partial=partial）', () => {
      for (const golden of mapperGoldens) {
        const expectedStatus = golden.coverage === 'full-map' ? 'ok' : 'partial';
        expect(golden.expected.mapStatus).toBe(expectedStatus);
      }
    });
  });

  // 漂移守衛：raw 形狀「多欄/少欄」→ mapStatus 變化（early-warning）。若上游 extension type.ts 改形狀，這些斷言先紅。
  describe('drift guard：上游/extension raw 形狀改變 → 紅', () => {
    it('full-map 多一個未知欄位 → ok 降 partial（新增欄位漂移預警）', () => {
      const drifted: MapperInput = {
        ...socialThreadsSearchV1Golden.input,
        payload: { ...payloadOf(socialThreadsSearchV1Golden), viewsCount: '2.1K' },
      };
      const result = normalize(drifted);
      expect(result.mapStatus).toBe('partial');
      expect(result.reasons).toContain('unknown_field:viewsCount');
    });

    it('核心欄位被 rename/移除（AI query）→ failed（缺核心欄漂移）', () => {
      const rest = omitKey(payloadOf(aiChatGptV1Golden), 'query');
      const result = normalize({ ...aiChatGptV1Golden.input, payload: rest });
      expect(result.mapStatus).toBe('failed');
      expect(result.reasons).toContain('missing:query');
    });

    it('核心欄位被 rename/移除（Social content）→ failed（缺核心欄漂移）', () => {
      const rest = omitKey(payloadOf(socialThreadsSearchV1Golden), 'content');
      const result = normalize({ ...socialThreadsSearchV1Golden.input, payload: rest });
      expect(result.mapStatus).toBe('failed');
      expect(result.reasons).toContain('missing:content');
    });

    it('skeleton-partial 的 extension 專屬欄位消失 → partial 升 ok（白名單對齊後應更新 golden）', () => {
      const rest = omitKey(payloadOf(aiGoogleAiModeV1Golden), 'relatedQuestions');
      const result = normalize({ ...aiGoogleAiModeV1Golden.input, payload: rest });
      expect(result.mapStatus).toBe('ok');
    });
  });
});
