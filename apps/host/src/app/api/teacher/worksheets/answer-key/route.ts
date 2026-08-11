/**
 * GET /api/teacher/worksheets/answer-key
 *
 * Server-side answer key for the teacher worksheet generator
 * (`/teacher/worksheets`).
 *
 * WHY THIS ROUTE EXISTS
 * =====================
 * The worksheet page used to read `question_bank.correct_answer_index`
 * DIRECTLY FROM THE BROWSER, under the caller's own role:
 *
 *     supabase.from('question_bank')
 *       .select('question_text, options, correct_answer_index, …')
 *
 * Printing an answer key is a LEGITIMATE teacher need — the problem was never
 * the feature, it was the layer. Postgres cannot express "teachers may read
 * this column, students may not": students, parents and teachers all
 * authenticate as the SAME `authenticated` Postgres role, so neither RLS nor a
 * column ACL can separate them. That single call site was therefore the last
 * blocker on the `question_bank` answer-key column ACL, which closes the
 * widest answer-key exposure in the product (`correct_answer_index` readable
 * for every question by any signed-in user, students included).
 *
 * This route moves the read to the one layer that CAN express the rule — an
 * RBAC-gated server handler (P9) — so the ACL migration can revoke
 * `SELECT (correct_answer_index)` from `authenticated` without breaking the
 * teacher. It mirrors the precedent already set for the same column family on
 * `quiz_session_shuffles` by migration
 * `20260814000020_quiz_session_shuffles_answer_key_column_acl.sql`.
 *
 * AUTH (P9)
 * =========
 * `authorizeRequest(request, 'worksheet.create')` — an EXISTING permission
 * code (declared `PERMISSIONS.WORKSHEET_CREATE` in `packages/lib/src/rbac.ts`
 * and granted to the `teacher` role by
 * `20260612123200_rbac_matrix_conformance.sql`). No new permission code and no
 * RBAC migration is introduced by this change. It is the narrowest already-
 * granted code that names this exact capability; the broader `class.manage`
 * used by `/api/teacher/subjects` would also have worked but grants more.
 *
 * TENANCY (content-side analogue of `canAccessStudent`)
 * ====================================================
 * `worksheet.create` says "this role may build worksheets"; it does not say
 * WHICH content. The second gate is `resolveTeacherContentScope` in
 * `./_lib/worksheet-scope` — the caller may only receive keys for a
 * (subject, grade) pair they actually teach, derived from
 * `teachers.subjects_taught`/`grades_taught` UNION their active class
 * assignments (resolved through the canonical `resolveTeacherRosterScope`).
 * Out of scope → 403 with NO key in the body.
 *
 * SERVICE ROLE
 * ============
 * Ledgered in `scripts/admin-client-allowlist.json`. Service-role is REQUIRED,
 * not convenient: the pending ACL revokes the very column this route exists to
 * read from `authenticated`, so an RLS-scoped client would be denied the
 * column by construction. See the ledger entry for the bounded surface and the
 * ratchet-down path.
 *
 * P5: `grade` is a STRING ("6".."12") end to end.
 * P13: logs carry subject/grade/counts only — never teacher or student
 *      identity, and never question or option text.
 *
 * Response:
 *   200 { success: true, data: { questions: WorksheetQuestion[] } }
 *   400 { success: false, error, code: 'invalid_request' }
 *   401 authorizeRequest errorResponse
 *   403 { success: false, error, code: 'teacher_profile_required' | 'out_of_scope' }
 *   500 { success: false, error: 'Internal server error' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { VALID_GRADES } from '@alfanumrik/lib/identity';
import { parseOptions } from '@alfanumrik/lib/quiz/options';
import { shuffle } from '@alfanumrik/lib/shuffle';
import { resolveTeacherContentScope, isInContentScope } from './_lib/worksheet-scope';

/** One printable worksheet row. Shape is byte-compatible with the page's
 *  pre-existing `GeneratedQuestion`, so the printed output is unchanged. */
export interface WorksheetQuestion {
  type: string;
  question: string;
  answer: string;
  explanation: string;
}

const MIN_COUNT = 1;
const MAX_COUNT = 30;

/** Difficulty label → the integer stored in `question_bank.difficulty`.
 *  Preserved verbatim from the client-side query this route replaces. */
const DIFFICULTY_TO_INT: Record<string, number> = { easy: 1, medium: 2, hard: 3 };

const SUBJECT_CODE_RE = /^[a-z0-9_-]{1,40}$/;

function bad(error: string) {
  return NextResponse.json({ success: false, error, code: 'invalid_request' }, { status: 400 });
}

