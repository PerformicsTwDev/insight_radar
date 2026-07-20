/**
 * TODO(T5.1 GREEN): typed egress for `POST /:id/custom-classifications` (stage one,
 * FR-16 / backend FR-34). Not-implemented shell for the RED commit — signatures are
 * final so the tests compile; behaviour lands in GREEN.
 */

export interface CustomClassifyInput {
  readonly name: string;
  readonly instruction: string;
}

export interface CustomLabel {
  readonly label: string;
  readonly description: string;
}

export interface CustomClassification {
  readonly id: string;
  readonly name: string;
  readonly instruction: string;
  readonly labels: readonly CustomLabel[];
  readonly createdAt: string;
}

export type GenerateCustomLabelsResult =
  | { readonly ok: true; readonly classification: CustomClassification }
  | { readonly ok: false; readonly status: number };

export function generateCustomLabels(
  _id: string,
  _input: CustomClassifyInput,
): Promise<GenerateCustomLabelsResult> {
  throw new Error('not implemented: generateCustomLabels (T5.1 GREEN)');
}
