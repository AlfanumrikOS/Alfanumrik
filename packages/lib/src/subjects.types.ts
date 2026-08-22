export type SubjectCode = string;
export type Stream = 'science' | 'commerce' | 'humanities' | null;
export type PlanCode = 'free' | 'starter' | 'pro' | 'unlimited';

export interface Subject {
  code: SubjectCode;
  name: string;
  nameHi: string;
  icon: string;
  color: string;
  subjectKind: 'cbse_core' | 'cbse_elective' | 'platform_elective';
  isCore: boolean;
  isLocked: boolean;
}

/**
 * Wire shape of `GET /api/student/subjects`.
 *
 * WHY `degraded` EXISTS
 * The route fails CLOSED: when `get_available_subjects` errors or returns no
 * rows it rebuilds the list from `grade_subject_map ⋈ subjects(is_active)`
 * and stamps EVERY row `isLocked: true`, because plan context is unavailable
 * on that path. That response is a normal HTTP 200, so a client cannot tell
 * it apart from a real answer — and the two are read completely differently
 * by a student:
 *
 *   real answer  → "this subject needs an upgrade"     (actionable, true)
 *   fallback     → "we could not establish your access" (not about the plan)
 *
 * Without a marker the UI renders the first sentence for the second
 * situation, i.e. it tells a paid Pro/Unlimited student to upgrade. The only
 * honest fix is for the producer to SAY it degraded; nothing on the client
 * can infer it (`unlocked.length === 0` is a legitimate free-tier state, and
 * plan tier is not a client-side authority on subject entitlement).
 *
 * STATUS: the route does NOT emit this field yet — `apps/host/src/app/api/
 * student/subjects/route.ts` is owned by backend and was being changed
 * concurrently when this contract was written. Consumers therefore treat
 * `undefined` as "not degraded" (fail-soft, no behaviour change today), and
 * the honest-failure UI lights up the moment the route sets it on its two
 * fallback returns (`v1_rpc_error`, `v1_empty_rows`).
 */
export interface SubjectsListResponse {
  subjects: Subject[];
  /** True when `subjects` came from the fail-closed fallback, not the RPC. */
  degraded?: boolean;
  /** Which fallback branch produced the list. Diagnostic only — never shown. */
  degradedReason?: 'v1_rpc_error' | 'v1_empty_rows';
}

export type SubjectWriteErrorReason =
  | 'grade' | 'stream' | 'plan' | 'inactive' | 'unknown' | 'max_subjects';

export interface SubjectWriteError {
  code: 'subject_not_allowed';
  subject: string;
  reason: SubjectWriteErrorReason;
  allowed: SubjectCode[];
}

export type OkOr<E> = { ok: true } | { ok: false; error: E };
