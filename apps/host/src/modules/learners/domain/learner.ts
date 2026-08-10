/**
 * Learner domain model.
 *
 * LAYERING: innermost layer of the `learners` module. Pure TypeScript — no
 * Supabase, no Next, no DB row shapes, no I/O. Every other layer may depend on
 * this file; this file depends on nothing.
 *
 * Field names are camelCase and deliberately DECOUPLED from both the `students`
 * table column names (snake_case — mapped in the infrastructure adapter) and the
 * public wire payload (mapped in the presentation DTO). Renaming a column or a
 * wire field must not require touching this file.
 *
 * P5: `grade` is a STRING ("6".."12") or null — never a number.
 */

export interface Learner {
  /** `students.id` — the learner's own primary key, NOT the auth user id. */
  id: string;
  /** `students.auth_user_id` — FK to auth.users. Null for unlinked rows. */
  authUserId: string | null;
  name: string | null;
  /** P5: always a string ("6".."12") or null. */
  grade: string | null;
  board: string | null;
  /** 'science' | 'commerce' | 'humanities' | null (DB CHECK constraint). */
  stream: string | null;
  /** Subscription plan code (`students.subscription_plan`). */
  plan: string | null;
  /** Preferred UI language (`students.preferred_language`). */
  language: string | null;
  /** Tenant column (`students.school_id`). Null for self-serve learners. */
  schoolId: string | null;
}
