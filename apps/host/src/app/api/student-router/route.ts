import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';

/**
 * GET /api/student-router?target=dashboard
 *
 * Gated deep-link router for student session continuity. Accepts a target
 * route name and issues a redirect. Any authenticated student role can
 * access; admin/super_admin bypass via RBAC wildcard.
*/

export const runtime = 'nodejs';

const ALLOWED_TARGETS = [
  'dashboard',
  'learn',
  'quiz',
  'quiz/history',
  'progress',
  'leaderboard',
  'exams',
  'simulations',
  'dive',
  'dive/history',
  'synthesis',
  'foxy',
  'settings',
  'parent',
];

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'student.router_access');
  if (!auth.authorized) {
    return auth.errorResponse!;
  }

  const target = request.nextUrl.searchParams.get('target');
  if (!target) {
    return NextResponse.json({ error: 'Missing target parameter' }, { status: 400 });
  }

  if (!ALLOWED_TARGETS.includes(target)) {
    logger.warn('student-router: unknown target requested', { target, studentId: auth.studentId });
    return NextResponse.json(
      { error: `Unknown target: ${target}. Allowed: ${ALLOWED_TARGETS.join(', ')}` },
      { status: 400 }
    );
  }

  const origin = request.nextUrl.origin;
  const redirectUrl = new URL(target, origin);

  logger.info('student-router: redirect issued', { target, studentId: auth.studentId, redirectUrl: redirectUrl.toString() });

  return NextResponse.redirect(redirectUrl);
}
