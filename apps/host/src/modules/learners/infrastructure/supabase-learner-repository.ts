/**
 * Supabase adapter for the LearnerRepository port.
 *
 * LAYERING: infrastructure. This is the ONLY file in the `learners` module that
 * knows the `students` table exists or that PostgREST is involved. It depends
 * inward (domain port + shared errors) and is depended on by nothing except the
 * composition root (the route handler).
 *
 * SECURITY (P8): this adapter NEVER constructs a client — it receives one by
 * injection. The route composes it with `createSupabaseRouteClient(request)`,
 * which is RLS-scoped on both the Bearer (mobile) and cookie (web) paths. The
 * service-role client must never be passed here. The own-row read is served by
 * the `students_select_merged` SELECT policy
 * (`auth_user_id = (SELECT auth.uid()) OR is_teacher_of(id) OR is_guardian_of(id)`).
 *
 * P13: the raw PostgREST error is attached as `cause`, never interpolated into a
 * message that could carry row data.
 *
 * TRANSITIONAL DUPLICATION — read before "deduping" this file.
 * Twin: `packages/lib/src/domains/identity.ts` (`getStudentByAuthUserId()` /
 * `mapStudent()` / `STUDENT_COLUMNS`) reads the same table by the same key, but the
 * two are NOT interchangeable. This adapter is RLS-scoped (injected request client,
 * `students_select_merged` owner branch); the twin uses the service-role client
 * (`supabaseAdmin`) and so bypasses RLS. `scripts/admin-client-allowlist.json`
 * ledgers only DIRECT `supabase-admin` imports in route files, so transitive
 * service-role use via the twin is NOT captured by it — as of this change exactly
 * one route consumes `getStudentByAuthUserId` (`api/support/ticket/route.ts`), and
 * that route is ledgered for its own direct import, not this call. The column sets
 * also differ deliberately: this projection carries `stream`, `subscription_plan`,
 * `preferred_language`, `school_id`; the twin carries `email`, `is_active`. The
 * duplication is intentional and scoped to the `learners` module.
 *
 * A future consolidation must: (a) NOT simply repoint `getStudentByAuthUserId` at
 * this port — its callers are service-role and must migrate as a BATCH, or the RLS
 * gain is silently reverted and the allowlist ledger goes stale; (b) collapse the
 * three student-shaped types (`packages/lib/src/types.ts` snake_case `Student`,
 * `packages/lib/src/domains/types.ts` camelCase `Student`, and `Learner`) onto one
 * camelCase domain type with a SINGLE P5 grade-coercion site; (c) decide whether
 * `LEARNER_COLUMNS`/`STUDENT_COLUMNS` are one projection or two named projections of
 * one schema type; (d) decide whether this module is promoted to `packages/lib` (the
 * canonical shared location per CLAUDE.md) — required the moment a second workspace
 * consumes it.
 */

import type { Database, TypedSupabaseClient } from '@/infrastructure/database';
import type { Learner } from '../domain/learner';
import type { LearnerRepository } from '../domain/learner-repository';
import { RepositoryError } from '@/shared/errors';

/**
 * Explicit column list — never `select('*')`. Keeps the wire payload, the RLS
 * surface and this projection reviewable in one place.
 */
const LEARNER_COLUMNS =
  'id, auth_user_id, name, grade, board, stream, subscription_plan, preferred_language, school_id' as const;

/** The snake_case row shape this adapter reads, narrowed from the generated schema. */
type StudentsRow = Database['public']['Tables']['students']['Row'];
type LearnerRow = Pick<
  StudentsRow,
  | 'id'
  | 'auth_user_id'
  | 'name'
  | 'grade'
  | 'board'
  | 'stream'
  | 'subscription_plan'
  | 'preferred_language'
  | 'school_id'
>;

export class SupabaseLearnerRepository implements LearnerRepository {
  /**
   * @param client An RLS-scoped, request-bound Supabase client. MUST NOT be the
   *               service-role client.
   */
  constructor(private readonly client: TypedSupabaseClient) {}

  async findByAuthUserId(authUserId: string): Promise<Learner | null> {
    const { data, error } = await this.client
      .from('students')
      .select(LEARNER_COLUMNS)
      // Defense-in-depth on top of RLS: the policy already restricts the row set
      // to `auth_user_id = auth.uid()`, but the filter is stated explicitly so a
      // future policy change cannot silently widen this read. The check is on
      // auth_user_id — NEVER on students.id, which is a different uuid.
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('Learner lookup failed', error);
    }
    if (!data) return null;

    return toLearner(data as LearnerRow);
  }
}

/** Single snake_case row -> camelCase domain mapper. */
function toLearner(row: LearnerRow): Learner {
  return {
    id: row.id,
    authUserId: row.auth_user_id ?? null,
    name: row.name ?? null,
    // P5: grade is a string. Coerce defensively — the column is TEXT, but a
    // stale generated type or a JSON-numeric round-trip must not leak a number.
    grade: row.grade == null ? null : String(row.grade),
    board: row.board ?? null,
    stream: row.stream ?? null,
    plan: row.subscription_plan ?? null,
    language: row.preferred_language ?? null,
    schoolId: row.school_id ?? null,
  };
}
