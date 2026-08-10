/**
 * src/lib/state/student-state-builder.ts — the DB → StudentState projector.
 *
 * Phase 2 of the unified state architecture. THE single read path that
 * turns the raw Supabase row state into the canonical StudentState the
 * Orchestrator hands to every service.
 *
 * Read strategy (one round-trip per concern, parallelised):
 *
 *   - students row (identity, grade, board, language, school_id, plan)
 *   - learner_mastery rows (subject + chapter rollup)
 *   - guardian_student_links (verified parents)
 *   - quiz_sessions latest open (live state if mid-quiz)
 *   - foxy_sessions latest active (live state if mid-foxy)
 *   - tenant_modules (enabledModules) for school tenants
 *   - feature_flags (consent / minor toggles — best-effort)
 *
 * Falls back to safe defaults when:
 *   - learner_mastery is empty (new learner — mastery: [])
 *   - student row missing tenant (B2C path)
 *
 * What this builder does NOT do:
 *
 *   - Mutate any state. Reads only.
 *   - Cache results. The Orchestrator owns the cache.
 *   - Validate the SHAPE returned by Supabase. The StudentStateSchema in
 *     student-state.ts is the runtime guard; the builder constructs a
 *     plain object and the Orchestrator (or tests) Zod-parses it.
 *
 * Failure model:
 *   - Identity miss (no students row for auth_user_id) → throws.
 *     A caller without a student profile should never reach the
 *     orchestrator.
 *   - Per-concern read failure (e.g. tenant_modules table unreachable) →
 *     logs and falls back to the registry default. The builder is
 *     defensive at the projection boundary because the orchestrator is
 *     a hot path. We do not let a flaky read of a peripheral table
 *     crash the whole orchestrator dispatch.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { RESUME_MAX_AGE_MS } from '../quiz/resume';
import type {
  StudentState,
  StudentStateBuilder,
  SubjectMastery,
  LiveSessionState,
} from './student-state';

interface StudentRow {
  id: string;
  auth_user_id: string | null;
  name: string;
  grade: string;
  board: string | null;
  preferred_language: string | null;
  school_id: string | null;
  subscription_plan: string | null;
  xp_total: number | null;
  streak_days: number | null;
  last_active: string | null;
  date_of_birth: string | null;
  created_at: string | null;
}

interface MasteryRow {
  subject_code: string;
  chapter_number: number;
  mastery: number;
  attempts: number;
  last_updated_at: string;
}

interface QuizSessionRow {
  id: string;
  subject: string;
  chapter_number: number | null;
  total_questions: number | null;
  total_answered: number | null;
  started_at: string | null;
  is_completed: boolean | null;
}

/**
 * One in-flight quiz, derived from the server-owned per-question snapshot
 * (`quiz_session_shuffles`) rather than from `quiz_sessions`.
 *
 * PHASE 4 FIX — `quiz_sessions` cannot express "mid-quiz". `start_quiz_session`
 * writes NO `quiz_sessions` row (verified in the RPC body, latest definition
 * 20260801100900); the row is INSERTed for the first time by
 * `submit_quiz_results_v2`, already `is_completed = true`. So the
 * `is_completed = false` probe below could only ever match legacy/foreign rows,
 * and `live.kind === 'in_quiz'` — the thing the whole `resume_in_progress`
 * branch keys off — was effectively unreachable for a real in-flight quiz.
 * The snapshot table IS written at session start and carries a durable
 * per-question answer record, so it is the honest source for "there is a quiz
 * in progress".
 */
interface OpenQuizSnapshotRow {
  session_id: string;
  question_id: string;
  student_answered_at: string | null;
  created_at: string | null;
}

interface FoxySessionRow {
  id: string;
  subject: string | null;
  created_at: string;
  last_active_at: string;
}

interface GuardianRow {
  parent_auth_user_id: string | null;
  verified_at: string | null;
}

interface TenantModuleRow {
  module_key: string;
  is_enabled: boolean;
}

const PLAN_NORMALIZE: Record<string, StudentState['access']['planSlug']> = {
  free: 'free',
  starter: 'starter',
  starter_monthly: 'starter',
  starter_yearly: 'starter',
  pro: 'family',
  pro_monthly: 'family',
  pro_yearly: 'family',
  ultimate_monthly: 'family',
  ultimate_yearly: 'family',
  unlimited: 'family',
  unlimited_monthly: 'family',
  unlimited_yearly: 'family',
  basic: 'starter',
  premium: 'family',
};

