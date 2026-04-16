import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '@/lib/admin-auth';
import crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────

interface ProvisionBody {
  name: string;
  board?: string;
  city?: string;
  state?: string;
  principal_name?: string;
  email?: string;
  plan?: string;
  seats?: number;
  price_per_seat?: number;
  admin_email?: string;
  admin_name?: string;
}

// ─── Helpers ────────────────────────────────────────────────────

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+$/g, '')
    .replace(/^-+/g, '');
}

function generateInviteCode(): string {
  // 8-character alphanumeric invite code
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function ensureUniqueSlug(slug: string): Promise<string> {
  // Check if slug already exists
  const checkRes = await fetch(
    supabaseAdminUrl('schools', `select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`),
    { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
  );
  if (!checkRes.ok) return slug;

  const existing = await checkRes.json();
  if (!Array.isArray(existing) || existing.length === 0) return slug;

  // Append incrementing number to make unique
  for (let i = 2; i <= 100; i++) {
    const candidate = `${slug}-${i}`;
    const res = await fetch(
      supabaseAdminUrl('schools', `select=id&slug=eq.${encodeURIComponent(candidate)}&limit=1`),
      { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
    );
    if (!res.ok) return candidate;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return candidate;
  }

  // Fallback: append random suffix
  return `${slug}-${crypto.randomBytes(2).toString('hex')}`;
}

// ─── Route ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body: ProvisionBody = await request.json();

    // Validate required fields
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'School name is required.' },
        { status: 400 },
      );
    }

    const name = body.name.trim();
    const plan = body.plan || 'trial';
    const seats = Math.max(1, Math.min(10000, body.seats || 50));
    const pricePerSeat = Math.max(0, body.price_per_seat || 0);

    // 1. Generate unique slug
    const baseSlug = generateSlug(name);
    if (!baseSlug) {
      return NextResponse.json(
        { success: false, error: 'Could not generate a valid slug from school name.' },
        { status: 400 },
      );
    }
    const slug = await ensureUniqueSlug(baseSlug);

    // 2. Create school record
    const schoolPayload: Record<string, unknown> = {
      name,
      slug,
      board: body.board || 'CBSE',
      is_active: true,
    };
    if (body.city) schoolPayload.city = body.city;
    if (body.state) schoolPayload.state = body.state;
    if (body.principal_name) schoolPayload.principal_name = body.principal_name;
    if (body.email) schoolPayload.billing_email = body.email;

    const schoolRes = await fetch(supabaseAdminUrl('schools'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(schoolPayload),
    });

    if (!schoolRes.ok) {
      const text = await schoolRes.text();
      return NextResponse.json(
        { success: false, error: `Failed to create school: ${text}` },
        { status: schoolRes.status },
      );
    }

    const schoolData = await schoolRes.json();
    const school = Array.isArray(schoolData) ? schoolData[0] : schoolData;
    const schoolId: string = school.id;

    // 3. Create school subscription
    const subPayload = {
      school_id: schoolId,
      plan,
      billing_cycle: 'monthly',
      seats_purchased: seats,
      price_per_seat_monthly: pricePerSeat,
      status: plan === 'trial' ? 'trial' : 'active',
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const subRes = await fetch(supabaseAdminUrl('school_subscriptions'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(subPayload),
    });

    let subscriptionId: string | null = null;
    if (subRes.ok) {
      const subData = await subRes.json();
      const sub = Array.isArray(subData) ? subData[0] : subData;
      subscriptionId = sub?.id || null;
    }

    // 4. Create invite code for school admin
    const inviteCode = generateInviteCode();
    const invitePayload = {
      school_id: schoolId,
      code: inviteCode,
      role: 'teacher', // School admin is a teacher-role user with institution_admin permissions
      max_uses: 1,
      uses_count: 0,
      is_active: true,
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    };

    await fetch(supabaseAdminUrl('school_invite_codes'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=minimal'),
      body: JSON.stringify(invitePayload),
    });

    // 5. Audit trail (no PII in details per P13)
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
        has_admin_invite: !!(body.admin_email),
      },
      request.headers.get('x-forwarded-for') || undefined,
    );

    // 6. Build subdomain (informational only at this point)
    const subdomain = `${slug}.alfanumrik.com`;

    return NextResponse.json({
      success: true,
      data: {
        school_id: schoolId,
        slug,
        subdomain,
        invite_code: inviteCode,
        subscription_id: subscriptionId,
      },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
