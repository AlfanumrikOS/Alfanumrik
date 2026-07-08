import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@alfanumrik/lib/admin-auth';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import {
  normalizeSlug,
  establishPrincipalAdmin,
} from '@alfanumrik/lib/school-provisioning';
import { logger } from '@alfanumrik/lib/logger';

// ─── Types ──────────────────────────────────────────────────────

interface ProvisionBody {
  name: string;
  board?: string;
  city?: string;
  state?: string;
  /** Billing contact email for the school (stored; not used for admin invite). */
  billing_email?: string;
  /** If provided, immediately establish a principal admin account + send invite. */
  admin_email?: string;
  admin_name?: string;
  plan?: string;
  seats?: number;
  price_per_seat?: number;
  tenant_type?: string;
}

/** Typed shape returned by the provision_school RPC. */
interface ProvisionSchoolRpcResult {
  school_id: string;
  slug: string;
  invite_code: string;
  subdomain: string;
}

// ─── Route ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Provisioning a new tenant is a platform-wide operation — super_admin only.
  // Matches the PATCH/POST gates on /api/super-admin/institutions.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const body: ProvisionBody = await request.json();

    // ── Input validation ──────────────────────────────────────
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'School name is required.' },
        { status: 400 },
      );
    }

    const name = body.name.trim();
    const plan = body.plan || 'trial';
    const seats = Math.max(1, Math.min(10000, body.seats ?? 50));
    const pricePerSeat = Math.max(0, body.price_per_seat ?? 0);

    // ── Slug normalisation ────────────────────────────────────
    // normalizeSlug() is the canonical helper shared with provisionTrialSchool().
    // Examples: "St. Xavier's High School" → "st-xaviers-high-school"
    const baseSlug = normalizeSlug(name);
    if (!baseSlug) {
      return NextResponse.json(
        { success: false, error: 'Could not generate a valid slug from the school name.' },
        { status: 400 },
      );
    }

    // ── Step 1: Atomic DB provisioning via provision_school() RPC ──────────
    // The RPC creates the schools row + school_subscriptions row +
    // school_invite_codes row in a single transaction, writes both `slug` and
    // the legacy `code` columns, and returns the generated invite_code.
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('provision_school', {
      p_name: name,
      p_slug: baseSlug,
      p_board: body.board ?? 'CBSE',
      p_city: body.city ?? null,
      p_state: body.state ?? null,
      p_plan: plan,
      p_seats: seats,
      p_price_per_seat_monthly: pricePerSeat,
      p_billing_email: body.billing_email ?? null,
      p_tenant_type: body.tenant_type ?? 'school',
    });

    if (rpcError || !rpcData) {
      logger.error('school_provision_rpc_failed', {
        reason: rpcError?.message ?? 'no data returned',
        slug: baseSlug,
      });
      return NextResponse.json(
        {
          success: false,
          error: rpcError?.message ?? 'Failed to provision school.',
        },
        { status: 500 },
      );
    }

    const rpc = rpcData as ProvisionSchoolRpcResult;
    const { school_id: schoolId, slug, invite_code: inviteCode, subdomain } = rpc;

    // ── Step 2: Admin invite (non-fatal on failure — P15 principle) ─────────
    // The school row is already atomically committed. If admin-invite steps fail,
    // we return school_id + invite_code with a warn flag so the operator can use
    // the "send invite manually" path rather than receiving a misleading 500.
    let adminInviteSent = false;
    let warnFlag: string | undefined;

    if (body.admin_email && typeof body.admin_email === 'string' && body.admin_email.trim()) {
      try {
        const adminResult = await establishPrincipalAdmin(
          supabaseAdmin,
          schoolId,
          body.admin_email.trim().toLowerCase(),
          body.admin_name?.trim() ?? null,
          // invitedBy: the super-admin's own user id if available (P13: no email logged)
          auth.userId ?? null,
        );

        if (adminResult.linked) {
          adminInviteSent = true;
        } else {
          warnFlag = 'admin_invite_failed';
          logger.warn('school_provision_admin_invite_failed', {
            schoolId,
            slug,
            // P13: do not log admin_email
            linked: adminResult.linked,
          });
        }
      } catch (inviteErr) {
        warnFlag = 'admin_invite_failed';
        logger.warn('school_provision_admin_invite_error', {
          schoolId,
          slug,
          reason: inviteErr instanceof Error ? inviteErr.message : String(inviteErr),
        });
      }
    }

    // ── Step 3: Audit trail (P13 — no PII in details) ────────────────────
    await logAdminAudit(
      auth,
      'school.provisioned',
      'school',
      schoolId,
      {
        plan,
        seats,
        price_per_seat: pricePerSeat,
        slug,
        admin_invite_sent: adminInviteSent,
        has_admin_email: !!(body.admin_email),
        ...(warnFlag ? { warn: warnFlag } : {}),
      },
      request.headers.get('x-forwarded-for') || undefined,
    );

    // ── Response (P13 — no auth_user_id, no email) ───────────────────────
    const responseBody: {
      success: true;
      data: {
        school_id: string;
        slug: string;
        subdomain: string;
        invite_code: string;
        admin_invite_sent: boolean;
        warn?: string;
      };
    } = {
      success: true,
      data: {
        school_id: schoolId,
        slug,
        subdomain,
        invite_code: inviteCode,
        admin_invite_sent: adminInviteSent,
        ...(warnFlag ? { warn: warnFlag } : {}),
      },
    };

    return NextResponse.json(responseBody, { status: 201 });
  } catch (err) {
    logger.error('school_provision_route_unexpected_error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
