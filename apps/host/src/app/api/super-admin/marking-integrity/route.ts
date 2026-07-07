import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';

/**
 * GET /api/super-admin/marking-integrity
 *
 * Marking-Authenticity Phase 6.18 — operator-facing forensic endpoint backed
 * by the `marking_audit_last_30d` Postgres view (migration
 * `20260504100400_marking_audit_view.sql`). Surfaces every quiz_responses row
 * in the last 30 days where the recorded `is_correct` disagrees with what the
 * per-session shuffle snapshot says it should have been.
 *
 * Auth: `super_admin.access` — matches the permission code used by every
 * other super-admin route. No new RBAC permission introduced.
 *
 * View access posture
 *   The migration grants SELECT on the view to `service_role` only; the
 *   `authenticated` and `anon` roles are explicitly REVOKEd. We therefore use
 *   `supabaseAdmin` (service role) — that is the only client that can read it.
 *
 * Privacy posture (P13)
 *   The view exposes UUIDs only. We DO NOT join `students` here even though
 *   service_role would let us — names / emails / phones are out of scope for
 *   this endpoint. The frontend resolves a display handle separately, behind
 *   its own super-admin RBAC check.
 *
 * Caching
 *   `revalidate = 60` — operational dashboard, 60s freshness is fine. Vercel
 *   edge cache will respect this; CDN intermediaries respect the explicit
 *   `Cache-Control: s-maxage=60` header below.
 *
 * Migration-not-applied fallback
 *   If the view doesn't exist on this environment yet (e.g. a preview deploy
 *   or a fresh staging that hasn't run the new migration), Postgres returns
 *   error code `42P01`. We translate that into 503 with a structured error
 *   so the frontend can render a "schema not yet ready" banner instead of a
 *   generic 500.
 */

export const runtime = 'nodejs';
export const revalidate = 60;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const TIME_WINDOW = '30d' as const;

// Loose UUID v4-ish shape; we just want to reject obvious garbage before it
// hits the DB. Postgres will reject malformed UUIDs anyway, but a quick
// pre-check produces a tighter error message.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OrderBy = 'drift_count' | 'last_event_at';

