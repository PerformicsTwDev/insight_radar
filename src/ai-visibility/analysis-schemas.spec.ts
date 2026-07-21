import { brandExtractionResponseFormat, brandExtractionSchema } from './brand-extraction.schema';
import { sentimentResponseFormat, sentimentSchema } from './sentiment.schema';
import {
  MEDIA_TYPES,
  mediaClassifierResponseFormat,
  mediaClassifierSchema,
} from './media-classifier.schema';

/**
 * TC-78 (部分) / FR-42 / NFR-19 — 搬移的三線輸出 Zod schema（Azure structured-outputs strict `json_schema`）。
 * 沿用 intent/journey 慣例（Design §4.2）：所有欄位 required、每物件 `additionalProperties:false`、root 非 anyOf、
 * enum-only（無 anyOf/const）、無 structured-outputs 不支援關鍵字、property ≤100、巢狀 ≤5。
 */

/** 遞迴數 object property 總數（上限 100）。 */
function countProperties(node: unknown): number {
  if (node === null || typeof node !== 'object') return 0;
  const obj = node as Record<string, unknown>;
  let count = 0;
  if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
    count += Object.keys(obj.properties).length;
  }
  for (const value of Object.values(obj)) count += countProperties(value);
  return count;
}

/** Schema 巢狀深度（上限 5；只沿 properties 與 items 下降）。 */
function schemaDepth(node: unknown): number {
  if (node === null || typeof node !== 'object') return 0;
  const obj = node as Record<string, unknown>;
  let childMax = 0;
  if (obj.properties && typeof obj.properties === 'object') {
    for (const child of Object.values(obj.properties as Record<string, unknown>)) {
      childMax = Math.max(childMax, schemaDepth(child));
    }
  }
  if (obj.items) childMax = Math.max(childMax, schemaDepth(obj.items));
  return obj.type === 'object' || obj.type === 'array' ? 1 + childMax : childMax;
}

/** 共用 strict-json-schema 守門（同 intent.schema.spec 慣例）。 */
function assertStrictStructuredOutputs(rf: {
  type: string;
  json_schema: { name: string; strict?: boolean | null; schema?: Record<string, unknown> };
}): void {
  const schema = rf.json_schema.schema as Record<string, unknown>;
  expect(rf.type).toBe('json_schema');
  expect(rf.json_schema.strict).toBe(true);
  // root 是 object、非 anyOf。
  expect(schema.type).toBe('object');
  expect(schema.anyOf).toBeUndefined();

  // 每個 object：additionalProperties:false + 所有 property required。
  const stack: unknown[] = [schema];
  let sawObject = false;
  while (stack.length) {
    const node = stack.pop();
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (obj.type === 'object') {
        sawObject = true;
        expect(obj.additionalProperties).toBe(false);
        if (obj.properties && typeof obj.properties === 'object') {
          const keys = Object.keys(obj.properties);
          const required = (obj.required as string[]) ?? [];
          expect(required.length).toBe(keys.length);
          expect(required).toEqual(expect.arrayContaining(keys));
        }
      }
      stack.push(...Object.values(obj));
    }
  }
  expect(sawObject).toBe(true);

  // 無 structured-outputs 不支援關鍵字（含 anyOf/const —— 0|1 必為 enum，非 union）。
  const FORBIDDEN = [
    'minItems',
    'maxItems',
    'uniqueItems',
    'pattern',
    'format',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'anyOf',
    'const',
    'propertyNames',
  ];
  const offenders: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN.includes(k)) offenders.push(k);
      walk(v);
    }
  };
  walk(schema);
  expect(offenders).toEqual([]);

  expect(countProperties(schema)).toBeLessThanOrEqual(100);
  expect(schemaDepth(schema)).toBeLessThanOrEqual(5);
}

describe('TC-78: brand-extraction schema (no-dedup exposure count)', () => {
  const rf = brandExtractionResponseFormat();

  it('is a strict json_schema named brand_extraction', () => {
    expect(rf.json_schema.name).toBe('brand_extraction');
    assertStrictStructuredOutputs(rf);
  });

  it('parses per-block brand arrays and PRESERVES duplicates (S17 no-dedup = exposure count)', () => {
    const parsed = brandExtractionSchema.parse({
      results: [{ id: 'b1', brands: ['ASUS', 'ASUS', 'Acer'] }],
    });
    expect(parsed.results[0].brands).toEqual(['ASUS', 'ASUS', 'Acer']);
  });

  it('rejects a result missing the brands array', () => {
    expect(() => brandExtractionSchema.parse({ results: [{ id: 'b1' }] })).toThrow();
  });
});

describe('TC-78: sentiment schema (positive/negative each 0|1)', () => {
  const rf = sentimentResponseFormat();

  it('is a strict json_schema named brand_sentiment', () => {
    expect(rf.json_schema.name).toBe('brand_sentiment');
    assertStrictStructuredOutputs(rf);
  });

  it('parses mixed sentiment as positive=1 AND negative=1 (S17 both-+1)', () => {
    const parsed = sentimentSchema.parse({
      results: [{ id: 't1', positive: 1, negative: 1 }],
    });
    expect(parsed.results[0]).toEqual({ id: 't1', positive: 1, negative: 1 });
  });

  it('rejects out-of-range sentiment values (only 0|1 allowed)', () => {
    expect(() =>
      sentimentSchema.parse({ results: [{ id: 't1', positive: 2, negative: 0 }] }),
    ).toThrow();
    expect(() =>
      sentimentSchema.parse({ results: [{ id: 't1', positive: true, negative: 0 }] }),
    ).toThrow();
  });
});

describe('TC-78: media-classifier schema (domain → enum)', () => {
  const rf = mediaClassifierResponseFormat();

  it('is a strict json_schema named media_classification', () => {
    expect(rf.json_schema.name).toBe('media_classification');
    assertStrictStructuredOutputs(rf);
  });

  it('exposes exactly the nine allowed media-type enum values', () => {
    expect([...MEDIA_TYPES]).toEqual([
      'ecommerce',
      'retail',
      'review',
      'news',
      'content',
      'blog',
      'social',
      'gov',
      'other',
    ]);
  });

  it('parses a valid classification and rejects an unknown type', () => {
    const parsed = mediaClassifierSchema.parse({
      references: [{ id: 'r1', type: 'ecommerce' }],
    });
    expect(parsed.references[0]).toEqual({ id: 'r1', type: 'ecommerce' });
    expect(() =>
      mediaClassifierSchema.parse({ references: [{ id: 'r1', type: 'newspaper' }] }),
    ).toThrow();
  });
});
