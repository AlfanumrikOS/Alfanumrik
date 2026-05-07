import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminUrl, supabaseAdminHeaders } from '@/lib/admin-auth';
import {
  attachDomainToProject,
  getDomainState,
  type VercelDomainState,
} from '@/lib/vercel/domains';

/**
 * POST /api/super-admin/institutions/attach-vercel-domain
 *
 * Attaches a school's `custom_domain` to the Vercel project so Vercel:
 *   - routes traffic to it
 *   - issues TLS via Let's Encrypt automatically once DNS is correct
 *
 * Pairs with #575's DNS-TXT verification:
 *   - DNS-TXT verify (#575): proves the operator owns the domain
 *   - Vercel attach (this PR): wires routing + TLS
 * Both are independent steps. Operator can run them in either order;
 * a domain only becomes useful after both pass.
 *
 * Body: { id: string, action?: 'attach' | 'status' }
 *
 * - `action: 'attach'` (default): POST /v10/projects/{id}/domains. 409
 *   from Vercel (already-attached) is treated as success — Vercel's
 *   own dedup. Audit-action `tenant.vercel_domain_attached`.
 * - `action: 'status'`: GET /v9/projects/{id}/domains/{name}. Read-only,
 *   no audit. Lets the UI refresh after the operator publishes DNS.
 *
 * Response includes Vercel's `verification` array — the DNS records
 * the operator must publish for Vercel-side verification (separate
 * from the `_alfanumrik-verify` TXT used by /verify-domain).
 *
 * Auth: authorizeAdmin (admin secret + RBAC). Super-admin only.
 *
 * Failure modes (all return 200 with success:false + diagnostic, NOT
 * 5xx, except for legitimate server errors):
 *   - Vercel env not configured → 503 with VERCEL_NOT_CONFIGURED code,
 *     so the UI can render "configure VERCEL_API_TOKEN" without
 *     surfacing it as a route bug.
 *   - school/custom_domain missing → 400.
 *   - Vercel API rejects → forwards Vercel's status + error.
 */

interface AttachResponse {
  success: true;
  vercel: VercelDomainState;
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  let body: { id?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const id = body?.id;
  const action = body?.action ?? 'attach';
  if (typeof id !== 'string' || id.length === 0) {
    return NextResponse.json({ error: 'Missing "id".' }, { status: 400 });
  }
  if (action !== 'attach' && action !== 'status') {
    return NextResponse.json(
      { error: `action must be 'attach' or 'status' (got '${action}').` },
      { status: 400 },
    );
  }

  // Load the school's custom_domain.
  const lookupRes = await fetch(
    supabaseAdminUrl(
      'schools',
      `id=eq.${encodeURIComponent(id)}&select=id,custom_domain&limit=1`,
    ),
    { headers: supabaseAdminHeaders() },
  );
  if (!lookupRes.ok) {
    return NextResponse.json({ error: 'School lookup failed.' }, { status: 502 });
  }
  const rows = await lookupRes.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'School not found.' }, { status: 404 });
  }
  const customDomain = rows[0]?.custom_domain as string | null;
  if (!customDomain) {
    return NextResponse.json(
      { error: 'School has no custom_domain set. Set it via PATCH /institutions first.' },
      { status: 400 },
    );
  }

  const result = action === 'attach'
    ? await attachDomainToProject(customDomain)
    : await getDomainState(customDomain);

  if (!result.ok) {
    // Use 503 specifically for "Vercel not configured" so the UI can
    // distinguish it from "Vercel rejected this domain".
    const status = result.code === 'VERCEL_NOT_CONFIGURED' ? 503 : result.status;
    return NextResponse.json(
      {
        error: result.error,
        code: result.code,
      },
      { status },
    );
  }

  // Audit the attach action (NOT status reads — those are passive).
  if (action === 'attach') {
    await logAdminAudit(auth, 'tenant.vercel_domain_attached', 'school', id, {
      custom_domain: customDomain,
      vercel_verified: result.data.verified,
      vercel_misconfigured: result.data.misconfigured ?? null,
    });
  }

  const responseBody: AttachResponse = {
    success: true,
    vercel: result.data,
  };
  return NextResponse.json(responseBody);
}
