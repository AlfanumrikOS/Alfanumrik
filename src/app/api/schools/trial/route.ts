import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { checkApiRateLimit } from '@/lib/api-rate-limit';

/* ─── Slug Generation ─── */

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')   // strip non-alphanumeric except spaces and hyphens
    .replace(/\s+/g, '-')            // spaces to hyphens
    .replace(/-+/g, '-')             // collapse multiple hyphens
    .replace(/^-|-$/g, '');          // trim leading/trailing hyphens
}

/* ─── Invite Code Generation ─── */

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 to avoid confusion
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/* ─── Validation ─── */

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ─── POST Handler ─── */

export async function POST(request: NextRequest) {
  // Rate limit by IP
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const rateCheck = await checkApiRateLimit(`trial:${ip}`, 5, 60 * 60 * 1000);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many signup requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(0, rateCheck.resetAt - Math.ceil(Date.now() / 1000))),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 }
    );
  }

  const school_name = typeof body.school_name === 'string' ? body.school_name.trim() : '';
  const board = typeof body.board === 'string' ? body.board.trim() : 'CBSE';
  const city = typeof body.city === 'string' ? body.city.trim() : null;
  const state = typeof body.state === 'string' ? body.state.trim() : null;
  const principal_name = typeof body.principal_name === 'string' ? body.principal_name.trim() : '';
  const principal_email = typeof body.principal_email === 'string' ? body.principal_email.trim().toLowerCase() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : null;

  // Validate required fields
  if (!school_name) {
    return NextResponse.json(
      { success: false, error: 'School name is required.' },
      { status: 400 }
    );
  }
  if (!principal_name) {
    return NextResponse.json(
      { success: false, error: 'Principal name is required.' },
      { status: 400 }
    );
  }
  if (!principal_email || !validateEmail(principal_email)) {
    return NextResponse.json(
      { success: false, error: 'Valid email address is required.' },
      { status: 400 }
    );
  }
  if (school_name.length > 200 || principal_name.length > 100 || principal_email.length > 254) {
    return NextResponse.json(
      { success: false, error: 'Input exceeds maximum length.' },
      { status: 400 }
    );
  }

  try {
    const admin = getSupabaseAdmin();

    // 1. Generate unique slug for the school code
    let slug = generateSlug(school_name);
    if (!slug) {
      slug = 'school';
    }

    // Check slug uniqueness — append number if taken
    let finalSlug = slug;
    let slugAttempt = 0;
    const MAX_SLUG_ATTEMPTS = 10;

    while (slugAttempt < MAX_SLUG_ATTEMPTS) {
      const { data: existing } = await admin
        .from('schools')
        .select('id')
        .eq('code', finalSlug)
        .maybeSingle();

      if (!existing) break;

      slugAttempt++;
      finalSlug = `${slug}-${slugAttempt}`;
    }

    if (slugAttempt >= MAX_SLUG_ATTEMPTS) {
      // Very unlikely — append timestamp fragment
      finalSlug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    }

    // 2. Check if a school with this email already exists
    const { data: existingSchool } = await admin
      .from('schools')
      .select('id')
      .eq('contact_email', principal_email)
      .maybeSingle();

    if (existingSchool) {
      return NextResponse.json(
        { success: false, error: 'A school with this email already exists. Please log in or contact support.' },
        { status: 409 }
      );
    }

    // 3. Create school record
    const { data: school, error: schoolError } = await admin
      .from('schools')
      .insert({
        name: school_name,
        code: finalSlug,
        board: board,
        city: city,
        state: state,
        principal_name: principal_name,
        contact_email: principal_email,
        contact_phone: phone,
        school_type: 'private',
        is_active: true,
      })
      .select('id, code')
      .single();

    if (schoolError || !school) {
      logger.error('school_trial_create_school_failed', {
        error: schoolError ? new Error(schoolError.message) : new Error('No school returned'),
        slug: finalSlug,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to create school. Please try again.' },
        { status: 500 }
      );
    }

    // 4. Attempt to create school_subscriptions record (table may not exist yet)
    let subscriptionCreated = false;
    try {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 30);

      const { error: subError } = await admin
        .from('school_subscriptions')
        .insert({
          school_id: school.id,
          plan: 'trial',
          seats_purchased: 50,
          price_per_seat_monthly: 0,
          status: 'trial',
          current_period_end: trialEnd.toISOString(),
        });

      if (!subError) {
        subscriptionCreated = true;
      } else {
        // Table may not exist yet — log but don't fail
        logger.warn('school_trial_subscription_insert_skipped', {
          schoolId: school.id,
          reason: subError.message,
        });
      }
    } catch {
      // school_subscriptions table doesn't exist yet — acceptable
      logger.warn('school_trial_subscription_table_missing', {
        schoolId: school.id,
      });
    }

    // 5. Generate invite code for the school admin
    const inviteCode = generateInviteCode();
    let inviteStored = false;
    try {
      const inviteExpiry = new Date();
      inviteExpiry.setDate(inviteExpiry.getDate() + 90);

      const { error: inviteError } = await admin
        .from('school_invite_codes')
        .insert({
          school_id: school.id,
          code: inviteCode,
          role: 'teacher',
          max_uses: 1,
          use_count: 0,
          expires_at: inviteExpiry.toISOString(),
        });

      if (!inviteError) {
        inviteStored = true;
      } else {
        logger.warn('school_trial_invite_code_insert_skipped', {
          schoolId: school.id,
          reason: inviteError.message,
        });
      }
    } catch {
      // school_invite_codes table doesn't exist yet — acceptable
      logger.warn('school_trial_invite_code_table_missing', {
        schoolId: school.id,
      });
    }

    // Log successful trial creation (no PII — P13)
    logger.info('school_trial_created', {
      schoolId: school.id,
      slug: finalSlug,
      board,
      subscriptionCreated,
      inviteStored,
    });

    return NextResponse.json({
      success: true,
      data: {
        school_id: school.id,
        slug: finalSlug,
        subdomain: `${finalSlug}.alfanumrik.com`,
        invite_code: inviteStored ? inviteCode : undefined,
        trial_days: 30,
        seats: 50,
      },
    });
  } catch (err) {
    logger.error('school_trial_unexpected_error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
