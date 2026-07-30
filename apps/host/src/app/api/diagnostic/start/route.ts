/**
 * POST /api/diagnostic/start
 *
 * Builds a 15-item stratified cold-start placement form and creates the
 * `diagnostic_assessments` row. Questions are returned inline to avoid a second
 * round-trip (P10).
 *
 * Implements `docs/superpowers/specs/2026-07-29-diagnostic-cold-start-correctness.md`:
 *  - §1  5 easy / 6 medium / 4 hard blueprint on the fixed positional template
 *  - §2  Tier-0 verification gate V1-V18 + the real `validateQuestion()` screen
 *  - §3  whole-subject scope restricted to in-scope `cbse_syllabus` chapters
 *  - §4  grades "6".."12" (P5 — strings), stream handled by `get_available_subjects`
 *  - §5  Rung 0 -> 4 insufficient-pool ladder, with an honest HTTP 200 stop
 *  - §6  Bloom's spread
 *  - §7  bilingual student-facing copy (P7)
 *
 * The response field is named `session_id` for backward compatibility with the
 * /diagnostic page contract — it is the `diagnostic_assessments.id` UUID.
 *
 * Request body: { grade: string, subject: string }
 *
 * Responses (all HTTP 200 unless noted):
 *  - Rung 0-3: { success: true, ok: true, rung, blueprint, data: { session_id, questions, ... } }
 *  - Rung 4:   { ok: true, diagnostic: null, insufficientContent: true,
 *                reason: 'INSUFFICIENT_POOL', message: { en, hi }, alternatives: [...] }
 *              — and NO `diagnostic_assessments` row is inserted (§5.3 F2).
 *  - Stream:   { ok: true, diagnostic: null, streamRequired: true, message: { en, hi } }
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { validateSubjectWrite, getAllowedSubjectsForStudent } from '@alfanumrik/lib/subjects';
import type { Subject } from '@alfanumrik/lib/subjects.types';
import {
  DIAGNOSTIC_BLOOM_LEVELS,
  DIAGNOSTIC_SOURCE_TYPES,
  DIAGNOSTIC_FAILED_VERIFICATION_STATES,
  VALID_DIAGNOSTIC_GRADES,
  DIAGNOSTIC_SHORT_FORM_FLOOR,
  selectDiagnosticForm,
  type DiagnosticCandidate,
} from '@alfanumrik/lib/diagnostic/blueprint';
import {
  DIAGNOSTIC_CTA_FOXY,
  DIAGNOSTIC_CTA_GUIDED_LESSON,
  DIAGNOSTIC_CTA_OTHER_SUBJECT,
  DIAGNOSTIC_INSUFFICIENT_BODY,
  DIAGNOSTIC_INSUFFICIENT_HEADLINE,
  DIAGNOSTIC_SETUP_REASSURANCE,
  DIAGNOSTIC_SHORT_FORM_BANNER,
  DIAGNOSTIC_STREAM_BODY,
  DIAGNOSTIC_STREAM_CTA,
  DIAGNOSTIC_STREAM_HEADLINE,
  fillCopy,
  type BilingualString,
} from '@alfanumrik/lib/diagnostic/copy';

/** Grades that require a stream before `get_available_subjects` can resolve (§4 G4). */
const SENIOR_GRADES = new Set(['11', '12']);

/** Per-band fetch ceiling. Three queries keep the hard band from being crowded out. */
const POOL_FETCH_LIMIT_PER_BAND = 250;

/** Only the columns the client is allowed to see. Verification/IRT metadata stays server-side. */
const CLIENT_QUESTION_FIELDS = [
  'id',
  'question_text',
  'question_hi',
  'question_type',
  'options',
  'correct_answer_index',
  'explanation',
  'explanation_hi',
  'difficulty',
  'bloom_level',
  'chapter_number',
  'topic_id',
] as const;

/** Columns the selector needs. Superset of what is returned to the client. */
const POOL_SELECT = [
  ...CLIENT_QUESTION_FIELDS,
  'question_type_v2',
  'source_type',
  'content_status',
  'verification_state',
  'is_verified',
  'is_active',
  'deleted_at',
  'grade',
  'subject',
  'irt_a',
  'irt_b',
  'irt_calibration_n',
].join(', ');

