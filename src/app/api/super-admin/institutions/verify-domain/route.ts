import { NextRequest, NextResponse } from 'next/server';
import { resolveTxt } from 'node:dns/promises';
import { authorizeAdmin, logAdminAudit, supabaseAdminUrl, supabaseAdminHeaders } from '@/lib/admin-auth';
import { logger } from '@/lib/logger';

/**
 * POST /api/super-admin/institutions/verify-domain
 *
 * Server-controlled DNS verification for a school's custom_domain.
 *
 * Verification token: `alfanumrik-verify-<school_id>` — deterministic per
 * school. The school admin must set a TXT record:
 *
 *   _alfanumrik-verify.<their-domain>   TXT   "alfanumrik-verify-<school_id>"
 *
 * On success, this endpoint flips schools.domain_verified = true and writes
 * an audit row with action `tenant.custom_domain_verified`.
 *
 * Body: { id: string }   // school id
 *
 * Why a separate endpoint (not folded into PATCH /institutions):
 *   - PATCH lets super-admin SET the value; verification needs an external
 *     check (DNS lookup) which is read-only at the schools row layer until
 *     the lookup succeeds.
 *   - Keeping verification separate means we can re-run it as a no-op when
 *     DNS propagation is slow — it does NOT touch any other field.
 *   - A future cron (`re-verify-custom-domains`) calls this same logic
 *     against every school whose domain_verified=true to detect rotations.
 *     Out of scope for this PR.
 *
 * Failure modes:
 *   - DNS lookup fails / returns no TXT records → 200 with verified=false
 *     and a diagnostic message. NOT a 5xx — this is an expected user-facing
 *     error.
 *   - Token not present in TXT records → same shape, different message.
 *   - Token present → flip domain_verified, return verified=true.
 */

const VERIFICATION_PREFIX = '_alfanumrik-verify';
const TOKEN_PREFIX = 'alfanumrik-verify';

interface VerifyResponse {
  success: true;
  verified: boolean;
  /** TXT record name the operator should publish. */
  expectedRecord: string;
  /** TXT value the operator should publish (deterministic per school). */
  expectedToken: string;
  /** Human-readable diagnostic for the UI. */
  message: string;
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const id = body?.id;
  if (typeof id !== 'string' || id.length === 0) {
    return NextResponse.json({ error: 'Missing "id".' }, { status: 400 });
  }

  // Load the school's current custom_domain.
  let school: { id: string; custom_domain: string | null; domain_verified: boolean | null };
  try {
    const res = await fetch(
      supabaseAdminUrl('schools', `id=eq.${encodeURIComponent(id)}&select=id,custom_domain,domain_verified&limit=1`),
      { headers: supabaseAdminHeaders() },
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'School lookup failed.' }, { status: 502 });
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'School not found.' }, { status: 404 });
    }
    school = rows[0];
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'School lookup failed.' },
      { status: 500 },
    );
  }

  const customDomain = school.custom_domain;
  const expectedToken = `${TOKEN_PREFIX}-${id}`;
  const expectedRecord = customDomain
    ? `${VERIFICATION_PREFIX}.${customDomain}`
    : `${VERIFICATION_PREFIX}.<your-domain>`;

  if (!customDomain) {
    // No domain set — return the expected record so the UI can display
    // instructions even before the operator types a domain.
    const body: VerifyResponse = {
      success: true,
      verified: false,
      expectedRecord,
      expectedToken,
      message: 'No custom domain set on this school. Set custom_domain first via PATCH /institutions.',
    };
    return NextResponse.json(body);
  }

  // Run the DNS lookup. Failures are treated as "verification failed" not
  // "5xx" — the operator hasn't propagated the record yet, expected.
  let txtRecords: string[][] = [];
  try {
    txtRecords = await resolveTxt(`${VERIFICATION_PREFIX}.${customDomain}`);
  } catch (err) {
    const errCode = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    logger.info('custom_domain_verify_dns_lookup_failed', {
      schoolId: id,
      customDomain,
      errCode,
    });
    const body: VerifyResponse = {
      success: true,
      verified: false,
      expectedRecord,
      expectedToken,
      message:
        errCode === 'ENOTFOUND' || errCode === 'ENODATA'
          ? `No TXT records at ${expectedRecord}. Check that the record is published.`
          : `DNS lookup failed (${errCode}). Try again in a minute — DNS may still be propagating.`,
    };
    return NextResponse.json(body);
  }

  // resolveTxt returns string[][] — each TXT record can be split into
  // chunks. Concatenate and check for the token.
  const flatRecords = txtRecords.map(parts => parts.join(''));
  const matched = flatRecords.includes(expectedToken);

  if (!matched) {
    const body: VerifyResponse = {
      success: true,
      verified: false,
      expectedRecord,
      expectedToken,
      message: `TXT records found (${flatRecords.length}) but none match ${expectedToken}. Check the record value.`,
    };
    return NextResponse.json(body);
  }

  // Verified! Flip domain_verified=true. Skip the round-trip if it's
  // already true — common when the operator clicks "Verify" twice.
  if (!school.domain_verified) {
    try {
      const updateRes = await fetch(
        supabaseAdminUrl('schools', `id=eq.${encodeURIComponent(id)}`),
        {
          method: 'PATCH',
          headers: supabaseAdminHeaders('return=representation'),
          body: JSON.stringify({ domain_verified: true, updated_at: new Date().toISOString() }),
        },
      );
      if (!updateRes.ok) {
        const text = await updateRes.text();
        return NextResponse.json(
          { error: `Verification succeeded but persist failed: ${text}` },
          { status: 500 },
        );
      }
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Persist failed' },
        { status: 500 },
      );
    }

    await logAdminAudit(auth, 'tenant.custom_domain_verified', 'school', id, {
      custom_domain: customDomain,
    });
  }

  const responseBody: VerifyResponse = {
    success: true,
    verified: true,
    expectedRecord,
    expectedToken,
    message: school.domain_verified
      ? 'Already verified.'
      : `Verified ${customDomain}. Configure Vercel project routing to complete TLS provisioning.`,
  };
  return NextResponse.json(responseBody);
}
