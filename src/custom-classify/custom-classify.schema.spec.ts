import { customLabelResponseFormat } from './custom-classify.schema';

describe('customLabelResponseFormat (T12.7 / FR-34 / TC-70 部分)', () => {
  it('is a strict json_schema named custom_classification_labels', () => {
    const rf = customLabelResponseFormat();
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.name).toBe('custom_classification_labels');
    expect(rf.json_schema.strict).toBe(true);
  });

  it('locks additionalProperties:false and requires every property (structured-outputs invariants)', () => {
    const schema = customLabelResponseFormat().json_schema.schema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['labels']);

    const item = (schema.properties as Record<string, { items: Record<string, unknown> }>).labels
      .items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(['label', 'description']);
  });

  it('carries no maxItems on labels — the count cap is a post-process concern, not schema', () => {
    const schema = customLabelResponseFormat().json_schema.schema as Record<string, unknown>;
    const labels = (schema.properties as Record<string, Record<string, unknown>>).labels;
    expect(labels.maxItems).toBeUndefined();
    expect(labels.minItems).toBeUndefined();
  });

  it('returns the same frozen response_format instance on repeated calls (no per-call rebuild)', () => {
    expect(customLabelResponseFormat()).toBe(customLabelResponseFormat());
  });
});
