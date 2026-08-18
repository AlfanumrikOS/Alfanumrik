/**
 * GET /api/school-admin/leadership — Phase 5 (Foxy North-Star), lane K9.
 *
 * Leadership dashboard read-model for the principal / institution_admin.
 * Assembles: safeguarding counts + competency summary + existing overview +
 * NCERT coverage readouts, ALL scoped to the caller's school.
 *
 * Auth: reuses `resolveCommandCenterContext` (same pattern as
 * `/api/pulse/school`) — P9 gate on `institution.view_analytics`, JWT-bound
 * user-context Supabase client, server-resolved school_id (never trusts a
 * client value; optional `?school_id` only honored when it's one of the
 * caller's active schools). No `supabase-admin`.
 *
 * Data access:
 *   - `get_school_safeguarding_counts(p_school_id)`  (RPC — parallel architect
 *      lane migration)
 *   - `get_school_competency_summary(p_school_id)`    (RPC — parallel architect
 *      lane migration)
 *   - `get_school_overview(p_school_id)`              (existing Phase 3B RPC)
 *   - `subject_content_readiness_daily`               (existing view)
 *   - `cbse_syllabus_rag_diagnostic`                  (existing view)
 *
 * Order (2026-08-12, E2E P2-5 fix): `resolveCommandCenterContext` runs FIRST —
 * unauthenticated/unauthorized callers get its 401/403 unchanged, matching the
 * sibling routes (`overview`, `classes-at-risk`, `teacher-engagement`). Only
 * for an AUTHORIZED school admin does the `ff_school_pulse_v1` flag gate run:
 * when the flag is OFF the route returns `{ success: true, data: null,
 * gated: true }` with HTTP 200 (never 500; ops toggles the flag mid-flight and
 * authorized callers must fail-soft render). Previously the flag gate ran
 * before auth, so with the flag OFF every anonymous caller got a 200 — the
 * denial was invisible to monitoring and the 401/403 path was dead code.
 *
 * P13: aggregate counts + view rows only — no per-student PII.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  resolveCommandCenterContext,
  rpcErrorResponse,
} from '@alfanumrik/lib/school-admin/command-center-context';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';

const ROUTE = '/api/school-admin/leadership';
const FLAG = 'ff_school_pulse_v1';

/** How many coverage rows to surface — most-recent-first from the daily view. */
const COVERAGE_LIMIT = 40;

export const dynamic = 'force-dynamic';

interface SchoolOverview {
  class_count?: number;
  teacher_count?: number;
  student_count?: number;
  avg_mastery?: number | null;
  data_state?: string;
}

interface SafeguardingCounts {
  at_risk_count?: number;
  inactive_count?: number;
  escalated_count?: number;
  open_interventions?: number;
  data_state?: string;
}

interface CompetencySummary {
  by_grade?: Array<{ grade: string; avg_mastery: number | null; student_count: number }>;
  by_subject?: Array<{ subject_code: string; avg_mastery: number | null; student_count: number }>;
  data_state?: string;
}

interface CoverageRow {
  subject_code: string;
  grade: string | null;
  ready_chapter_count: number | null;
  total_chapter_count: number | null;
  updated_at: string | null;
}

interface DiagnosticRow {
  subject_code: string;
  grade: string | null;
  chapter_number: number | null;
  chunk_count: number | null;
  sync_state: string | null;
}

interface LeadershipPayload {
  schoolId: string;
  overview: {
    classCount: number;
    teacherCount: number;
    studentCount: number;
    avgMastery: number | null;
  };
  safeguarding: {
    atRiskCount: number;
    inactiveCount: number;
    escalatedCount: number;
    openInterventions: number;
  };
  competency: {
    byGrade: Array<{ grade: string; avgMastery: number | null; studentCount: number }>;
    bySubject: Array<{ subjectCode: string; avgMastery: number | null; studentCount: number }>;
  };
  coverage: {
    daily: Array<{
      subjectCode: string;
      grade: string | null;
      readyChapterCount: number;
      totalChapterCount: number;
      updatedAt: string | null;
    }>;
    staleChapters: Array<{
      subjectCode: string;
      grade: string | null;
      chapterNumber: number | null;
      chunkCount: number;
      syncState: string;
    }>;
  };
  dataState: 'live' | 'no_data';
  schemaVersion: 1;
  generatedAt: string;
}

