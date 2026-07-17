import {
  UNCLASSIFIED_LABEL,
  buildCustomAssignResponseFormat,
} from './custom-classify-assign.schema';

const LABELS = ['transactional', 'informational', 'navigational'];

describe('buildCustomAssignResponseFormat (T12.8 / FR-34 / AC-34.2 / TC-70 部分)', () => {
  it('builds a strict json_schema named custom_classification_assignments', () => {
    const rf = buildCustomAssignResponseFormat(LABELS);
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.name).toBe('custom_classification_assignments');
    expect(rf.json_schema.strict).toBe(true);
  });

  it('makes label a DYNAMIC enum of exactly the confirmed labels (S11)', () => {
    const schema = buildCustomAssignResponseFormat(LABELS).json_schema.schema as Record<
      string,
      unknown
    >;
    const item = (
      schema.properties as Record<
        string,
        { items: { properties: Record<string, { enum?: string[] }> } }
      >
    ).results.items;
    expect(item.properties.label.enum).toEqual(LABELS);
    // keyword is a free string, NOT an enum.
    expect(item.properties.keyword.enum).toBeUndefined();
  });

  it('never places the unclassified sentinel in the enum (post-process only, S11)', () => {
    const schema = buildCustomAssignResponseFormat(LABELS).json_schema.schema as Record<
      string,
      unknown
    >;
    const labelEnum = (
      schema.properties as Record<
        string,
        { items: { properties: Record<string, { enum: string[] }> } }
      >
    ).results.items.properties.label.enum;
    expect(labelEnum).not.toContain(UNCLASSIFIED_LABEL);
  });

  it('locks additionalProperties:false and requires every property (structured-outputs invariants)', () => {
    const schema = buildCustomAssignResponseFormat(LABELS).json_schema.schema as Record<
      string,
      unknown
    >;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['results']);

    const item = (schema.properties as Record<string, { items: Record<string, unknown> }>).results
      .items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(['keyword', 'label']);
  });

  it('carries no minItems/maxItems on results — count is a post-process concern (results=inputs)', () => {
    const schema = buildCustomAssignResponseFormat(LABELS).json_schema.schema as Record<
      string,
      unknown
    >;
    const results = (schema.properties as Record<string, Record<string, unknown>>).results;
    expect(results.minItems).toBeUndefined();
    expect(results.maxItems).toBeUndefined();
  });

  it('reflects a different confirmed-label set on each call (not frozen)', () => {
    const other = ['a', 'b'];
    const schema = buildCustomAssignResponseFormat(other).json_schema.schema as Record<
      string,
      unknown
    >;
    const labelEnum = (
      schema.properties as Record<
        string,
        { items: { properties: Record<string, { enum: string[] }> } }
      >
    ).results.items.properties.label.enum;
    expect(labelEnum).toEqual(other);
  });

  it('throws when no confirmed labels are given (cannot build an enum)', () => {
    expect(() => buildCustomAssignResponseFormat([])).toThrow(/at least one confirmed label/);
  });
});
