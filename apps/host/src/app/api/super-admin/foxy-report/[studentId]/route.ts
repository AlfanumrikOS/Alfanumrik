import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import {
  composeFoxyLearningReport,
  type FoxyReportSessionRow,
  type FoxyReportServedItemRow,
  type FoxyReportAttemptRow,
  type FoxyReportMasteryRow,
  type FoxyReportConceptMeta,
  type FoxyReportStudentMisconceptionRow,
  type FoxyReportMisconceptionLabelRow,
  type FoxyReportLedgerTurn,
  type FoxyReportLedgerStruggle,
} from '@alfanumrik/lib/foxy/foxy-report';

/**
 * GET /api/super-admin/foxy-report/[studentId]
 *
 * Read-only "Foxy Learning Report" — the payoff surface that turns the Foxy
 * learning-loop data into an at-a-glance per-student report for admins/teachers.
 *
 * It reads data ALREADY populated by the live evidential path (foxy_sessions,
 * foxy_chat_messages, foxy_served_items → concept_attempts, concept_mastery,
 * student_misconceptions) and ADDITIVELY enriches from the (currently-dark)
 * event ledger (state_events: learner.turn_classified + learner.struggle_observed)
 * WHEN it's ramped. Every ledger-derived section degrades to empty / null /
 * available:false when no ledger rows exist — the route NEVER errors on a dark bus.
 *
 * Auth: `super_admin.access` — the SAME existing permission the sibling
 *   super-admin analytics/report routes use (marking-integrity/[studentId],
 *   foxy-quality). No new permission, no new RBAC.
 *
 * READ-ONLY: no writes. No mastery / XP / learner-state mutation (P1/P2/P3
 *   untouched). supabaseAdmin (service role) is server-only.
 *
 * P5: grade is a STRING, passed through untouched.
 * P13: returns codes / ids / enums / aggregates and only the student-identifying
 *   content the admin is already entitled to via the sibling routes (concept
 *   titles, subjects, chapters, mastery). NEVER message text, served-item stems,
 *   or the free-text student_misconceptions columns — those columns are not read.
 */

export const runtime = 'nodejs';
export const revalidate = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read caps — bounded reads for an admin at-a-glance surface.
const SESSION_LIMIT = 200;
const SERVED_LIMIT = 500;
const ATTEMPT_LIMIT = 1000;
const MISCONCEPTION_LIMIT = 500;
const MASTERY_LIMIT = 1000;
const LEDGER_LIMIT = 1000;
const CONCEPT_META_LIMIT = 500;
const LABEL_LIMIT = 500;

// Ledger look-back window (index-friendly on idx_state_events_actor_kind).
const LEDGER_WINDOW_DAYS = 90;

const LEDGER_KINDS = ['learner.turn_classified', 'learner.struggle_observed'] as const;

interface RouteParams {
  params: Promise<{ studentId: string }>;
}

