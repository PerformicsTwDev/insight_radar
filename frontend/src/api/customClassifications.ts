import { z } from 'zod';
import { api } from './client';

/**
 * Typed egress for `POST /api/v1/keyword-analyses/:id/custom-classifications`
 * (**stage one**, T5.1, FR-16; backend FR-34 / AC-34.1). The user gives a display
 * `name` + a classification `instruction`; the backend has the LLM design a set of
 * mutually-exclusive labels (HITL, awaiting confirmation) and answers 201 with the
 * classification. Business code calls this — never a bare `fetch` (single-egress,
 * Design §2/§3).
 *
 * **openapi gap (deviation, documented):** the generated `CustomClassifyDto` request
 * and the 201 body are both under-typed (`Record<string, never>` / `never`, #392
 * class). So we bind the **path** to the generated op (path drift → compile error),
 * send the real `{ name, instruction }` body cast-free via a `bodySerializer`
 * (openapi-fetch calls it whenever `body` is not `undefined`), and zod-validate the
 * untyped 201 response here (honest parse, not a cast). A 502 (generation failed —
 * AC-34.1, no half result), 409 (snapshot not ready), 404 (unknown / not owner),
 * 400, or an invalid 201 body all degrade to `ok:false` with the status.
 */

export interface CustomClassifyInput {
  readonly name: string;
  readonly instruction: string;
}

/** One LLM-designed label (backend `CustomLabel`). `description` may be empty. */
const CustomLabelSchema = z.object({
  label: z.string().min(1),
  description: z.string(),
});

/**
 * 201 body (backend FR-34 → `CustomClassification`). `labels` is required **and
 * non-empty** (`.min(1)`): a missing / empty-label result is a half/absent result and
 * must degrade to `ok:false` (AC-34.1 — the UI never shows a half classification;
 * mirrors `aiInsight`'s `insight: .min(1)`).
 */
const CustomClassificationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  instruction: z.string(),
  labels: z.array(CustomLabelSchema).min(1),
  createdAt: z.string(),
});

export type CustomLabel = z.infer<typeof CustomLabelSchema>;
export type CustomClassification = z.infer<typeof CustomClassificationSchema>;

export type GenerateCustomLabelsResult =
  | { readonly ok: true; readonly classification: CustomClassification }
  | { readonly ok: false; readonly status: number };

/**
 * Generate the stage-one label set for `{ name, instruction }`. Never throws — a 502
 * / 409 / 404 / 400, or an invalid 201 body, all degrade to `ok:false` so the modal
 * shows a clean error, never a half classification.
 */
export async function generateCustomLabels(
  id: string,
  input: CustomClassifyInput,
): Promise<GenerateCustomLabelsResult> {
  const { data, response } = await api.POST(
    '/api/v1/keyword-analyses/{id}/custom-classifications',
    {
      params: { path: { id } },
      // `CustomClassifyDto` is under-typed `Record<string, never>`; the serializer
      // sends the real `{ name, instruction }` cast-free.
      body: {},
      bodySerializer: () => JSON.stringify({ name: input.name, instruction: input.instruction }),
    },
  );

  if (response.ok) {
    const parsed = CustomClassificationSchema.safeParse(data);
    if (parsed.success) return { ok: true, classification: parsed.data };
    return { ok: false, status: response.status };
  }

  return { ok: false, status: response.status };
}
