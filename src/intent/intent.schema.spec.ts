import { INTENT_LABELS, INTENT_SCHEMA_VERSION, intentResponseFormat } from './intent.schema';

/** 遞迴數出整份 JSON schema 的 object property 總數（structured-outputs 上限 100）。 */
function countProperties(node: unknown): number {
  if (node === null || typeof node !== 'object') {
    return 0;
  }
  const obj = node as Record<string, unknown>;
  let count = 0;
  if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
    count += Object.keys(obj.properties).length;
  }
  for (const value of Object.values(obj)) {
    count += countProperties(value);
  }
  return count;
}

/**
 * Schema 巢狀深度（structured-outputs 上限 5）。只沿 JSON-schema 結構下降
 * （object 的 `properties.*`、array 的 `items`），不把 `enum`/`required` 等值陣列當層數。
 */
function schemaDepth(node: unknown): number {
  if (node === null || typeof node !== 'object') {
    return 0;
  }
  const obj = node as Record<string, unknown>;
  let childMax = 0;
  if (obj.properties && typeof obj.properties === 'object') {
    for (const child of Object.values(obj.properties as Record<string, unknown>)) {
      childMax = Math.max(childMax, schemaDepth(child));
    }
  }
  if (obj.items) {
    childMax = Math.max(childMax, schemaDepth(obj.items));
  }
  // 計入本層（object/array schema）為一層。
  return obj.type === 'object' || obj.type === 'array' ? 1 + childMax : childMax;
}

describe('intent json_schema (T2.2 / TC-15 部分)', () => {
  const rf = intentResponseFormat();
  const schema = rf.json_schema.schema as Record<string, unknown>;

  it('is a strict json_schema response format named intent_labeling', () => {
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.name).toBe('intent_labeling');
  });

  it('constrains labels to the four intent enum values', () => {
    const results = (schema.properties as Record<string, { items?: unknown }>).results;
    const item = (results as { items: { properties: Record<string, unknown> } }).items;
    const labels = item.properties.labels as { items: { enum: string[] } };
    expect(labels.items.enum).toEqual([
      'informational',
      'commercial',
      'transactional',
      'navigational',
    ]);
    expect(INTENT_LABELS).toEqual(['informational', 'commercial', 'transactional', 'navigational']);
  });

  it('forbids additionalProperties on every object (structured-outputs requirement)', () => {
    const stack: unknown[] = [schema];
    let sawObject = false;
    while (stack.length) {
      const node = stack.pop();
      if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        if (obj.type === 'object') {
          sawObject = true;
          expect(obj.additionalProperties).toBe(false);
        }
        stack.push(...Object.values(obj));
      }
    }
    expect(sawObject).toBe(true);
  });

  it('marks every object property as required (no optional fields)', () => {
    const stack: unknown[] = [schema];
    while (stack.length) {
      const node = stack.pop();
      if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
          const keys = Object.keys(obj.properties);
          const required = (obj.required as string[]) ?? [];
          expect(required).toEqual(expect.arrayContaining(keys));
          expect(required.length).toBe(keys.length);
        }
        stack.push(...Object.values(obj));
      }
    }
  });

  it('root is an object (not anyOf)', () => {
    expect(schema.type).toBe('object');
    expect(schema.anyOf).toBeUndefined();
  });

  it('stays well within the structured-outputs limits (≤100 props, ≤5 deep)', () => {
    expect(countProperties(schema)).toBeLessThanOrEqual(100);
    expect(schemaDepth(schema)).toBeLessThanOrEqual(5);
  });

  it('emits NO structured-outputs-unsupported keywords (Azure rejects these)', () => {
    // Design §4.2：array 的 minItems/maxItems/uniqueItems、string 的 pattern/format/minLength/maxLength
    // 皆不支援。zod 的 .min()/.regex()/.email() 會生這些 → Azure 直接拒絕（單元測物件抓不到，故顯式守門）。
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
  });

  it('exposes a schema version for cache namespacing', () => {
    expect(typeof INTENT_SCHEMA_VERSION).toBe('string');
    expect(INTENT_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });
});
