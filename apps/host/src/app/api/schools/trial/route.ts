import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@alfanumrik/lib/logger';
import { checkApiRateLimit } from '@alfanumrik/lib/api-rate-limit';
import { pickLocaleFromAcceptLanguage } from '@alfanumrik/lib/email-delivery';
import { provisionTrialSchool } from '@alfanumrik/lib/school-provisioning';

/* ─── POST Handler ───
 * Thin HTTP wrapper around `provisionTrialSchool()` in
 * src/lib/school-provisioning.ts. Keeps the public contract that the existing
 * landing-page signup form + the schools-trial-email-delivery test suite both
 * depend on, while the underlying logic is shared with the super-admin bulk
 * onboard endpoint (`/api/super-admin/institutions/bulk-onboard`).
 */
export async function POST(request: NextRequest) {
  // Rate limit by IP — bulk onboard runs under super-admin auth and bypasses
  // this; the public trial endpoint still needs anti-abuse limits.
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

  const locale = pickLocaleFromAcceptLanguage(request.headers.get('accept-language'));

  const result = await provisionTrialSchool({
    school_name: typeof body.school_name === 'string' ? body.school_name : '',
    principal_name: typeof body.principal_name === 'string' ? body.principal_name : '',
    principal_email: typeof body.principal_email === 'string' ? body.principal_email : '',
    board: typeof body.board === 'string' ? body.board : null,
    city: typeof body.city === 'string' ? body.city : null,
    state: typeof body.state === 'string' ? body.state : null,
    phone: typeof body.phone === 'string' ? body.phone : null,
    sendEmail: true,
    locale,
  });

  if (result.status === 'validation_error') {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: 400 }
    );
  }
  if (result.status === 'already_exists') {
    return NextResponse.json(
      { success: false, error: 'A school with this email already exists. Please log in or contact support.' },
      { status: 409 }
    );
  }
  if (result.status === 'failed') {
    logger.error('school_trial_unexpected_error', {
      error: new Error(result.error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to create school. Please try again.' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      school_id: result.school_id,
      slug: result.slug,
      subdomain: result.subdomain,
      invite_code: result.invite_code,
      trial_days: result.trial_days,
      seats: result.seats,
    },
  });
}