function clampLimit(raw: string | null): number {
  if (raw == null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function parseOrderBy(raw: string | null): OrderBy {
  if (raw === 'last_event_at') return 'last_event_at';
  return 'drift_count';
}

interface ViewRow {
  student_id: string;
  session_id: string;
  question_id: string;
  selected_option: number;
  snapshot_correct_idx: number | null;
  recorded_is_correct: boolean;
  expected_is_correct: boolean | null;
  completed_at: string;
}

interface RowOut {
  student_id: string;
  session_id: string;
  question_id: string;
  selected_option: number;
  snapshot_correct_idx: number | null;
  recorded_is_correct: boolean;
  expected_is_correct: boolean;
  completed_at: string;
}

/**
 * Fire-and-forget super-admin observability event. We can't go through the
 * typed `capture()` wrapper in `@alfanumrik/lib/posthog/server` because adding a new
 * event name to the typed taxonomy is owned by the analytics-types module —
 * out of scope for this route. Instead we POST directly to the PostHog
 * capture API. Failures are swallowed: telemetry must never break the route.
 *
 * Privacy: only the row count and the requesting admin's user_id are sent.
 * No student IDs, no question IDs, no session IDs.
 */
async function emitMarkingIntegrityViewedEvent(args: {
  rowCount: number;
  adminUserId: string;
}): Promise<void> {
  const apiKey =
    process.env.POSTHOG_PROJECT_API_KEY ||
    process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;
  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

  try {
    // Best-effort POST; do not await response body. Use AbortController so a
    // hung PostHog endpoint can't wedge the response.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2_000);
    const res = await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event: 'super_admin_marking_integrity_viewed',
        distinct_id: args.adminUserId,
        properties: {
          row_count: args.rowCount,
          $process_person_profile: false,
        },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    // Drain the body so the connection can be reused.
    void res.text().catch(() => {});
  } catch {
    // Never throw — analytics is fail-soft.
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  const url = request.nextUrl;
  const limit = clampLimit(url.searchParams.get('limit'));
  const orderBy = parseOrderBy(url.searchParams.get('orderBy'));
  const studentIdRaw = url.searchParams.get('student_id');

  if (studentIdRaw && !UUID_RE.test(studentIdRaw)) {
    return NextResponse.json(
      { error: 'invalid_student_id', message: 'student_id must be a UUID' },
      { status: 400 },
    );
  }
  const studentId = studentIdRaw ?? null;

  try {
    // ── 1. Row pull ──────────────────────────────────────────────────────
    // The view returns one row per drifted-or-missing-snapshot response.
    // - orderBy=last_event_at: most-recent drift first
    // - orderBy=drift_count (default): the view itself is row-level, so we
    //   approximate by ordering by completed_at desc and letting the
    //   summary aggregate fold across students. The frontend top-N panel
    //   does its own GROUP BY on the rows we return.
    let rowQuery = supabaseAdmin
      .from('marking_audit_last_30d')
      .select(
        'student_id, session_id, question_id, selected_option, snapshot_correct_idx, recorded_is_correct, expected_is_correct, completed_at',
      )
      .order('completed_at', { ascending: false })
      .limit(limit);

    if (studentId) rowQuery = rowQuery.eq('student_id', studentId);

    const rowRes = await rowQuery;

    if (rowRes.error) {
      // 42P01 = undefined_table (view not present in this env yet).
      const code = (rowRes.error as { code?: string }).code;
      if (code === '42P01') {
        return NextResponse.json(
          {
            error: 'view_unavailable',
            message:
              'marking_audit_last_30d view is not yet present on this environment. Run the latest migrations.',
          },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: 'query_failed', message: rowRes.error.message },
        { status: 500 },
      );
    }

    const rawRows = (rowRes.data ?? []) as ViewRow[];

    // The view's `expected_is_correct` is NULL when the snapshot is missing.
    // The contract typed in the runbook is `boolean`, so we coerce the NULL
    // case to `false` (which equals "we cannot prove it should have been
    // correct, so treat as expected-incorrect"). The `snapshot_correct_idx`
    // null marker on the same row tells the frontend whether this is a
    // drift case or a missing-snapshot case.
    const rows: RowOut[] = rawRows.map((r) => ({
      student_id: r.student_id,
      session_id: r.session_id,
      question_id: r.question_id,
      selected_option: r.selected_option,
      snapshot_correct_idx: r.snapshot_correct_idx,
      recorded_is_correct: !!r.recorded_is_correct,
      expected_is_correct:
        r.expected_is_correct === null ? false : !!r.expected_is_correct,
      completed_at: r.completed_at,
    }));

    // Apply orderBy semantics: drift_count is a synthetic ordering — we
    // order by student_id frequency in the rows we just returned. This is
    // an approximation (the true top-N requires aggregation across the full
    // view), but matches the frontend "rows-as-evidence" use case.
    if (orderBy === 'drift_count') {
      const counts = new Map<string, number>();
      for (const r of rows) {
        counts.set(r.student_id, (counts.get(r.student_id) ?? 0) + 1);
      }
      rows.sort((a, b) => {
        const ca = counts.get(a.student_id) ?? 0;
        const cb = counts.get(b.student_id) ?? 0;
        if (cb !== ca) return cb - ca;
        // Tiebreak by completed_at desc so newer drift bubbles up.
        return a.completed_at < b.completed_at ? 1 : -1;
      });
    }

    // ── 2. Summary aggregates ────────────────────────────────────────────
    // These are computed across the FULL view, not just the limited row
    // window. Use head-only count queries for efficiency.
    //
    // The view itself only contains rows where the recorded `is_correct`
    // disagrees with the snapshot OR the snapshot is missing (see migration
    // lines 92-103). So `total_drift_count` is just count where
    // `snapshot_correct_idx IS NOT NULL` (i.e. an active drift, not a
    // missing snapshot), and `total_missing_snapshot` is the IS NULL slice.
    const summaryStudentFilter = studentId ? { student_id: studentId } : null;

    const driftQuery = supabaseAdmin
      .from('marking_audit_last_30d')
      .select('*', { count: 'exact', head: true })
      .not('snapshot_correct_idx', 'is', null);

    const missingSnapshotQuery = supabaseAdmin
      .from('marking_audit_last_30d')
      .select('*', { count: 'exact', head: true })
      .is('snapshot_correct_idx', null);

    // For affected_students we cannot rely on count(distinct …) via the
    // PostgREST API directly; we pull a column slice and de-dupe in TS.
    // The view is bounded to 30 days and to drift/missing rows only, so
    // even on the worst day this is at most O(thousands) of UUIDs.
    const studentsQuery = supabaseAdmin
      .from('marking_audit_last_30d')
      .select('student_id');

    const driftQueryFiltered = summaryStudentFilter
      ? driftQuery.eq('student_id', summaryStudentFilter.student_id)
      : driftQuery;
    const missingQueryFiltered = summaryStudentFilter
      ? missingSnapshotQuery.eq(
          'student_id',
          summaryStudentFilter.student_id,
        )
      : missingSnapshotQuery;
    const studentsQueryFiltered = summaryStudentFilter
      ? studentsQuery.eq('student_id', summaryStudentFilter.student_id)
      : studentsQuery;

    const [driftRes, missingRes, studentsRes] = await Promise.all([
      driftQueryFiltered,
      missingQueryFiltered,
      studentsQueryFiltered,
    ]);

    // If any of the summary queries fails because the view is missing,
    // return the same 503 we returned above. (Belt and braces — the row
    // query above already covers it, but this protects against partial
    // rollouts where only some clients see the view.)
    for (const r of [driftRes, missingRes, studentsRes]) {
      const code = (r.error as { code?: string } | null)?.code;
      if (code === '42P01') {
        return NextResponse.json(
          {
            error: 'view_unavailable',
            message:
              'marking_audit_last_30d view is not yet present on this environment.',
          },
          { status: 503 },
        );
      }
      if (r.error) {
        return NextResponse.json(
          { error: 'summary_failed', message: r.error.message },
          { status: 500 },
        );
      }
    }

    const studentIdRows =
      (studentsRes.data ?? []) as Array<{ student_id: string }>;
    const distinctStudents = new Set<string>();
    for (const r of studentIdRows) distinctStudents.add(r.student_id);

    const summary = {
      total_drift_count: driftRes.count ?? 0,
      total_missing_snapshot: missingRes.count ?? 0,
      affected_students: distinctStudents.size,
      time_window: TIME_WINDOW,
    };

    // ── 3. Fire-and-forget telemetry ─────────────────────────────────────
    // Don't await — we don't want a slow PostHog ingest to block the
    // operator's dashboard load. The `void` floats it.
    void emitMarkingIntegrityViewedEvent({
      rowCount: rows.length,
      adminUserId: auth.userId ?? 'unknown',
    });

    return NextResponse.json(
      { rows, summary },
      {
        headers: {
          'Cache-Control': 'private, max-age=0, s-maxage=60',
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