export async function GET(request: NextRequest) {
  try {
    // ── 0. Authorize + resolve school context (P9 + JWT client + school_id) ──
    // MUST run before the flag gate (P2-5): the fail-soft 200 {gated:true} is
    // a contract for AUTHORIZED school admins only. Anonymous / unauthorized
    // callers get the resolver's 401/403 unchanged, same as the sibling
    // command-center routes.
    const resolved = await resolveCommandCenterContext(request, ROUTE);
    if (!resolved.ok) return resolved.response;
    const { supabase, schoolId } = resolved.ctx;

    // ── 1. Flag gate (fail-soft, authorized callers only) ────────
    // Read the flag with no context (institution scoping happens naturally via
    // the school_admins row; the flag itself is a global OFF/ON at Phase 5).
    // Cache-Control stays `private, max-age=30`: the response is now always
    // per-authorized-caller, so a private short-TTL cache remains appropriate.
    const enabled = await isFeatureEnabled(FLAG).catch(() => false);
    if (!enabled) {
      return NextResponse.json(
        { success: true, data: null, gated: true },
        { status: 200, headers: { 'Cache-Control': 'private, max-age=30' } },
      );
    }

    // ── 2. Parallel RPC + view reads ─────────────────────────────
    const [
      overviewRes,
      safeguardingRes,
      competencyRes,
      coverageRes,
      diagnosticRes,
    ] = await Promise.all([
      supabase.rpc('get_school_overview', { p_school_id: schoolId }),
      supabase.rpc('get_school_safeguarding_counts', { p_school_id: schoolId }),
      supabase.rpc('get_school_competency_summary', { p_school_id: schoolId }),
      supabase
        .from('subject_content_readiness_daily')
        .select('subject_code, grade, ready_chapter_count, total_chapter_count, updated_at')
        .order('updated_at', { ascending: false })
        .limit(COVERAGE_LIMIT),
      supabase
        .from('cbse_syllabus_rag_diagnostic')
        .select('subject_code, grade, chapter_number, chunk_count, sync_state')
        .eq('sync_state', 'STALE')
        .limit(COVERAGE_LIMIT),
    ]);

    // Hard-fail on the RPCs (their absence is a real deploy problem).
    if (overviewRes.error) return rpcErrorResponse(overviewRes.error, ROUTE);
    if (safeguardingRes.error) return rpcErrorResponse(safeguardingRes.error, ROUTE);
    if (competencyRes.error) return rpcErrorResponse(competencyRes.error, ROUTE);

    // Coverage views are best-effort — fail-soft to empty arrays (view may be
    // absent on some envs).
    const coverageRows = (coverageRes.error ? [] : coverageRes.data ?? []) as CoverageRow[];
    const diagnosticRows = (diagnosticRes.error ? [] : diagnosticRes.data ?? []) as DiagnosticRow[];

    const overview = (overviewRes.data ?? null) as SchoolOverview | null;
    const safeguarding = (safeguardingRes.data ?? null) as SafeguardingCounts | null;
    const competency = (competencyRes.data ?? null) as CompetencySummary | null;

    const body: LeadershipPayload = {
      schoolId,
      overview: {
        classCount: overview?.class_count ?? 0,
        teacherCount: overview?.teacher_count ?? 0,
        studentCount: overview?.student_count ?? 0,
        avgMastery: overview?.avg_mastery ?? null,
      },
      safeguarding: {
        atRiskCount: safeguarding?.at_risk_count ?? 0,
        inactiveCount: safeguarding?.inactive_count ?? 0,
        escalatedCount: safeguarding?.escalated_count ?? 0,
        openInterventions: safeguarding?.open_interventions ?? 0,
      },
      competency: {
        byGrade: (competency?.by_grade ?? []).map((r) => ({
          grade: r.grade,
          avgMastery: r.avg_mastery,
          studentCount: r.student_count,
        })),
        bySubject: (competency?.by_subject ?? []).map((r) => ({
          subjectCode: r.subject_code,
          avgMastery: r.avg_mastery,
          studentCount: r.student_count,
        })),
      },
      coverage: {
        daily: coverageRows.map((r) => ({
          subjectCode: r.subject_code,
          grade: r.grade,
          readyChapterCount: r.ready_chapter_count ?? 0,
          totalChapterCount: r.total_chapter_count ?? 0,
          updatedAt: r.updated_at,
        })),
        staleChapters: diagnosticRows.map((r) => ({
          subjectCode: r.subject_code,
          grade: r.grade,
          chapterNumber: r.chapter_number,
          chunkCount: r.chunk_count ?? 0,
          syncState: r.sync_state ?? 'STALE',
        })),
      },
      dataState: overview?.data_state === 'live' ? 'live' : 'no_data',
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(
      { success: true, data: body },
      {
        headers: {
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
        },
      },
    );
  } catch (err) {
    logger.error('leadership_dashboard_failed', {
      route: ROUTE,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