export async function GET(request: NextRequest) {
  // ── 1. RBAC gate (P9) — FIRST, before any parsing or any DB access. ──
  const auth = await authorizeRequest(request, 'worksheet.create');
  if (!auth.authorized) {
    return auth.errorResponse as unknown as NextResponse;
  }

  const url = new URL(request.url);
  const subject = (url.searchParams.get('subject') ?? '').trim().toLowerCase();
  const grade = (url.searchParams.get('grade') ?? '').trim();
  const countRaw = url.searchParams.get('count') ?? '';
  const difficultyRaw = (url.searchParams.get('difficulty') ?? '').trim().toLowerCase();

  // ── 2. Input validation, before any business logic. ──
  if (!SUBJECT_CODE_RE.test(subject)) return bad('subject is required');
  // P5 — grades are strings "6".."12"; an integer-shaped value that is not in
  // the canonical list is rejected rather than coerced.
  if (!(VALID_GRADES as readonly string[]).includes(grade)) return bad('grade must be one of "6"-"12"');

  const count = Number.parseInt(countRaw, 10);
  if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    return bad(`count must be an integer between ${MIN_COUNT} and ${MAX_COUNT}`);
  }

  let difficultyInt: number | null = null;
  if (difficultyRaw.length > 0) {
    if (!(difficultyRaw in DIFFICULTY_TO_INT)) return bad('difficulty must be easy, medium or hard');
    difficultyInt = DIFFICULTY_TO_INT[difficultyRaw];
  }

  try {
    // ── 3. Tenancy gate — the content-side analogue of canAccessStudent. ──
    const scope = await resolveTeacherContentScope(auth.userId!);
    if (!scope) {
      // No ACTIVE teachers row. Fail closed; no key in the body.
      return NextResponse.json(
        { success: false, error: 'Teacher account required', code: 'teacher_profile_required' },
        { status: 403 },
      );
    }

    if (!isInContentScope(scope, subject, grade)) {
      logger.warn('teacher_worksheet_answer_key_out_of_scope', {
        route: 'teacher/worksheets/answer-key',
        subject,
        grade,
        scoped_subject_count: scope.subjects.size,
        scoped_grade_count: scope.grades.size,
      });
      return NextResponse.json(
        {
          success: false,
          error: 'This subject and grade are outside the classes you teach',
          code: 'out_of_scope',
        },
        { status: 403 },
      );
    }

    // ── 4. The privileged read. Same filters, same limit multiplier and same
    // shuffle-then-slice as the client query this replaces, so which questions
    // land on the sheet is unchanged in distribution. ──
    let query = supabaseAdmin
      .from('question_bank')
      .select('question_text, options, correct_answer_index, explanation, difficulty, bloom_level')
      .eq('subject', subject)
      .eq('grade', grade)
      .eq('is_active', true)
      .limit(count * 3);

    if (difficultyInt !== null) query = query.eq('difficulty', difficultyInt);

    const { data, error } = await query;
    if (error) {
      logger.error('teacher_worksheet_answer_key_read_failed', {
        error: new Error(error.message),
        route: 'teacher/worksheets/answer-key',
        subject,
        grade,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to read the question bank' },
        { status: 500 },
      );
    }

    // Genuine-empty is a 200 with zero questions — NOT an error. The page
    // distinguishes the two and only falls back to sample questions on a
    // genuine empty; conflating them is the exact defect the page's own
    // `QuestionBankRead` union was introduced to prevent.
    const rows = (data ?? []) as Array<{
      question_text: string;
      options: unknown;
      correct_answer_index: number | null;
      explanation: string | null;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ success: true, data: { questions: [] } });
    }

    const questions: WorksheetQuestion[] = shuffle(rows)
      .slice(0, count)
      .map((q) => {
        const opts = parseOptions(q.options);
        // `parseOptions` returns [] for a malformed JSON string, where the
        // inline copy this replaces THREW and surfaced the page's error
        // banner. Keep the failure LOUD: corrupt option data must not print as
        // a question with no options.
        if (!Array.isArray(opts)) throw new Error('question_bank_options_malformed');
        if (typeof q.options === 'string' && q.options.trim().length > 0 && opts.length === 0) {
          throw new Error('question_bank_options_malformed');
        }

        const idx = q.correct_answer_index;
        const answer =
          typeof idx === 'number' && idx >= 0 && idx < opts.length
            ? opts[idx]
            : 'See explanation';

        return {
          type: 'MCQ',
          question:
            q.question_text +
            '\n' +
            opts.map((o, i) => `(${String.fromCharCode(97 + i)}) ${o}`).join('  '),
          answer: answer || 'See explanation',
          explanation: q.explanation || '',
        };
      });

    return NextResponse.json({ success: true, data: { questions } });
  } catch (e) {
    logger.error('teacher_worksheet_answer_key_unexpected_error', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'teacher/worksheets/answer-key',
      subject,
      grade,
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
