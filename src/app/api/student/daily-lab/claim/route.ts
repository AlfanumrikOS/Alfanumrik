/**
 * POST /api/student/daily-lab/claim
 *
 * Awards a +50 coin bonus when the student completes today's Daily Lab Mission.
 *
 * Body: { observation_id: string }
 *
 * Flow:
 *   1. Authn/authz via authorizeRequest (stem.observe).
 *   2. Verify the observation belongs to this student and was created today
 *      (Asia/Kolkata) — otherwise the claim is silently rejected.
 *   3. Recompute today's daily-lab pick (deterministic) and confirm the
 *      observation's simulation_id matches.
 *   4. Idempotency: scan today's coin_transactions for a row with
 *      source='daily_challenge' and metadata.context='daily_lab'. If one
 *      already exists for this student, return claimed=false (already paid).
 *   5. Award +50 via award_coins(p_student_id, 50, 'daily_challenge', meta).
 *
 * Response: { success: true, data: { claimed: boolean, coins: number, balance: number } }
 *
 * P11 doesn't apply (no payment), but the same atomicity discipline does:
 * award_coins() updates coin_balances + coin_transactions in a single
 * SECURITY DEFINER function.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { BUILT_IN_SIMULATIONS_META } from '@/components/simulations/metadata';
import { GUIDED_EXPERIMENTS } from '@/components/stem/experiments';
import { DAILY_LAB_BONUS_COINS } from '../route';

interface DbSimRow {
  id: string;
  title: string;
  subject_code: string | null;
  thumbnail_emoji: string | null;
  estimated_time_minutes: number | null;
}

interface PoolEntry {
  simulation_id: string;
  subject: string;
}

function ymdInKolkata(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}
function ymdOffset(d: Date, dayOffset: number): string {
  return ymdInKolkata(new Date(d.getTime() + dayOffset * 86_400_000));
}
function hashKey(studentId: string, ymd: string): number {
  const s = `${studentId}-${ymd}`;
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
function pickFromPool(
  pool: PoolEntry[],
  studentId: string,
  ymd: string,
  recentSubjects: string[],
): PoolEntry | null {
  if (pool.length === 0) return null;
  const startIndex = hashKey(studentId, ymd) % pool.length;
  const allSame =
    recentSubjects.length === 3 &&
    recentSubjects[0] === recentSubjects[1] &&
    recentSubjects[1] === recentSubjects[2];
  const blocked = allSame ? recentSubjects[0] : null;
  for (let step = 0; step < pool.length; step++) {
    const idx = (startIndex + step) % pool.length;
    if (blocked && pool[idx].subject === blocked) continue;
    return pool[idx];
  }
  return pool[startIndex];
}

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'stem.observe', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  const studentId = auth.studentId!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const observationId = body.observation_id;
  if (typeof observationId !== 'string' || !observationId) {
    return err('observation_id required', 400);
  }

  // 1. Resolve the observation (must belong to this student).
  const { data: obs, error: obsErr } = await supabaseAdmin
    .from('experiment_observations')
    .select('id,student_id,simulation_id,created_at')
    .eq('id', observationId)
    .maybeSingle();

  if (obsErr || !obs) return err('Observation not found', 404);
  if (obs.student_id !== studentId) {
    // Don't leak existence — return 404 not 403.
    return err('Observation not found', 404);
  }

  const ymdToday = ymdInKolkata(new Date());
  const obsYmd = ymdInKolkata(new Date(obs.created_at));
  if (obsYmd !== ymdToday) {
    return NextResponse.json(
      { success: true, data: { claimed: false, coins: 0, reason: 'observation_not_from_today' } },
      { status: 200 },
    );
  }

  // 2. Resolve grade and rebuild today's pick deterministically.
  const { data: studentRow } = await supabaseAdmin
    .from('students')
    .select('grade')
    .eq('id', studentId)
    .maybeSingle();
  if (!studentRow?.grade) return err('Student profile incomplete', 400);
  const grade = String(studentRow.grade);

  const { data: dbSimsRaw } = await supabaseAdmin
    .from('interactive_simulations')
    .select('id,title,subject_code,thumbnail_emoji,estimated_time_minutes')
    .eq('is_active', true)
    .eq('grade', grade)
    .neq('widget_code', 'PLACEHOLDER')
    .neq('quality_status', 'rejected')
    .limit(500);
  const dbSims: DbSimRow[] = (dbSimsRaw as DbSimRow[] | null) ?? [];

  const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: recentObs } = await supabaseAdmin
    .from('experiment_observations')
    .select('simulation_id')
    .eq('student_id', studentId)
    .gte('created_at', since14);
  const completedRecently = new Set<string>(
    ((recentObs as { simulation_id: string }[] | null) ?? []).map((r) => r.simulation_id),
  );

  const builtinPool: PoolEntry[] = BUILT_IN_SIMULATIONS_META
    .filter((s) => s.grade.includes(grade))
    .map((s) => {
      const guided = GUIDED_EXPERIMENTS.find(
        (e) => e.simulationId === s.id && e.grades.includes(grade),
      );
      return { simulation_id: s.id, subject: guided?.subject ?? s.subject };
    });
  const dbPool: PoolEntry[] = dbSims.map((row) => ({
    simulation_id: row.id,
    subject: row.subject_code ?? 'science',
  }));
  const fullPool = [...builtinPool, ...dbPool].sort((a, b) =>
    a.simulation_id.localeCompare(b.simulation_id),
  );
  // Important: when checking the claim, exclude the just-completed sim from
  // the "recent" set so the deterministic pick still resolves to it.
  const filteredPool = fullPool.filter(
    (p) => p.simulation_id === obs.simulation_id || !completedRecently.has(p.simulation_id),
  );
  const pool = filteredPool.length > 0 ? filteredPool : fullPool;

  const now = new Date();
  const recentSubjects: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const prev = pickFromPool(pool, studentId, ymdOffset(now, -i), []);
    if (prev) recentSubjects.push(prev.subject);
  }
  const todayPick = pickFromPool(pool, studentId, ymdToday, recentSubjects);

  if (!todayPick || todayPick.simulation_id !== obs.simulation_id) {
    return NextResponse.json(
      { success: true, data: { claimed: false, coins: 0, reason: 'not_todays_pick' } },
      { status: 200 },
    );
  }

  // 3. Idempotency — has the student already claimed today?
  const startOfTodayUtc = new Date(Date.now() - 86_400_000).toISOString();
  const { data: priorClaims } = await supabaseAdmin
    .from('coin_transactions')
    .select('id,metadata,created_at')
    .eq('student_id', studentId)
    .eq('source', 'daily_challenge')
    .gte('created_at', startOfTodayUtc)
    .limit(50);

  const alreadyClaimed = ((priorClaims as { metadata: Record<string, unknown> | null; created_at: string }[] | null) ?? [])
    .some((row) => {
      if (ymdInKolkata(new Date(row.created_at)) !== ymdToday) return false;
      const ctx = row.metadata && typeof row.metadata === 'object' ? row.metadata.context : null;
      return ctx === 'daily_lab';
    });

  if (alreadyClaimed) {
    const { data: bal } = await supabaseAdmin
      .from('coin_balances')
      .select('balance')
      .eq('student_id', studentId)
      .maybeSingle();
    return NextResponse.json({
      success: true,
      data: {
        claimed: false,
        coins: 0,
        balance: (bal as { balance: number } | null)?.balance ?? 0,
        reason: 'already_claimed_today',
      },
    });
  }

  // 4. Award the bonus via the SECURITY DEFINER RPC (atomic with balance update).
  const { data: newBalance, error: awardErr } = await supabaseAdmin.rpc('award_coins', {
    p_student_id: studentId,
    p_amount: DAILY_LAB_BONUS_COINS,
    p_source: 'daily_challenge',
    p_metadata: {
      context: 'daily_lab',
      simulation_id: obs.simulation_id,
      observation_id: obs.id,
      ymd: ymdToday,
    },
  });

  if (awardErr) {
    logger.error('daily_lab_claim_failed', {
      error: new Error(awardErr.message),
      studentId,
      simulationId: obs.simulation_id,
    });
    return err('Failed to award bonus', 500);
  }

  logger.info('daily_lab_bonus_awarded', {
    studentId,
    simulationId: obs.simulation_id,
    coins: DAILY_LAB_BONUS_COINS,
  });

  return NextResponse.json({
    success: true,
    data: {
      claimed: true,
      coins: DAILY_LAB_BONUS_COINS,
      balance: typeof newBalance === 'number' ? newBalance : 0,
    },
  });
}
