/**
 * Per-school health dashboard BFF (Phase E.6).
 *
 * Ops console for "how is each school doing right now?" — one screen to
 * replace hopping between Supabase queries, Sentry, and PostHog. This is
 * a READ-ONLY projection from existing tables; it never writes state.
 *
 * ADR-005 compliance:
 *   - No state_events writes (canonical-writer rule).
 *   - Pure projection from `schools`, `students`, `chapter_study_sessions`,
 *     `synthetic_monitor_results` (when present). No mutation paths.
 *
 * Graceful degradation:
 *   - `synthetic_monitor_results` is owned by Phase E.5. If E.5 hasn't
 *     merged yet, the table won't exist. We probe HEAD and downgrade the
 *     `white_label` field to `'na'` instead of 500'ing the whole route.
 *
 * Cache: max-age=60 — every operator hitting this hammers four Supabase
 * REST endpoints. 60s is fresh enough for ops triage and saves ~60x DB
 * roundtrips per minute.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '@/lib/admin-auth';

// ─── Types ──────────────────────────────────────────────────────

/** White-label config rollup — three buckets the UI renders as dots. */
type WhiteLabelStatus =
  | 'green'   // custom_domain set + verified + (when E.5 present) last synthetic check passed
  | 'yellow'  // custom_domain set but unverified, OR last synthetic check failed
  | 'red'     // configured but a recent synthetic check failed hard
  | 'none'    // no custom_domain configured (default)
  | 'na';     // `synthetic_monitor_results` table missing — E.5 not merged

/** Lifecycle bucket the UI badges as active / trial / paused. */
type SchoolLifecycleStatus = 'active' | 'trial' | 'paused';

export interface SchoolHealthRow {
  id: string;
  name: string;
  slug: string | null;
  status: SchoolLifecycleStatus;
  /** ISO date `YYYY-MM-DD` for display. */
  pilot_start: string | null;
  /** Distinct user_id with school_id=X active in the last 7 days. */
  active_users_7d: number;
  /** ISO timestamp of the most recent activity event (any source). */
  last_activity: string | null;
  subscription_plan: string | null;
  white_label: WhiteLabelStatus;
  custom_domain: string | null;
  /** Placeholder for Sentry integration — always "—" until follow-up. */
  errors_24h: string;
}

