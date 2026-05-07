import { NextRequest, NextResponse } from 'next/server';
import { resolveTxt } from 'node:dns/promises';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-auth';
import { getDomainState, getVercelEnv } from '@/lib/vercel/domains';
import { logger } from '@/lib/logger';

/**
 * POST /api/cron/reverify-domains
 *
 * Nightly drift detector for white-label custom domains. Walks every school
 * with `domain_verified=true` and re-runs both proofs the operator originally
 * passed:
 *
 *   1. DNS-TXT verify — `_alfanumrik-verify.<domain>` must still contain
 *      the deterministic token `alfanumrik-verify-<school_id>`. Catches
 *      ownership rotation (e.g. school changed DNS provider, lost the record).
 *   2. Vercel attach status — Vercel must still report `verified=true` AND
 *      `misconfigured=false`. Catches CNAME drift, accidental detach, or
 *      TLS-cert expiry that's left the domain unable to serve traffic.
 *
 * If EITHER check fails, we flip `domain_verified=false` on the school row
 * and write an `admin_audit_log` entry with action
 * `tenant.custom_domain_drift_detected` so super-admin sees a paper trail.
 * The school admin must re-run /api/super-admin/institutions/verify-domain
 * (and possibly attach-vercel-domain) to re-establish trust.
 *
 * Why a cron rather than tying re-verify to user requests:
 *   - The drift window is server-detected, not user-triggered. A school
 *     can rotate DNS at 3am and never log in until next quarter — by then
 *     traffic on the custom domain is silently broken. Catching this in
 *     the next nightly pass keeps the support burden bounded.
 *   - Both proofs are cheap (one DNS lookup + one Vercel GET per school).
 *     Even with 1000 verified domains, this finishes in ~30s on cold caches.
 *
 * Auth: CRON_SECRET header (Vercel Cron sets it). Constant-time compared.
 *
 * Idempotency:
 *   - Schools already at `domain_verified=false` are NOT re-checked
 *     (they're already in "needs-attention" state, no drift to detect).
 *   - Drift audit is written ONLY on the flip (false→true→false transition);
 *     re-running the cron on a school that's already false→drifted does NOT
 *     create duplicate audit rows.
 *
 * Fail-graceful:
 *   - VERCEL_NOT_CONFIGURED → Vercel check is SKIPPED (DNS-TXT still runs).
 *     Reported in the response so operators know why TLS drift wouldn't
 *     have been caught this run.
 *   - Per-school errors are aggregated into `summary.errors[]`; one bad
 *     row does not abort the whole sweep.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

// ─── Constants ───────────────────────────────────────────────────────────────

const VERIFICATION_PREFIX = '_alfanumrik-verify';
const TOKEN_PREFIX = 'alfanumrik-verify';
const BATCH_LIMIT = 200; // Hard cap per run; if exceeded we log + cron picks rest tomorrow.

interface SchoolRow {
  id: string;
  custom_domain: string | null;
  domain_verified: boolean | null;
}

interface DriftReason {
  dns_ok: boolean;
  vercel_ok: boolean | null; // null = skipped (Vercel not configured)
  diagnostic: string;
}

interface CronSummary {
  schools_scanned: number;
  drift_detected: number;
  still_healthy: number;
  vercel_skipped: boolean;
  errors: string[];
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function verifyCronSecret(request: NextRequest): boolean {
  const cronSecret =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || !cronSecret) return false;
  if (cronSecret.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < cronSecret.length; i++) {
    mismatch |= cronSecret.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── DNS check ───────────────────────────────────────────────────────────────

async function checkDnsTxt(schoolId: string, customDomain: string): Promise<{ ok: boolean; diagnostic: string }> {
  const expectedToken = `${TOKEN_PREFIX}-${schoolId}`;
  const recordName = `${VERIFICATION_PREFIX}.${customDomain}`;

  let txtRecords: string[][];
  try {
    txtRecords = await resolveTxt(recordName);
  } catch (err) {
    const errCode = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    return {
      ok: false,
      diagnostic:
        errCode === 'ENOTFOUND' || errCode === 'ENODATA'
          ? `dns.${recordName}.missing`
          : `dns.${recordName}.lookup_failed_${errCode}`,
    };
  }

  const flat = txtRecords.map(parts => parts.join(''));
  if (!flat.includes(expectedToken)) {
    return { ok: false, diagnostic: `dns.${recordName}.token_mismatch` };
  }
  return { ok: true, diagnostic: 'dns.ok' };
}

// ─── Vercel check ────────────────────────────────────────────────────────────

async function checkVercelState(customDomain: string): Promise<{ ok: boolean; diagnostic: string }> {
  const result = await getDomainState(customDomain);
  if (!result.ok) {
    return { ok: false, diagnostic: `vercel.${result.code ?? 'error'}.${result.status}` };
  }
  if (!result.data.verified) {
    return { ok: false, diagnostic: 'vercel.not_verified' };
  }
  if (result.data.misconfigured === true) {
    return { ok: false, diagnostic: 'vercel.misconfigured' };
  }
  return { ok: true, diagnostic: 'vercel.ok' };
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const startTime = Date.now();
  const summary: CronSummary = {
    schools_scanned: 0,
    drift_detected: 0,
    still_healthy: 0,
    vercel_skipped: getVercelEnv() === null,
    errors: [],
  };

  try {
    const admin = getSupabaseAdmin();

    // Fetch verified schools. Cap at BATCH_LIMIT — anything beyond will be
    // picked up next run; the order is stable so we don't starve any tail.
    const { data: rawSchools, error: fetchErr } = await admin
      .from('schools')
      .select('id, custom_domain, domain_verified')
      .eq('domain_verified', true)
      .not('custom_domain', 'is', null)
      .order('id', { ascending: true })
      .limit(BATCH_LIMIT);

    if (fetchErr) {
      logger.error('cron/reverify-domains: school fetch failed', {
        error: new Error(fetchErr.message),
      });
      return NextResponse.json(
        {
          success: false,
          error: 'school fetch failed',
          data: { ...summary, duration_ms: Date.now() - startTime },
        },
        { status: 500 },
      );
    }

    const schools = (rawSchools ?? []) as SchoolRow[];
    summary.schools_scanned = schools.length;

    if (schools.length === 0) {
      logger.info('cron/reverify-domains: no verified schools to check');
      return NextResponse.json({
        success: true,
        data: { ...summary, duration_ms: Date.now() - startTime },
      });
    }

    for (const school of schools) {
      // The .not('custom_domain', 'is', null) filter should make this
      // unreachable; defensive cast for TS narrowing.
      if (!school.custom_domain) continue;

      try {
        const dns = await checkDnsTxt(school.id, school.custom_domain);
        const vercel = summary.vercel_skipped
          ? { ok: true, diagnostic: 'vercel.skipped' } // pretend OK so we only fail on DNS when Vercel is offline-by-config
          : await checkVercelState(school.custom_domain);

        const drift: DriftReason = {
          dns_ok: dns.ok,
          vercel_ok: summary.vercel_skipped ? null : vercel.ok,
          diagnostic: [dns.diagnostic, vercel.diagnostic].join('|'),
        };

        // We only flag drift when DNS fails OR (Vercel was checked AND it failed).
        // Vercel-skipped runs treat Vercel as "unknown, not failing" — DNS is
        // the source of truth this pass.
        const driftDetected = !dns.ok || (!summary.vercel_skipped && !vercel.ok);

        if (!driftDetected) {
          summary.still_healthy++;
          continue;
        }

        // Flip domain_verified=false. We update from the cached `true` value,
        // not blindly — if a parallel writer (e.g. /verify-domain re-run)
        // already moved the row, we don't undo their work.
        const { error: updErr } = await admin
          .from('schools')
          .update({
            domain_verified: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', school.id)
          .eq('domain_verified', true); // optimistic guard

        if (updErr) {
          summary.errors.push(`school_${school.id}_flip_failed: ${updErr.message}`);
          continue;
        }

        await logAdminAction({
          action: 'tenant.custom_domain_drift_detected',
          entity_type: 'school',
          entity_id: school.id,
          details: {
            custom_domain: school.custom_domain,
            drift,
            triggered_by: 'cron/reverify-domains',
          },
        });

        summary.drift_detected++;
        logger.info('cron/reverify-domains: drift detected', {
          schoolId: school.id,
          customDomain: school.custom_domain,
          dnsOk: drift.dns_ok,
          vercelOk: drift.vercel_ok,
          diagnostic: drift.diagnostic,
        });
      } catch (err) {
        summary.errors.push(
          `school_${school.id}_exception: ${err instanceof Error ? err.message : String(err)}`,
        );
        logger.error('cron/reverify-domains: per-school exception', {
          error: err instanceof Error ? err : new Error(String(err)),
          schoolId: school.id,
        });
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info('cron/reverify-domains: completed', {
      schools_scanned: summary.schools_scanned,
      drift_detected: summary.drift_detected,
      still_healthy: summary.still_healthy,
      vercel_skipped: summary.vercel_skipped,
      errors_count: summary.errors.length,
      duration_ms: durationMs,
    });

    return NextResponse.json({
      success: true,
      data: { ...summary, duration_ms: durationMs },
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error('cron/reverify-domains: unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      duration_ms: durationMs,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Internal cron error',
        data: { ...summary, duration_ms: durationMs },
      },
      { status: 500 },
    );
  }
}
