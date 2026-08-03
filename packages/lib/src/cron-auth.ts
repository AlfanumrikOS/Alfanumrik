/**
 * cron-auth — the single CRON_SECRET gate for every Vercel-scheduled /
 * ops-invoked cron route (`/api/cron/*`, `/api/internal/cron/*`).
 *
 * Replaces ~14 hand-copied per-route `verifyCronSecret()` / `isAuthorized()`
 * implementations (P1-3 consolidation, 2026-08-03). Behavior contract:
 *
 *  - FAIL CLOSED: if the `CRON_SECRET` env var is unset, every request is
 *    rejected (`reason: 'missing_secret'`). A route may map this reason to
 *    503 (see api/internal/cron/fix-failed-questions) — the default is 401.
 *  - Accepted carriers, FIRST-PRESENT-WINS (pinned by the adaptive-remediation /
 *    flag-posture-canary / adaptive-loops-monitor test families): exactly ONE
 *    candidate is selected and compared once —
 *      1. `Authorization: Bearer <secret>` — Vercel Cron sends this
 *         automatically when the CRON_SECRET env var is set on the project.
 *      2. `x-cron-secret: <secret>` — the Supabase daily-cron Edge Function
 *         fan-out and scripts/run-production-crons.mjs send this.
 *    A WRONG value in a higher-precedence carrier is NOT rescued by a correct
 *    lower one.
 *  - NO query-param carrier. `?token=` was removed 2026-08-03: query strings
 *    land in access/CDN logs, so a secret there is a secret leaked.
 *  - Constant-time comparison via node:crypto timingSafeEqual with an explicit
 *    length guard (timingSafeEqual throws on length mismatch; unequal length
 *    is an ordinary reject). All cron routes declare `runtime = 'nodejs'`, so
 *    node:crypto is always available here.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export interface CronAuthResult {
  ok: boolean;
  /**
   * Present when `ok` is false:
   *  - 'missing_secret'      — CRON_SECRET env var unset (fail closed / misconfig)
   *  - 'missing_credentials' — no accepted carrier on the request
   *  - 'invalid_credentials' — a carrier was presented but did not match
   */
  reason?: 'missing_secret' | 'missing_credentials' | 'invalid_credentials';
}

function constantTimeMatch(provided: string, secret: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a cron request against CRON_SECRET. Pure header+env check — performs
 * no I/O, so it is safe (and required) to call BEFORE any DB access
 * (REG-127 fail-closed posture).
 *
 * Accepts a plain `Request`; `NextRequest` extends it, so route handlers can
 * pass their request straight through.
 */
export function verifyCronAuth(request: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, reason: 'missing_secret' }; // fail closed

  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  const headerSecret = request.headers.get('x-cron-secret') ?? '';

  // FIRST-PRESENT-WINS: Bearer, else x-cron-secret. Exactly one compare.
  const provided = bearer || headerSecret;
  if (!provided) return { ok: false, reason: 'missing_credentials' };

  return constantTimeMatch(provided, secret)
    ? { ok: true }
    : { ok: false, reason: 'invalid_credentials' };
}

/**
 * The house 401 for cron routes — `{ success: false, error: 'Unauthorized' }`.
 * Routes that predate this helper with a DIFFERENT pinned 401 body keep their
 * local literal; new cron routes should use this.
 */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Unauthorized' },
    { status: 401 },
  );
}