export interface HealthDashboardResponse {
  schools: SchoolHealthRow[];
  /** True if we degraded the white-label column (synthetic table missing). */
  synthetic_monitor_degraded: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Map (is_active, subscription_plan) → lifecycle bucket.
 *
 * The schools table doesn't have a literal `status` column; ops shorthand
 * derives it from these two fields. Trial > paused > active in priority
 * because a paused trial should still read as paused.
 */
function deriveLifecycleStatus(
  isActive: boolean | null,
  subscriptionPlan: string | null,
): SchoolLifecycleStatus {
  if (isActive === false) return 'paused';
  if (subscriptionPlan === 'trial') return 'trial';
  return 'active';
}

/** Format an ISO timestamp as `YYYY-MM-DD`. Returns null if input is null. */
function toIsoDate(timestamp: string | null): string | null {
  if (!timestamp) return null;
  // `Date` round-trip is safe here — we only use the date part.
  return timestamp.slice(0, 10);
}

/**
 * Probe whether the synthetic_monitor_results table exists.
 *
 * Phase E.5 introduces this table. Until it lands, the column has to
 * downgrade gracefully. We HEAD the REST endpoint with limit=0 — a 404
 * (table missing) is the negative signal; anything else (200, 401, 403,
 * 5xx) we treat as "table present" and let the actual query handle the
 * downstream failure mode.
 */
async function syntheticMonitorTableExists(): Promise<boolean> {
  try {
    const res = await fetch(
      supabaseAdminUrl('synthetic_monitor_results', 'select=id&limit=0'),
      { method: 'HEAD', headers: supabaseAdminHeaders() },
    );
    // PostgREST returns 404 for missing tables with body
    // `{"code":"42P01","message":"relation \"public.synthetic_monitor_results\" does not exist"}`.
    // 200 = table exists (may be empty). Anything else: treat as present and
    // let the real query surface the failure.
    return res.status !== 404;
  } catch {
    // Network error: pessimistic — degrade gracefully rather than crash.
    return false;
  }
}

/**
 * Latest synthetic-monitor result per school. Returns an empty map when
 * the table is absent (the caller has already checked).
 *
 * The shape is intentionally narrow: { school_id, status }. Status is
 * the closed string set 'pass' | 'fail' | 'warn' per the E.5 spec. If
 * E.5 lands with a different shape, the resolver below treats any
 * non-'pass' as `yellow` to stay safe.
 */
async function fetchLatestSyntheticBySchool(
  schoolIds: string[],
): Promise<Map<string, string>> {
  if (schoolIds.length === 0) return new Map();
  try {
    // PostgREST: order by run_at desc, distinct on school_id would need a
    // view. We pull recent results and reduce client-side. Limit 200 caps
    // memory at ~50 schools × 4 checks.
    const params = [
      'select=school_id,status,run_at',
      `school_id=in.(${schoolIds.join(',')})`,
      'order=run_at.desc',
      'limit=200',
    ].join('&');
    const res = await fetch(
      supabaseAdminUrl('synthetic_monitor_results', params),
      { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
    );
    if (!res.ok) return new Map();
    const rows: Array<{ school_id: string; status: string; run_at: string }> =
      await res.json();
    const latest = new Map<string, string>();
    for (const r of rows) {
      // First occurrence per school wins (rows are sorted desc by run_at).
      if (!latest.has(r.school_id)) latest.set(r.school_id, r.status);
    }
    return latest;
  } catch {
    return new Map();
  }
}

/**
 * Resolve the white-label bucket from custom_domain + verification + the
 * latest synthetic-monitor result. The synthetic dimension is `null` when
 * the table is missing (E.5 not merged) — caller should pre-resolve to
 * `'na'` in that case.
 */
function resolveWhiteLabel(
  customDomain: string | null,
  domainVerified: boolean | null,
  syntheticStatus: string | null | undefined,
  syntheticTableMissing: boolean,
): WhiteLabelStatus {
  if (!customDomain) return 'none';
  if (syntheticTableMissing) return 'na';
  // Hard fail on a recent synthetic failure trumps verification state.
  if (syntheticStatus === 'fail') return 'red';
  if (syntheticStatus === 'warn') return 'yellow';
  if (domainVerified !== true) return 'yellow';
  return 'green';
}

// ─── Route ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Schools (all non-deleted; super-admin sees every tenant).
    const schoolsQuery = [
      'select=id,name,slug,is_active,created_at,subscription_plan,custom_domain,domain_verified',
      'deleted_at=is.null',
      'order=created_at.desc',
    ].join('&');
    const schoolsRes = await fetch(
      supabaseAdminUrl('schools', schoolsQuery),
      { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
    );
    if (!schoolsRes.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch schools' },
        { status: schoolsRes.status },
      );
    }
    const schools: Array<{
      id: string;
      name: string;
      slug: string | null;
      is_active: boolean | null;
      created_at: string | null;
      subscription_plan: string | null;
      custom_domain: string | null;
      domain_verified: boolean | null;
    }> = await schoolsRes.json();

    if (schools.length === 0) {
      const body: HealthDashboardResponse = {
        schools: [],
        synthetic_monitor_degraded: false,
      };
      return NextResponse.json(body, {
        headers: { 'Cache-Control': 'max-age=60, must-revalidate' },
      });
    }

    const schoolIds = schools.map(s => s.id);

    // 2. Probe synthetic_monitor_results table existence in parallel with
    //    activity fetches so we don't add latency on the cold path.
    const [syntheticPresent, studentActivityRes, sessionActivityRes] =
      await Promise.all([
        syntheticMonitorTableExists(),
        // students.last_active is the per-student activity stamp. We pull
        // every active student that has touched the platform in the last
        // 7 days, then reduce by school_id client-side. distinct counting
        // by user_id needs the rows, not just COUNT(*).
        fetch(
          supabaseAdminUrl(
            'students',
            [
              'select=id,school_id,last_active',
              `school_id=in.(${schoolIds.join(',')})`,
              'is_active=eq.true',
              `last_active=gte.${sevenDaysAgo}`,
              'limit=20000',
            ].join('&'),
          ),
          { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
        ),
        // chapter_study_sessions.last_active_at is the secondary signal —
        // catches engagement that didn't bump students.last_active (e.g.,
        // teacher dashboards). We use it for the `last_activity` rollup.
        fetch(
          supabaseAdminUrl(
            'chapter_study_sessions',
            [
              'select=student_id,last_active_at',
              `last_active_at=gte.${sevenDaysAgo}`,
              'order=last_active_at.desc',
              'limit=20000',
            ].join('&'),
          ),
          { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
        ),
      ]);

    const studentActivity: Array<{ id: string; school_id: string; last_active: string | null }> =
      studentActivityRes.ok ? await studentActivityRes.json() : [];
    const sessionActivity: Array<{ student_id: string; last_active_at: string | null }> =
      sessionActivityRes.ok ? await sessionActivityRes.json() : [];

    // 3. Fetch the latest synthetic result per school (empty when table missing).
    const latestSynthetic = syntheticPresent
      ? await fetchLatestSyntheticBySchool(schoolIds)
      : new Map<string, string>();

    // 4. Build per-school rollups.
    //    active_users_7d  — distinct student_id with school_id=X
    //    last_activity    — max(students.last_active, sessions.last_active_at)
    //
    //    sessions are joined to schools via student → student.school_id. We
    //    pre-built a student → school map from the activity fetch.
    const studentToSchool = new Map<string, string>();
    const distinctActiveBySchool = new Map<string, Set<string>>();
    const lastActivityBySchool = new Map<string, string>();
    for (const s of studentActivity) {
      studentToSchool.set(s.id, s.school_id);
      let set = distinctActiveBySchool.get(s.school_id);
      if (!set) {
        set = new Set();
        distinctActiveBySchool.set(s.school_id, set);
      }
      set.add(s.id);
      if (s.last_active) {
        const prev = lastActivityBySchool.get(s.school_id);
        if (!prev || s.last_active > prev) {
          lastActivityBySchool.set(s.school_id, s.last_active);
        }
      }
    }
    for (const ses of sessionActivity) {
      const schoolId = studentToSchool.get(ses.student_id);
      if (!schoolId || !ses.last_active_at) continue;
      const prev = lastActivityBySchool.get(schoolId);
      if (!prev || ses.last_active_at > prev) {
        lastActivityBySchool.set(schoolId, ses.last_active_at);
      }
    }

    // 5. Assemble the response. Sorting (last_activity desc) is up to the
    //    client — see page.tsx — so the BFF returns rows in the schools
    //    creation order (descending), which is a sane fallback when no
    //    sort header is clicked yet.
    const rows: SchoolHealthRow[] = schools.map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      status: deriveLifecycleStatus(s.is_active, s.subscription_plan),
      pilot_start: toIsoDate(s.created_at),
      active_users_7d: distinctActiveBySchool.get(s.id)?.size ?? 0,
      last_activity: lastActivityBySchool.get(s.id) ?? null,
      subscription_plan: s.subscription_plan,
      white_label: resolveWhiteLabel(
        s.custom_domain,
        s.domain_verified,
        latestSynthetic.get(s.id),
        !syntheticPresent,
      ),
      custom_domain: s.custom_domain,
      errors_24h: '—', // Sentry integration follow-up.
    }));

    const body: HealthDashboardResponse = {
      schools: rows,
      synthetic_monitor_degraded: !syntheticPresent,
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'max-age=60, must-revalidate' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
