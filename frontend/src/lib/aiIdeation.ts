/** AI-ideation pure helpers (T1.5, FR-20; C7 dedupe key). — RED STUB — */

export interface AiIdeationTemplate {
  readonly id: string;
  readonly label: string;
}

export const AI_IDEATION_TEMPLATES: readonly AiIdeationTemplate[] = [];

export function normalizeSeed(_text: string): string {
  throw new Error('not implemented');
}

export function appendDedupedSeeds(_existing: string[], _generated: string[]): string[] {
  throw new Error('not implemented');
}
