/** Typed AI-ideation stub egress (T1.5, FR-20). — RED STUB — */

export interface AiIdeationRequest {
  readonly template: string;
  readonly seeds: string[];
}

export type AiIdeationResult =
  | { readonly ok: true; readonly keywords: string[] }
  | { readonly ok: false; readonly status: number };

export async function generateIdeas(_body: AiIdeationRequest): Promise<AiIdeationResult> {
  return Promise.reject(new Error('not implemented'));
}
