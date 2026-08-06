/**
 * GET /api/health — liveness probe.
 *
 * Public — no auth required. Returns 200 immediately with no downstream calls
 * per the standardized health model (liveness = process can answer). External
 * monitors (uptime, load balancers) use this endpoint.
 *
 * For readiness (DB + Redis + Razorpay dependency probes), use /api/v1/health.
 *
 * Response: 200  { status: 'ok', timestamp: string }
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
}
