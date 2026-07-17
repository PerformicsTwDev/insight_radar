import { ideationResponseFormat } from './ideation.schema';

describe('ideationResponseFormat (T12.10 / FR-35 / TC-71 部分)', () => {
  it('is a strict json_schema named ai_ideation', () => {
    const rf = ideationResponseFormat();
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.name).toBe('ai_ideation');
    expect(rf.json_schema.strict).toBe(true);
  });

  it('locks additionalProperties:false and requires keywords (structured-outputs invariants)', () => {
    const schema = ideationResponseFormat().json_schema.schema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['keywords']);
  });

  it('carries no minItems/maxItems on keywords — count is a post-process concern', () => {
    const schema = ideationResponseFormat().json_schema.schema as Record<string, unknown>;
    const keywords = (schema.properties as Record<string, Record<string, unknown>>).keywords;
    expect(keywords.minItems).toBeUndefined();
    expect(keywords.maxItems).toBeUndefined();
  });

  it('returns the same frozen response_format instance (no per-call rebuild)', () => {
    expect(ideationResponseFormat()).toBe(ideationResponseFormat());
  });
});
