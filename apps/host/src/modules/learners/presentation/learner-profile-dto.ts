/**
 * Wire DTO for the learner profile.
 *
 * LAYERING: presentation. The ONLY place that knows the public field names. It
 * depends inward on the domain model and is depended on by the route handler.
 *
 * ⚠️ FROZEN CONTRACT — do not add, remove or rename a single field. This shape
 * is pinned by the Zod contract `StudentProfileResponse`
 * (`packages/lib/src/api/v2/contract.ts`) → `openapi/v2.json` → the generated
 * Flutter Dart client. Any change here is a breaking mobile-app change.
 *
 * P5: `grade` is a string or null.
 */

import type { Learner } from '../domain/learner';

export interface LearnerProfileDto {
  schemaVersion: 1;
  student_id: string;
  name: string | null;
  grade: string | null;
  board: string | null;
  stream: string | null;
  plan: string | null;
  language: string | null;
}

/** Domain model -> frozen v2 wire payload. */
export function toLearnerProfileDto(learner: Learner): LearnerProfileDto {
  return {
    schemaVersion: 1 as const,
    student_id: learner.id,
    name: learner.name,
    grade: learner.grade,
    board: learner.board,
    stream: learner.stream,
    plan: learner.plan,
    language: learner.language,
  };
}