const BOARD_NORMALIZE: Record<string, StudentState['board']> = {
  CBSE: 'CBSE',
  ICSE: 'ICSE',
  STATE: 'STATE',
  OTHER: 'OTHER',
  cbse: 'CBSE',
  icse: 'ICSE',
  state: 'STATE',
};

const LANG_NORMALIZE: Record<string, StudentState['language']> = {
  en: 'en',
  hi: 'hi',
  english: 'en',
  hindi: 'hi',
};

/** Default modules surfaced for B2C learners (no school tenant). */
const B2C_DEFAULT_MODULES = [
  'foxy_tutor',
  'quiz_engine',
  'concept_engine',
  'lab_notebook',
];

/** Modules every school tenant gets unless they've toggled it off. */
const SCHOOL_DEFAULT_MODULES = [
  'foxy_tutor',
  'quiz_engine',
  'concept_engine',
  'lab_notebook',
  'assignments',
  'analytics',
];

const ISO_FALLBACK = '1970-01-01T00:00:00Z';

const SCHEMA_VERSION = 1 as const;

export interface BuilderOptions {
  sb: SupabaseClient;
  now?: () => Date;
  /**
   * When the consent block can't be derived from DB rows, fall back to
   * these. Default: assume adult, parent-link not required, analytics
   * consent assumed (we'll wire the real cookie banner check in a later
   * phase). Pure projection — does not write to DB.
   */
  consentDefaults?: StudentState['consent'];
}

export function createStudentStateBuilder(
  opts: BuilderOptions,
): StudentStateBuilder {
  const now = opts.now ?? (() => new Date());
  const consentDefaults: StudentState['consent'] = opts.consentDefaults ?? {
    isMinor: false,
    parentLinkVerified: false,
    analyticsConsent: true,
  };

  return async function buildStudentState(
    authUserId: string,
  ): Promise<StudentState> {
    const sb = opts.sb;

    const studentRes = await sb
      .from('students')
      .select(
        'id, auth_user_id, name, grade, board, preferred_language, school_id, subscription_plan, xp_total, streak_days, last_active, date_of_birth, created_at',
      )
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (studentRes.error) {
      throw new Error(
        `student-state-builder: students lookup failed: ${studentRes.error.message}`,
      );
    }
    const student = studentRes.data as StudentRow | null;
    if (!student) {
      throw new Error(
        `student-state-builder: no students row for auth_user_id=${authUserId}`,
      );
    }

    // Parallelise the rest — each read is independent and safe to defer.
    const [
      masteryRes,
      openQuizRes,
      activeFoxyRes,
      latestSnapshotRes,
      guardiansRes,
      tenantModulesRes,
    ] = await Promise.all([
      sb
        .from('learner_mastery')
        .select('subject_code, chapter_number, mastery, attempts, last_updated_at')
        .eq('auth_user_id', authUserId)
        .order('subject_code', { ascending: true })
        .order('chapter_number', { ascending: true }),
      sb
        .from('quiz_sessions')
        .select(
          'id, subject, chapter_number, total_questions, total_answered, started_at, is_completed',
        )
        .eq('student_id', student.id)
        .eq('is_completed', false)
        .order('started_at', { ascending: false })
        .limit(1),
      sb
        .from('foxy_sessions')
        .select('id, subject, created_at, last_active_at')
        .eq('student_id', student.id)
        .order('last_active_at', { ascending: false })
        .limit(1),
      // Newest quiz snapshot row → the candidate in-flight session id. One
      // indexed row (idx_quiz_session_shuffles_student is (student_id,
      // created_at DESC)); the follow-up reads below only run when this
      // candidate is fresh, so the idle case costs exactly one extra row.
      sb
        .from('quiz_session_shuffles')
        .select('session_id, question_id, student_answered_at, created_at')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false })
        .limit(1),
      sb
        .from('guardian_student_links')
        .select('parent_auth_user_id, verified_at')
        .eq('student_id', student.id),
      student.school_id
        ? sb
            .from('tenant_modules')
            .select('module_key, is_enabled')
            .eq('school_id', student.school_id)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const masteryRows = (masteryRes.data ?? []) as MasteryRow[];
    const legacyOpenQuiz = (openQuizRes.data?.[0] ?? null) as QuizSessionRow | null;
    const activeFoxy = (activeFoxyRes.data?.[0] ?? null) as FoxySessionRow | null;

    // Resumable in-flight quiz (see OpenQuizSnapshotRow). Best-effort: any
    // failure degrades to "no live quiz", never a thrown builder.
    let openQuiz = legacyOpenQuiz;
    try {
      const resumable = await resolveResumableQuiz(
        sb,
        student.id,
        (latestSnapshotRes.data?.[0] ?? null) as OpenQuizSnapshotRow | null,
        now(),
      );
      if (resumable) openQuiz = resumable;
    } catch {
      // Peripheral read — keep the legacy probe's answer.
    }
    const guardians = (guardiansRes.data ?? []) as GuardianRow[];
    const tenantModules = (tenantModulesRes.data ?? []) as TenantModuleRow[];

    return {
      schemaVersion: SCHEMA_VERSION,
      builtAt: now().toISOString(),

      authUserId,
      studentId: student.id,
      displayName: student.name || 'Learner',
      grade: student.grade || '0',
      board: BOARD_NORMALIZE[student.board ?? ''] ?? 'CBSE',
      language: LANG_NORMALIZE[student.preferred_language ?? 'en'] ?? 'en',

      tenant: buildTenant(student, tenantModules),
      access: buildAccess(student),
      consent: buildConsent(student, guardians, consentDefaults),

      mastery: rollupMastery(masteryRows),
      engagement: buildEngagement(student),

      live: deriveLiveState(openQuiz, activeFoxy),

      classroomId: null, // wired up in a later phase via class_students join
      parentIds: guardians
        .filter(g => g.parent_auth_user_id && g.verified_at)
        .map(g => g.parent_auth_user_id as string),
    };
  };
}

