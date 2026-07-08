/**
 * GET /api/learner/scheduled — read from the scheduled_actions projection.
 *
 * Phase 3c of ADR-001. Returns the rank=0 slot (and future rank>0 slots
 * when those land) for a horizon — daily | weekly | monthly — anchored
 * to the IST bucket containing `now`.
 *
 * This endpoint is the READ counterpart to the write-through in
 * /api/learner/next. Both share scheduled-actions.ts bucket helpers so
 * the date math is identical on both sides.
 *
 * Gating: ff_scheduled_actions_v1 (same flag as the write-through).
 * When OFF, returns 404. When ON but no row exists yet for today's
 * bucket, also returns 404 — the consumer falls back to whatever
 * legacy path it had. Phase 3c is substrate-only; the UI does NOT
 * read from this endpoint yet (TodayLoopCard still consumes
 * /api/learner/next directly). A future PR can switch the consumer.
 *
 * Query params:
 *   horizon: 'daily' | 'weekly' | 'monthly'   (default: 'daily')
 *
 * Response (200):
 *   { schemaVersion: 1,
 *     horizon: 'daily',
 *     dayBucket: 'YYYY-MM-DD',
 *     slots: Array<{
 *       rank: number,
 *       actionKind: string,
 *       action: LearnerAction,        // full payload restored from jsonb
 *       source: 'scheduler' | 'manual_pin' | 'teacher_override',
 *       generatedAt: ISO,
 *       expiresAt: ISO,
 *       completedAt: ISO | null,
 *     }>
 *   }
 *
 * Errors:
 *   401 unauthenticated
 *   404 flag off / no profile / no slots for this bucket
 *   500 unexpected DB failure
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import {
  bucketForHorizon,
  type Horizon,
} from '@alfanumrik/lib/state/learner-loop/scheduled-actions';
import type { LearnerAction } from '@alfanumrik/lib/state/learner-loop/types';
import { logger } from '@alfanumrik/lib/logger';
import { cacheFetchAsync, CACHE_TTL } from '@alfanumrik/lib/cache';

export const dynamic = 'force-dynamic';

const FLAG_NAME = 'ff_scheduled_actions_v1';
const VALID_HORIZONS: Horizon[] = ['daily', 'weekly', 'monthly'];

interface ScheduledRow {
  rank: number;
  action_kind: string;
  action_payload: unknown;
  source: 'scheduler' | 'manual_pin' | 'teacher_override';
  generated_at: string;
  expires_at: string;
  completed_at: string | null;
}

export interface ScheduledSlotEnvelope {
  rank: number;
  actionKind: string;
  action: LearnerAction;
  source: ScheduledRow['source'];
  generatedAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export interface ScheduledResponse {
  schemaVersion: 1;
  horizon: Horizon;
  dayBucket: string;
  slots: ScheduledSlotEnvelope[];
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // Flag gate. Mirrors the rhythm/today + learner/next pattern — 404
  // when off so consumers fall through to legacy behaviour without
  // branching on the flag themselves.
  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId, role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Parse + validate horizon param.
  const url = new URL(request.url);
  const rawHorizon = (url.searchParams.get('horizon') ?? 'daily').toLowerCase();
  if (!VALID_HORIZONS.includes(rawHorizon as Horizon)) {
    return NextResponse.json(
      { error: 'invalid_horizon', detail: `must be one of: ${VALID_HORIZONS.join(', ')}` },
      { status: 400 },
    );
  }
  const horizon = rawHorizon as Horizon;

  // Resolve student_id from the caller's auth.
  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('id')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (studentErr) {
    logger.warn('learner/scheduled: students lookup failed', {
      userId, error: studentErr.message,
    });
    return NextResponse.json({ error: 'student_lookup_failed' }, { status: 500 });
  }
  const studentId = (studentRow as { id: string } | null)?.id;
  if (!studentId) {
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }

  const now = new Date();
  const dayBucket = bucketForHorizon(horizon, now);

  // Phase 5 perf: this read-only projection fires on dashboard mount. Collapse
  // repeat reads within a 30s window with a SERVER-SIDE cache keyed by
  // studentId + horizon + dayBucket (both params change the response, so both
  // belong in the key). The key includes studentId so students NEVER collide
  // (P13: per-student data must never be shared). This is a server cache, NOT a
  // CDN/`s-maxage` header — Vercel's edge does not vary by auth, so a public
  // cache would leak one student's scheduled slots to another. The empty→404
  // path stays OUTSIDE the cache so a brief "no slots yet" right after the
  // /api/learner/next write-through is never pinned.
  let rowsRaw: ScheduledRow[] | null;
  try {
    rowsRaw = await cacheFetchAsync(
      `learner:scheduled:${studentId}:${horizon}:${dayBucket}`,
      CACHE_TTL.USER,
      async () => {
        // Read slots ordered by rank ASC. Overrides surface ahead of scheduler
        // rows when multiple sources exist at the same rank — though the
        // UNIQUE constraint prevents that today. Order here is a future-proof.
        const { data, error } = await supabase
          .from('scheduled_actions')
          .select('rank, action_kind, action_payload, source, generated_at, expires_at, completed_at')
          .eq('student_id', studentId)
          .eq('horizon', horizon)
          .eq('day_bucket', dayBucket)
          .order('rank', { ascending: true });
        if (error) throw new Error(error.message); // do NOT cache failures
        const fetched = (data ?? []) as ScheduledRow[];
        // Don't cache the empty result — a slot may be written moments later by
        // the /api/learner/next write-through; return null to skip caching.
        return fetched.length === 0 ? null : fetched;
      },
    );
  } catch (readErr) {
    logger.warn('learner/scheduled: scheduled_actions read failed', {
      userId, studentId, error: (readErr as Error).message,
    });
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
  const rows = (rowsRaw ?? []) as ScheduledRow[];
  if (rows.length === 0) {
    // No slot written yet for this bucket — consumer falls back to
    // /api/learner/next (which writes the first slot when flag is on).
    return NextResponse.json({ error: 'no_slots' }, { status: 404 });
  }

  const slots: ScheduledSlotEnvelope[] = rows.map(r => ({
    rank: r.rank,
    actionKind: r.action_kind,
    action: r.action_payload as LearnerAction,
    source: r.source,
    generatedAt: r.generated_at,
    expiresAt: r.expires_at,
    completedAt: r.completed_at,
  }));

  const response: ScheduledResponse = {
    schemaVersion: 1,
    horizon,
    dayBucket,
    slots,
  };

  return NextResponse.json(response, {
    headers: {
      // Same short cache as /api/learner/next. The slot is durable but
      // can be updated by the resolver throughout the day.
      'Cache-Control': 'private, max-age=30, must-revalidate',
    },
  });
}