/** Coerce a Supabase array result to rows, treating any error as an empty read. */
function rows<T>(res: { data: unknown; error: unknown } | null | undefined): T[] {
  if (!res || res.error || !Array.isArray(res.data)) return [];
  return res.data as T[];
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  const { studentId } = await params;
  if (!UUID_RE.test(studentId)) {
    return NextResponse.json(
      { success: false, error: 'studentId must be a valid UUID' },
      { status: 400 },
    );
  }

  try {
    // 1. Student anchor — grade (P5 string) + auth_user_id (state_events key).
    const { data: student, error: studentErr } = await supabaseAdmin
      .from('students')
      .select('grade, auth_user_id')
      .eq('id', studentId)
      .maybeSingle();

    if (studentErr) {
      logger.error('super-admin.foxy-report: student lookup failed', {
        error: studentErr.message,
      });
      return NextResponse.json(
        { success: false, error: 'Student lookup failed' },
        { status: 500 },
      );
    }
    if (!student) {
      return NextResponse.json(
        { success: false, error: 'Student not found' },
        { status: 404 },
      );
    }

    const grade: string | null = (student as { grade?: string | null }).grade ?? null;
    const authUserId: string | null =
      (student as { auth_user_id?: string | null }).auth_user_id ?? null;

    const ledgerCutoff = new Date(
      Date.now() - LEDGER_WINDOW_DAYS * 24 * 3600 * 1000,
    ).toISOString();

    // 2. Phase-1 reads (independent). Each degrades to empty on error.
    const [
      sessionsRes,
      servedRes,
      masteryRes,
      attemptsRes,
      misconceptionRes,
      turnCountRes,
      ledgerRes,
    ] = await Promise.all([
      supabaseAdmin
        .from('foxy_sessions')
        .select(
          'id, subject, grade, chapter, mode, last_active_at, created_at, lesson_step, lesson_objective_concept_id',
        )
        .eq('student_id', studentId)
        .order('last_active_at', { ascending: false })
        .limit(SESSION_LIMIT),
      supabaseAdmin
        .from('foxy_served_items')
        .select('id, session_id, concept_id, question_id, served_at, answered_at, attempt_id')
        .eq('student_id', studentId)
        .order('served_at', { ascending: false })
        .limit(SERVED_LIMIT),
      supabaseAdmin
        .from('concept_mastery')
        .select('concept_id, mastery_mean, mastery_probability, mastery_level, updated_at')
        .eq('student_id', studentId)
        .not('concept_id', 'is', null)
        .limit(MASTERY_LIMIT),
      supabaseAdmin
        .from('concept_attempts')
        .select('attempt_id, concept_id, correct, answered_at, prior_mastery_mean, posterior_mastery_mean')
        .eq('student_id', studentId)
        .eq('status', 'answered')
        .order('answered_at', { ascending: false })
        .limit(ATTEMPT_LIMIT),
      supabaseAdmin
        .from('student_misconceptions')
        // CODES / status / timestamps ONLY — never the free-text question/answer columns (P13).
        .select('pattern_code, concept_code, detected_at, is_resolved, resolved_at')
        .eq('student_id', studentId)
        .order('detected_at', { ascending: false })
        .limit(MISCONCEPTION_LIMIT),
      supabaseAdmin
        .from('foxy_chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .eq('role', 'user'),
      // The event ledger is DARK until ramped; a missing/empty read degrades cleanly.
      authUserId
        ? supabaseAdmin
            .from('state_events')
            .select('kind, occurred_at, payload')
            .eq('actor_auth_user_id', authUserId)
            .in('kind', LEDGER_KINDS as unknown as string[])
            .gte('occurred_at', ledgerCutoff)
            .order('occurred_at', { ascending: false })
            .limit(LEDGER_LIMIT)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const sessions = rows<FoxyReportSessionRow>(sessionsRes);
    const servedItems = rows<FoxyReportServedItemRow>(servedRes);
    const masteryRows = rows<FoxyReportMasteryRow>(masteryRes);
    const attempts = rows<FoxyReportAttemptRow>(attemptsRes);
    const studentMisconceptions = rows<FoxyReportStudentMisconceptionRow>(misconceptionRes);
    const userTurnCount = turnCountRes.error ? 0 : turnCountRes.count ?? 0;

    // Split the ledger by kind into perception turns + struggle observations.
    const ledgerRows = rows<{ kind: string; occurred_at: string | null; payload: unknown }>(
      ledgerRes,
    );
    const ledgerTurns: FoxyReportLedgerTurn[] = [];
    const ledgerStruggles: FoxyReportLedgerStruggle[] = [];
    for (const row of ledgerRows) {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      if (row.kind === 'learner.turn_classified') {
        ledgerTurns.push({
          occurred_at: row.occurred_at,
          misconceptionCode:
            typeof payload.misconceptionCode === 'string' ? payload.misconceptionCode : null,
          struggleSignal:
            typeof payload.struggleSignal === 'string' ? payload.struggleSignal : null,
        });
      } else if (row.kind === 'learner.struggle_observed') {
        ledgerStruggles.push({
          occurred_at: row.occurred_at,
          signalType: typeof payload.signalType === 'string' ? payload.signalType : null,
        });
      }
    }

    // 3. Collect ids/codes for the enrichment reads.
    const conceptIds = new Set<string>();
    for (const s of servedItems) if (s.concept_id) conceptIds.add(s.concept_id);
    for (const m of masteryRows) if (m.concept_id) conceptIds.add(m.concept_id);
    for (const s of sessions) {
      if (s.lesson_objective_concept_id) conceptIds.add(s.lesson_objective_concept_id);
    }
    const conceptIdList = Array.from(conceptIds).slice(0, CONCEPT_META_LIMIT);

    const codes = new Set<string>();
    for (const m of studentMisconceptions) if (m.pattern_code) codes.add(m.pattern_code);
    for (const t of ledgerTurns) if (t.misconceptionCode) codes.add(t.misconceptionCode);
    const codeList = Array.from(codes).slice(0, LABEL_LIMIT);

    // 4. Phase-2 enrichment reads (concept names + bilingual misconception labels).
    const [conceptMetaRes, labelRes] = await Promise.all([
      conceptIdList.length > 0
        ? supabaseAdmin
            .from('chapter_concepts')
            .select('id, title, chapter_number, subject')
            .in('id', conceptIdList)
        : Promise.resolve({ data: [], error: null }),
      codeList.length > 0
        ? supabaseAdmin
            .from('question_misconceptions')
            .select('misconception_code, misconception_label, misconception_label_hi')
            .in('misconception_code', codeList)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const conceptMeta = rows<FoxyReportConceptMeta>(conceptMetaRes);
    const misconceptionLabels = rows<FoxyReportMisconceptionLabelRow>(labelRes);

    // 5. Shape the report via the pure aggregator.
    const report = composeFoxyLearningReport({
      studentId,
      grade,
      generatedAt: new Date().toISOString(),
      sessions,
      userTurnCount,
      servedItems,
      attempts,
      masteryRows,
      conceptMeta,
      studentMisconceptions,
      misconceptionLabels,
      ledgerTurns,
      ledgerStruggles,
    });

    return NextResponse.json(
      { success: true, data: report },
      { headers: { 'Cache-Control': 'private, max-age=0, s-maxage=30' } },
    );
  } catch (err) {
    logger.error('super-admin.foxy-report: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