// ── Section builders ─────────────────────────────────────────────────

function buildTenant(
  student: StudentRow,
  tenantModules: TenantModuleRow[],
): StudentState['tenant'] {
  if (!student.school_id) {
    return {
      tenantId: null,
      tenantType: 'b2c',
      enabledModules: B2C_DEFAULT_MODULES,
      aiPersonality: null,
    };
  }
  const explicitDisabled = new Set(
    tenantModules.filter(m => !m.is_enabled).map(m => m.module_key),
  );
  const explicitEnabled = tenantModules
    .filter(m => m.is_enabled)
    .map(m => m.module_key);
  const enabled = Array.from(
    new Set([
      ...SCHOOL_DEFAULT_MODULES.filter(m => !explicitDisabled.has(m)),
      ...explicitEnabled,
    ]),
  );
  return {
    tenantId: student.school_id,
    tenantType: 'school',
    enabledModules: enabled,
    aiPersonality: null,
  };
}

function buildAccess(student: StudentRow): StudentState['access'] {
  const raw = student.subscription_plan ?? 'free';
  const plan = PLAN_NORMALIZE[raw] ?? 'free';
  return {
    planSlug: plan,
    isTrialing: false,
    trialEndsAt: null,
    usageThisMonth: { foxyMinutes: 0, quizSessions: 0 },
  };
}

function buildConsent(
  student: StudentRow,
  guardians: GuardianRow[],
  defaults: StudentState['consent'],
): StudentState['consent'] {
  const dob = student.date_of_birth ? new Date(student.date_of_birth) : null;
  const ageYears = dob
    ? (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000)
    : null;
  const isMinor = ageYears !== null ? ageYears < 18 : defaults.isMinor;
  const parentLinkVerified = guardians.some(
    g => g.parent_auth_user_id && g.verified_at,
  );
  return {
    isMinor,
    parentLinkVerified,
    analyticsConsent: defaults.analyticsConsent,
  };
}

function buildEngagement(student: StudentRow): StudentState['engagement'] {
  return {
    currentStreakDays: clampNonNegInt(student.streak_days),
    longestStreakDays: clampNonNegInt(student.streak_days),
    lastActiveAt: student.last_active ?? null,
    totalTimeOnTaskSec: 0, // wired up in a later phase
    xpBalance: clampNonNegInt(student.xp_total),
  };
}

function rollupMastery(rows: MasteryRow[]): SubjectMastery[] {
  const bySubject = new Map<string, MasteryRow[]>();
  for (const r of rows) {
    const code = r.subject_code.toLowerCase();
    if (!bySubject.has(code)) bySubject.set(code, []);
    bySubject.get(code)!.push(r);
  }
  const subjects: SubjectMastery[] = [];
  for (const [subjectCode, chapters] of bySubject) {
    const sorted = chapters
      .slice()
      .sort((a, b) => a.chapter_number - b.chapter_number);
    const meanMastery =
      sorted.length === 0
        ? null
        : sorted.reduce((acc, c) => acc + c.mastery, 0) / sorted.length;
    subjects.push({
      subjectCode,
      meanMastery,
      chapters: sorted.map(c => ({
        chapterNumber: c.chapter_number,
        mastery: c.mastery,
        lastUpdatedAt: c.last_updated_at ?? null,
        attempts: c.attempts,
      })),
    });
  }
  return subjects.sort((a, b) => a.subjectCode.localeCompare(b.subjectCode));
}