const FAILED_STATES_SQL = `(${DIAGNOSTIC_FAILED_VERIFICATION_STATES.join(',')})`;

function toClientQuestion(q: DiagnosticCandidate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of CLIENT_QUESTION_FIELDS) out[field] = q[field] ?? null;
  return out;
}

/** Bilingual label where the substituted value itself differs per language. */
function bilingualFill(
  copy: BilingualString,
  key: string,
  en: string,
  hi: string,
): BilingualString {
  return {
    en: fillCopy(copy, { [key]: en }).en,
    hi: fillCopy(copy, { [key]: hi }).hi,
  };
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authorize — requires 'diagnostic.attempt' permission (P9: RBAC enforcement)
    const auth = await authorizeRequest(request, 'diagnostic.attempt');
    if (!auth.authorized) return auth.errorResponse!;
    const userId = auth.userId!;

    // 2. Parse body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', code: 'INVALID_BODY' },
        { status: 400 }
      );
    }

    const { grade, subject } = body as { grade?: unknown; subject?: unknown };

    // 2b. §3 S3 — a chapter-scoped assessment is a quiz, not a diagnostic.
    if (body.chapter != null) {
      return NextResponse.json(
        {
          success: false,
          error: 'The diagnostic covers the whole subject; it cannot be scoped to a chapter.',
          code: 'CHAPTER_NOT_SUPPORTED',
        },
        { status: 400 }
      );
    }

    // 3. Validate grade — P5: MUST be a string "6".."12". Integer 11 is rejected.
    if (typeof grade !== 'string' || !(VALID_DIAGNOSTIC_GRADES as readonly string[]).includes(grade)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Grade must be a string between "6" and "12" for diagnostic assessment.',
          code: 'INVALID_GRADE',
        },
        { status: 400 }
      );
    }

    // 4. Validate subject shape (content governance happens post-student-resolve)
    if (typeof subject !== 'string' || !subject.trim()) {
      return NextResponse.json(
        { success: false, error: 'subject is required', code: 'INVALID_SUBJECT' },
        { status: 400 }
      );
    }
    const subjectCode = subject.trim().toLowerCase();

    // 5. Resolve student_id via admin client
    const admin = getSupabaseAdmin();
    const { data: student, error: studentError } = await admin
      .from('students')
      .select('id, grade, stream')
      .eq('auth_user_id', userId)
      .single();

    if (studentError || !student) {
      return NextResponse.json(
        { success: false, error: 'Student profile not found.', code: 'NO_STUDENT' },
        { status: 404 }
      );
    }

    // 5a. §4 G3 — the profile grade is authoritative. A client-picked grade must
    //     never produce an off-syllabus diagnostic for a student whose profile
    //     already carries a grade.
    const profileGrade =
      typeof student.grade === 'string' &&
      (VALID_DIAGNOSTIC_GRADES as readonly string[]).includes(student.grade)
        ? student.grade
        : null;
    const effectiveGrade = profileGrade ?? grade;
    if (profileGrade && profileGrade !== grade) {
      logger.warn('diagnostic_grade_overridden_by_profile', {
        route: '/api/diagnostic/start',
        studentId: student.id,
        requestedGrade: grade,
        effectiveGrade,
      });
    }

    // 5b. §4 G4 — grades 11-12 with no stream: do NOT 400. Ask for the stream
    //     only when governance genuinely cannot unlock a single subject.
    if (SENIOR_GRADES.has(effectiveGrade) && !student.stream) {
      let unlocked: Subject[] = [];
      try {
        const allowed = await getAllowedSubjectsForStudent(student.id, { supabase: admin });
        unlocked = allowed.filter((s) => !s.isLocked);
      } catch (e) {
        logger.warn('diagnostic_allowed_subjects_failed', {
          route: '/api/diagnostic/start',
          studentId: student.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      if (unlocked.length === 0) {
        return NextResponse.json({
          ok: true,
          success: true,
          diagnostic: null,
          streamRequired: true,
          message: fillCopy(DIAGNOSTIC_STREAM_BODY, { grade: effectiveGrade }),
          headline: DIAGNOSTIC_STREAM_HEADLINE,
          cta: DIAGNOSTIC_STREAM_CTA,
          // The stream-selection surface is frontend-owned; the API deliberately
          // does not invent an href (spec §7.4 flag).
          streamOptions: ['science', 'commerce', 'humanities'],
        });
      }
    }

    // 5c. Subject governance (grade × stream × plan) — §4 G5, unchanged 422.
    const subjectValidation = await validateSubjectWrite(student.id, subjectCode, {
      supabase: admin,
    });
    if (!subjectValidation.ok) {
      return NextResponse.json(
        {
          error: subjectValidation.error.code,
          subject: subjectValidation.error.subject,
          reason: subjectValidation.error.reason,
          allowed: subjectValidation.error.allowed,
        },
        { status: 422 },
      );
    }

    // 6. §3 S1 — the in-scope syllabus for this board+grade+subject. A chapter
    //    outside it can never be served.
    const { data: syllabusRows, error: syllabusError } = await admin
      .from('cbse_syllabus')
      .select('chapter_number')
      .eq('board', 'CBSE')
      .eq('grade', effectiveGrade)
      .eq('subject_code', subjectCode)
      .eq('is_in_scope', true);

    if (syllabusError) {
      logger.error('diagnostic_syllabus_fetch_failed', {
        error: new Error(syllabusError.message),
        route: '/api/diagnostic/start',
        studentId: student.id,
        grade: effectiveGrade,
        subject: subjectCode,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load syllabus. Please try again.', code: 'SYLLABUS_ERROR' },
        { status: 500 }
      );
    }

    const inScopeChapters = Array.from(
      new Set(
        (syllabusRows ?? [])
          .map((r) => r.chapter_number as number)
          .filter((n): n is number => typeof n === 'number')
      )
    ).sort((a, b) => a - b);

    // 7. Fetch the candidate pool, one query per difficulty band so a huge easy
    //    band cannot crowd the hard band out of the LIMIT. Every Tier-0
    //    predicate that is SQL-expressible is applied here (§2.1); the selector
    //    re-applies all of them in process as defence in depth.
    const candidates: DiagnosticCandidate[] = [];
    if (inScopeChapters.length > 0) {
      const bandQueries = [1, 2, 3].map((band) =>
        admin
          .from('question_bank')
          .select(POOL_SELECT)
          .eq('grade', effectiveGrade) // V4 — P5: string comparison
          .eq('subject', subjectCode) // V5
          .eq('is_active', true) // V1
          .is('deleted_at', null) // V2
          .eq('content_status', 'published') // V3
          .eq('question_type_v2', 'mcq') // V6
          .eq('difficulty', band) // V13
          .in('bloom_level', DIAGNOSTIC_BLOOM_LEVELS as unknown as string[]) // V14
          .not('verification_state', 'in', FAILED_STATES_SQL) // V15
          .in('source_type', DIAGNOSTIC_SOURCE_TYPES as unknown as string[]) // V16
          .in('chapter_number', inScopeChapters) // V17 / S1
          .order('verification_state', { ascending: false }) // verified > pending > legacy
          .order('id', { ascending: true }) // deterministic page
          .limit(POOL_FETCH_LIMIT_PER_BAND)
      );

      const bandResults = await Promise.all(bandQueries);
      for (const result of bandResults) {
        if (result.error) {
          logger.error('diagnostic_fetch_questions_failed', {
            error: new Error(result.error.message),
            route: '/api/diagnostic/start',
            studentId: student.id,
            grade: effectiveGrade,
            subject: subjectCode,
          });
          return NextResponse.json(
            { success: false, error: 'Failed to load questions. Please try again.', code: 'QUESTIONS_ERROR' },
            { status: 500 }
          );
        }
        candidates.push(...((result.data ?? []) as unknown as DiagnosticCandidate[]));
      }
    }

    // 8. Run the ladder (Rung 0 -> 4). Pure, DB-free, fully testable.
    const seed = randomUUID();
    const form = selectDiagnosticForm({
      candidates,
      inScopeChapters,
      grade: effectiveGrade,
      subject: subjectCode,
      seed,
    });

    // 9. §5.3 — Rung 4 honest stop. HTTP 200, no half-started session.
    if (form.rung === 4) {
      const alternatives = await buildAlternatives({
        admin,
        studentId: student.id,
        grade: effectiveGrade,
        subjectCode,
        inScopeChapters,
      });

      // F5 — content-gap telemetry. P13: grade + subject + counts only, and no
      // student identifier of any kind.
      await logOpsEvent({
        category: 'content',
        source: 'api/diagnostic/start',
        severity: 'warning',
        message: 'diagnostic_content_gap',
        context: {
          grade: effectiveGrade,
          subject: subjectCode,
          reason: form.reason ?? 'too_few_items',
          available_count: form.eligibleCount,
          band_counts: form.eligibleBandCounts,
          chapter_count: form.eligibleChapterCount,
          syllabus_chapter_count: inScopeChapters.length,
        },
      });

      return NextResponse.json({
        ok: true,
        success: true,
        diagnostic: null,
        insufficientContent: true,
        reason: 'INSUFFICIENT_POOL',
        message: fillCopy(DIAGNOSTIC_INSUFFICIENT_BODY, {
          grade: effectiveGrade,
          subject: subjectCode,
        }),
        headline: DIAGNOSTIC_INSUFFICIENT_HEADLINE,
        alternatives,
        // Spec §5.3 F3 shape, carried alongside the frozen top-level contract.
        data: {
          content_insufficient: true,
          quality_tier: 'insufficient',
          reason: form.reason ?? 'too_few_items',
          available_count: form.eligibleCount,
          alternatives,
        },
      });
    }

    // 10. Create the diagnostic_assessments row (is_completed defaults to false,
    //     started_at defaults to now()).
    const { data: session, error: sessionError } = await admin
      .from('diagnostic_assessments')
      .insert({
        student_id: student.id,
        assessment_type: 'subject_diagnostic',
        grade: effectiveGrade, // P5: string "6"-"12"
        subject: subjectCode,
        total_questions: form.questions.length,
        layer_tested: 1,
      })
      .select('id')
      .single();

    if (sessionError || !session) {
      logger.error('diagnostic_create_session_failed', {
        error: new Error(sessionError?.message ?? 'No session returned'),
        route: '/api/diagnostic/start',
        studentId: student.id,
        grade: effectiveGrade,
        subject: subjectCode,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to start diagnostic session.', code: 'SESSION_CREATE_ERROR' },
        { status: 500 }
      );
    }

    logger.info('diagnostic_form_assembled', {
      route: '/api/diagnostic/start',
      studentId: student.id,
      grade: effectiveGrade,
      subject: subjectCode,
      rung: form.rung,
      qualityTier: form.qualityTier,
      served: form.questions.length,
      blueprint: form.blueprint,
      chapterCount: form.chapterCount,
      eligibleCount: form.eligibleCount,
    });

    const shortForm = form.qualityTier === 'short_form';

    return NextResponse.json({
      success: true,
      ok: true,
      // Frozen contract: `rung` and `blueprint` at the top level …
      rung: form.rung,
      blueprint: form.blueprint,
      data: {
        session_id: session.id,
        questions: form.questions.map(toClientQuestion),
        // … and mirrored inside `data` next to the fields the page already reads.
        rung: form.rung,
        blueprint: form.blueprint,
        quality_tier: form.qualityTier,
        grade: effectiveGrade, // P5: string
        subject: subjectCode,
        total_questions: form.questions.length,
        chapter_count: form.chapterCount,
        bloom_counts: form.bloomCounts,
        setup_reassurance: DIAGNOSTIC_SETUP_REASSURANCE,
        short_form: shortForm,
        short_form_message: shortForm
          ? fillCopy(DIAGNOSTIC_SHORT_FORM_BANNER, { count: form.questions.length })
          : null,
      },
    });
  } catch (err) {
    logger.error('diagnostic_start_unexpected', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/diagnostic/start',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// ── §5.4 fallback CTAs ─────────────────────────────────────────

interface AlternativeCta {
  kind: 'other_subject' | 'guided_lesson' | 'foxy';
  label: BilingualString;
  href: string;
}

/**
 * §5.4 — ordered fallbacks. The Foxy entry is unconditional, so the returned
 * array is provably non-empty (F4) and a student is never handed a dead end.
 */
async function buildAlternatives(args: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  studentId: string;
  grade: string;
  subjectCode: string;
  inScopeChapters: number[];
}): Promise<AlternativeCta[]> {
  const { admin, studentId, grade, subjectCode, inScopeChapters } = args;
  const alternatives: AlternativeCta[] = [];

  // 1. Another unlocked subject that comfortably clears the Rung 3 floor.
  try {
    const allowed = await getAllowedSubjectsForStudent(studentId, { supabase: admin });
    const others = allowed.filter((s) => !s.isLocked && s.code !== subjectCode);

    if (others.length > 0) {
      const { data: rows, error } = await admin
        .from('question_bank')
        .select('subject, difficulty, chapter_number')
        .eq('grade', grade)
        .in('subject', others.map((s) => s.code))
        .eq('is_active', true)
        .is('deleted_at', null)
        .eq('content_status', 'published')
        .eq('question_type_v2', 'mcq')
        .in('difficulty', [1, 2, 3])
        .in('bloom_level', DIAGNOSTIC_BLOOM_LEVELS as unknown as string[])
        .not('verification_state', 'in', FAILED_STATES_SQL)
        .in('source_type', DIAGNOSTIC_SOURCE_TYPES as unknown as string[])
        .not('chapter_number', 'is', null)
        .limit(1500);

      if (error) {
        logger.warn('diagnostic_alternatives_precheck_failed', {
          route: '/api/diagnostic/start',
          error: error.message,
        });
      } else {
        const stats = new Map<string, { total: number; hard: number; chapters: Set<number> }>();
        for (const row of rows ?? []) {
          const code = String((row as { subject: unknown }).subject);
          const entry = stats.get(code) ?? { total: 0, hard: 0, chapters: new Set<number>() };
          entry.total++;
          if ((row as { difficulty: unknown }).difficulty === 3) entry.hard++;
          const ch = (row as { chapter_number: unknown }).chapter_number;
          if (typeof ch === 'number') entry.chapters.add(ch);
          stats.set(code, entry);
        }

        // This is a heuristic pre-check: it applies the SQL-expressible Tier-0
        // predicates but not `validateQuestion()` or the syllabus join, so the
        // floor is deliberately set above Rung 3's to avoid recommending a
        // subject that would itself hit Rung 4.
        for (const s of others) {
          const entry = stats.get(s.code);
          if (!entry) continue;
          if (
            entry.total >= DIAGNOSTIC_SHORT_FORM_FLOOR + 5 &&
            entry.hard >= 3 &&
            entry.chapters.size >= 3
          ) {
            alternatives.push({
              kind: 'other_subject',
              label: bilingualFill(DIAGNOSTIC_CTA_OTHER_SUBJECT, 'subject', s.name, s.nameHi),
              href: `/diagnostic?subject=${encodeURIComponent(s.code)}`,
            });
          }
          if (alternatives.length >= 2) break;
        }
      }
    }
  } catch (e) {
    logger.warn('diagnostic_alternatives_subjects_failed', {
      route: '/api/diagnostic/start',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 2. Guided lesson on the lowest in-scope chapter.
  if (inScopeChapters.length > 0) {
    alternatives.push({
      kind: 'guided_lesson',
      label: DIAGNOSTIC_CTA_GUIDED_LESSON,
      href: `/learn/${encodeURIComponent(subjectCode)}/${inScopeChapters[0]}?mode=read&from=diagnostic_unavailable`,
    });
  }

  // 3. Foxy — unconditional. F4 holds by construction.
  alternatives.push({
    kind: 'foxy',
    label: DIAGNOSTIC_CTA_FOXY,
    href: `/foxy?subject=${encodeURIComponent(subjectCode)}&from=diagnostic_unavailable`,
  });

  return alternatives;
}
