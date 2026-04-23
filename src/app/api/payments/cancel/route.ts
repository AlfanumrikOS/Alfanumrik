import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { paymentCancelSchema, validateBody } from '@/lib/validation';
import {
  cancelSubscription,
  createBillingAdminClient,
  getAuthedUserFromRequest,
  getBillingEnv,
  resolveStudentIdForUser,
} from '@/lib/domains/billing';

/**
 * Cancel Subscription Endpoint
 *
 * Cancels auto-renew. Access continues until current period ends.
 * Optionally allows immediate cancellation.
 */
export async function POST(request: NextRequest) {
  try {
    const envRes = getBillingEnv();
    if (!envRes.ok) {
      return NextResponse.json({ error: 'Not configured' }, { status: 503 });
    }

    const userRes = await getAuthedUserFromRequest(request, envRes.data);
    if (!userRes.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.json();
    const validation = validateBody(paymentCancelSchema, rawBody);
    if (!validation.success) return validation.error;
    const { immediate = false, reason = null } = validation.data;

    const admin = createBillingAdminClient(envRes.data);

    const studentIdRes = await resolveStudentIdForUser(admin, userRes.data);
    if (!studentIdRes.ok) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    const result = await cancelSubscription(admin, studentIdRes.data, { immediate, reason });
    if (!result.ok) {
      const status = result.code === 'INVALID_INPUT' ? 400 : 500;
      return NextResponse.json({ success: false, error: result.error }, { status });
    }

    return NextResponse.json({ success: true, ...result.data });
  } catch (err) {
    logger.error('Cancel error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Cancellation failed' }, { status: 500 });
  }
}