/**
 * Turn the newest quiz-snapshot row into a `QuizSessionRow`-shaped "there is
 * a quiz in progress" signal, or null when there is nothing to resume.
 *
 * Deliberately returns the SAME shape the legacy `quiz_sessions` probe returns
 * so `deriveLiveState` stays untouched — this adds a source, not a branch.
 *
 * A session counts as resumable only when ALL of:
 *   1. its snapshot is younger than RESUME_MAX_AGE_MS (a day-old "continue"
 *      card is worse than a fresh start),
 *   2. the student has confirmed at least one answer (otherwise there is
 *      literally no progress to preserve — start fresh),
 *   3. it has NOT already been graded. `submitQuizResults` passes the server
 *      session id as the submit RPC's idempotency key, so a `quiz_sessions`
 *      row carrying that key is the definitive "already submitted" marker.
 *      Without this check the Today CTA would keep offering to resume a quiz
 *      the student already finished, and tapping it would walk them into a
 *      session the submit RPC can only ever replay.
 *   4. the questions carry a positive chapter number — `LiveSessionState`'s
 *      `in_quiz` variant requires one, and the resume CTA copy is
 *      chapter-anchored.
 *
 * Read-only. No writes, no scoring, no XP.
 */
async function resolveResumableQuiz(
  sb: SupabaseClient,
  studentId: string,
  latest: OpenQuizSnapshotRow | null,
  now: Date,
): Promise<QuizSessionRow | null> {
  if (!latest?.session_id) return null;

  const startedAt = latest.created_at ?? null;
  if (startedAt) {
    const t = Date.parse(startedAt);
    if (Number.isFinite(t) && now.getTime() - t > RESUME_MAX_AGE_MS) return null;
  }

  const rowsRes = await sb
    .from('quiz_session_shuffles')
    .select('question_id, student_answered_at')
    .eq('session_id', latest.session_id)
    .eq('student_id', studentId);
  const rows = (rowsRes.data ?? []) as Array<{
    question_id: string;
    student_answered_at: string | null;
  }>;
  if (rows.length === 0) return null;

  const answered = rows.filter(r => r.student_answered_at !== null).length;
  if (answered === 0) return null;

  const gradedRes = await sb
    .from('quiz_sessions')
    .select('id')
    .eq('student_id', studentId)
    .eq('idempotency_key', latest.session_id)
    .limit(1);
  if ((gradedRes.data ?? []).length > 0) return null;

  const metaRes = await sb
    .from('question_bank')
    .select('subject, chapter_number')
    .eq('id', rows[0].question_id)
    .maybeSingle();
  const meta = (metaRes.data ?? null) as {
    subject: string | null;
    chapter_number: number | null;
  } | null;
  if (!meta?.subject || !meta.chapter_number || meta.chapter_number <= 0) return null;

  return {
    id: latest.session_id,
    subject: meta.subject,
    chapter_number: meta.chapter_number,
    total_questions: rows.length,
    total_answered: answered,
    started_at: startedAt,
    is_completed: false,
  };
}

function deriveLiveState(
  openQuiz: QuizSessionRow | null,
  activeFoxy: FoxySessionRow | null,
): LiveSessionState {
  // Foxy is "active" if there's been activity in the last 30 minutes.
  const FOXY_IDLE_THRESHOLD_MS = 30 * 60 * 1000;
  const foxyActive =
    activeFoxy &&
    Date.now() - Date.parse(activeFoxy.last_active_at) < FOXY_IDLE_THRESHOLD_MS;

  // Prefer the more specific signal: if mid-quiz, that wins over foxy.
  if (openQuiz && openQuiz.chapter_number && !openQuiz.is_completed) {
    return {
      kind: 'in_quiz',
      quizSessionId: openQuiz.id,
      subjectCode: openQuiz.subject.toLowerCase(),
      chapterNumber: openQuiz.chapter_number,
      startedAt: openQuiz.started_at ?? ISO_FALLBACK,
      questionCount: openQuiz.total_questions ?? 0,
      questionsAnswered: openQuiz.total_answered ?? 0,
    };
  }
  if (foxyActive && activeFoxy) {
    return {
      kind: 'in_foxy',
      foxySessionId: activeFoxy.id,
      subjectCode: activeFoxy.subject?.toLowerCase() ?? null,
      startedAt: activeFoxy.created_at,
      turnCount: 0, // counted off chat messages in a later phase
    };
  }
  return { kind: 'idle' };
}

function clampNonNegInt(v: number | null | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  return Math.floor(v);
}
