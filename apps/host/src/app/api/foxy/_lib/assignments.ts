/**
 * Foxy L1 open-assignments reader (approved design § 4.3).
 *
 * Given (studentId, subject) → the (up-to-3) EARLIEST-DUE open assignments
 * that the student has NOT yet submitted. Feeds the tier-2 `assigned_work`
 * rung on the new 7-tier next-action ladder (`ff_foxy_decide_ladder_v1`)
 * via `NextActionInputs.openAssignments`.
 *
 * Design decisions (why this shape):
 *
 *   • **Service-role client** (`supabaseAdmin`). The Foxy route already
 *     ran `authorizeRequest(request, 'foxy.chat', { requireStudentId })`
 *     upstream; this helper is called with THAT verified studentId and
 *     never with a client-supplied one. Reading assignments for a
 *     specific student via service-role is deliberate — it lets us do
 *     the anti-join server-side without a JWT context switch.
 *
 *   • **Two queries, anti-join in Node** — Supabase's PostgREST does not
 *     expose EXCEPT / anti-join cleanly. Instead: (1) fetch candidate
 *     `assignments` rows for the student's classes and subject; (2)
 *     fetch `assignment_submissions` for THIS student against those
 *     candidate assignment ids; (3) subtract in Node. Bounded to ≤ 3
 *     candidates so the second query is trivially cheap.
 *
 *   • **`status = 'active'`** — verified column name via architect's
 *     parallel index migration 20260811000001 (`WHERE status = 'active'`,
 *     TEXT column, not `is_active`). The migration's PARTIAL INDEX
 *     `idx_assignments_class_active_due` on (class_id, due_date) covers
 *     exactly this predicate.
 *
 *   • **`due_date >= now() OR due_date IS NULL`** — assignments with no
 *     due date are still "open"; overdue-but-active is out of scope for
 *     this rung (they belong to remediation, not next-action prompting).
 *
 *   • **Case-insensitive subject match** via `.ilike(subject, subject)` —
 *     assignment rows record subject codes as authored by teachers
 *     (MATH / Math / math all appear historically); the Foxy route
 *     normalizes but assignment rows do not. `ilike` without wildcards
 *     is a case-insensitive exact-match against a TEXT column.
 *
 *   • **Return shape matches `NextActionInputs.openAssignments`
 *     contract EXACTLY** (see packages/lib/src/learner-model/next-action.ts:77
 *     `OpenAssignmentInput`). Field names, string-typed grade (P5), and
 *     nullability all agree — this is a wire-compatible producer for the
 *     already-merged next-action consumer, no adapter required.
 *
 *   • **Never throws.** Cognitive/context loaders across the Foxy route
 *     universally fail-soft to empty state; this follows the same
 *     posture. A DB failure returns `[]` and logs; it does NOT abort a
 *     turn or bubble up.
 */

import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';

/**
 * Matches `NextActionInputs.openAssignments` (a.k.a. `OpenAssignmentInput`)
 * in packages/lib/src/learner-model/next-action.ts. Field names, types, and
 * nullability are intentionally identical.
 */
export interface OpenAssignment {
  assignmentId: string;
  title: string;
  subjectCode: string | null;
  /** P5: grade is a STRING ("6".."12") or null. NEVER an integer. */
  grade: string | null;
  /** ISO-8601 due date; null → treated as latest-sortable (NULLS LAST). */
  dueDate: string | null;
  chapter: string | null;
}

export interface LoadOpenAssignmentsResult {
  openAssignments: OpenAssignment[];
}

const MAX_OPEN_ASSIGNMENTS = 3;

interface CandidateRow {
  id: string;
  title: string | null;
  subject: string | null;
  grade: string | number | null;
  due_date: string | null;
  chapter: string | null;
}

interface SubmissionRow {
  assignment_id: string;
}

/**
 * Coerce a possibly-numeric `grade` column back to the P5 STRING contract.
 * The assignments table has historically been written as both text ("8")
 * and (rarely) numeric (8); we normalize to string-or-null here so the
 * NextActionInputs consumer never sees an integer.
 */
function coerceGradeString(g: string | number | null | undefined): string | null {
  if (g === null || g === undefined) return null;
  if (typeof g === 'string') {
    const t = g.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof g === 'number' && Number.isFinite(g)) return String(g);
  return null;
}

export async function loadOpenAssignments(
  studentId: string,
  subject: string,
): Promise<LoadOpenAssignmentsResult> {
  const empty: LoadOpenAssignmentsResult = { openAssignments: [] };
  if (!studentId || !subject) return empty;

  try {
    // 1. Roster: which classes does this student sit in?
    const { data: rosterRows, error: rosterErr } = await supabaseAdmin
      .from('class_students')
      .select('class_id')
      .eq('student_id', studentId)
      .eq('is_active', true);

    if (rosterErr) {
      console.error('[foxy:assignments] roster read failed', {
        studentId,
        error: rosterErr.message,
      });
      return empty;
    }

    const classIds = Array.from(
      new Set(
        (rosterRows ?? [])
          .map((r) => (r as { class_id: string | null }).class_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    if (classIds.length === 0) return empty;

    // 2. Candidate open assignments: subject + status='active' + not-overdue,
    //    earliest due first (NULLS LAST), capped at MAX.
    const nowIso = new Date().toISOString();

    const { data: candidateRows, error: candErr } = await supabaseAdmin
      .from('assignments')
      .select('id, title, subject, grade, due_date, chapter')
      .in('class_id', classIds)
      .ilike('subject', subject) // case-insensitive exact-match
      .eq('status', 'active')
      .or(`due_date.is.null,due_date.gte.${nowIso}`)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(MAX_OPEN_ASSIGNMENTS);

    if (candErr) {
      console.error('[foxy:assignments] candidate query failed', {
        studentId,
        subject,
        error: candErr.message,
      });
      return empty;
    }

    const candidates = (candidateRows ?? []) as CandidateRow[];
    if (candidates.length === 0) return empty;

    const candidateIds = candidates.map((c) => c.id);

    // 3. Anti-join in Node — which of those has THIS student already
    //    submitted? Bounded to <= MAX_OPEN_ASSIGNMENTS ids.
    const { data: subRows, error: subErr } = await supabaseAdmin
      .from('assignment_submissions')
      .select('assignment_id')
      .eq('student_id', studentId)
      .in('assignment_id', candidateIds);

    if (subErr) {
      console.error('[foxy:assignments] submissions read failed', {
        studentId,
        error: subErr.message,
      });
      // Fail-soft: return the un-filtered candidates rather than nothing.
      // A stale "already submitted" is better than starving the ladder.
      return {
        openAssignments: candidates.map(rowToOpenAssignment),
      };
    }

    const submittedIds = new Set(
      ((subRows ?? []) as SubmissionRow[])
        .map((r) => r.assignment_id)
        .filter((id): id is string => typeof id === 'string'),
    );

    const openAssignments = candidates
      .filter((c) => !submittedIds.has(c.id))
      .map(rowToOpenAssignment);

    return { openAssignments };
  } catch (e) {
    console.error('[foxy:assignments] fatal', {
      studentId,
      subject,
      error: (e as Error)?.message,
    });
    return empty;
  }
}

function rowToOpenAssignment(row: CandidateRow): OpenAssignment {
  return {
    assignmentId: row.id,
    title: (row.title ?? '').toString(),
    subjectCode: row.subject ?? null,
    grade: coerceGradeString(row.grade),
    dueDate: row.due_date ?? null,
    chapter: row.chapter ?? null,
  };
}
