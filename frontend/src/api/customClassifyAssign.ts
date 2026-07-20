import type { StatusFetch } from './keywordAnalyses';

/** RED shell (T5.2) — replaced by the real egress in green. */

export interface CustomClassifyRun {
  readonly jobId: string;
  readonly status: string;
  readonly progress: unknown;
  readonly keywordCount: number | null;
}

export type StartCustomClassifyAssignResult =
  { readonly ok: true; readonly jobId: string } | { readonly ok: false; readonly status: number };

export type FetchCustomClassifyRunResult =
  | { readonly ok: true; readonly run: CustomClassifyRun }
  | { readonly ok: false; readonly status: number };

export type RemoveCustomClassificationResult =
  { readonly ok: true } | { readonly ok: false; readonly status: number };

export function startCustomClassifyAssign(
  _id: string,
  _cid: string,
  _labels: readonly string[],
): Promise<StartCustomClassifyAssignResult> {
  throw new Error('not implemented: startCustomClassifyAssign');
}

export function fetchCustomClassifyRun(
  _id: string,
  _cid: string,
): Promise<FetchCustomClassifyRunResult> {
  throw new Error('not implemented: fetchCustomClassifyRun');
}

export function fetchCustomClassifyAssignStatus(_id: string, _cid: string): Promise<StatusFetch> {
  throw new Error('not implemented: fetchCustomClassifyAssignStatus');
}

export function removeCustomClassification(
  _id: string,
  _cid: string,
): Promise<RemoveCustomClassificationResult> {
  throw new Error('not implemented: removeCustomClassification');
}
