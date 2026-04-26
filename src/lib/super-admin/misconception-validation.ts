// src/lib/super-admin/misconception-validation.ts
// Input validation for /api/super-admin/misconceptions POST.
// Extracted from the route module so it can be unit-tested without mocking
// supabase-admin or rbac.
//
// Contract:
//   - Returns the validated payload object on success.
//   - Returns a string error code on failure (one of the constants below)
//     so the route can return that exact code in the 400 response and tests
//     can assert against the constant.

export const VALIDATION_ERRORS = [
  'body_not_object',
  'question_id_invalid',
  'distractor_index_invalid',
  'misconception_code_invalid',
  'misconception_label_invalid',
  'misconception_label_hi_invalid',
] as const;

export type ValidationError = typeof VALIDATION_ERRORS[number];

export interface CuratePayload {
  question_id: string;
  distractor_index: number;
  misconception_code: string;
  misconception_label: string;
  misconception_label_hi?: string;
  remediation_chunk_id?: string;
  remediation_concept_id?: string;
}

export const MISCONCEPTION_CODE_REGEX = /^[a-z][a-z0-9_-]{2,63}$/;

export function validateCuratePayload(body: unknown): CuratePayload | ValidationError {
  if (!body || typeof body !== 'object') return 'body_not_object';
  const b = body as Record<string, unknown>;

  if (typeof b.question_id !== 'string' || b.question_id.length < 16) {
    return 'question_id_invalid';
  }
  if (
    typeof b.distractor_index !== 'number' ||
    !Number.isInteger(b.distractor_index) ||
    b.distractor_index < 0 ||
    b.distractor_index > 3
  ) {
    return 'distractor_index_invalid';
  }
  if (
    typeof b.misconception_code !== 'string' ||
    !MISCONCEPTION_CODE_REGEX.test(b.misconception_code)
  ) {
    return 'misconception_code_invalid';
  }
  if (
    typeof b.misconception_label !== 'string' ||
    b.misconception_label.trim().length < 5 ||
    b.misconception_label.length > 200
  ) {
    return 'misconception_label_invalid';
  }
  if (
    b.misconception_label_hi !== undefined &&
    (typeof b.misconception_label_hi !== 'string' || b.misconception_label_hi.length > 200)
  ) {
    return 'misconception_label_hi_invalid';
  }

  return {
    question_id: b.question_id,
    distractor_index: b.distractor_index,
    misconception_code: b.misconception_code,
    misconception_label: b.misconception_label.trim(),
    misconception_label_hi:
      typeof b.misconception_label_hi === 'string'
        ? b.misconception_label_hi.trim()
        : undefined,
    remediation_chunk_id:
      typeof b.remediation_chunk_id === 'string' ? b.remediation_chunk_id : undefined,
    remediation_concept_id:
      typeof b.remediation_concept_id === 'string' ? b.remediation_concept_id : undefined,
  };
}
