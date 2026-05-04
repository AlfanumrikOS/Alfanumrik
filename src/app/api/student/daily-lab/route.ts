/**
 * GET /api/student/daily-lab
 *
 * Returns the student's "Daily Lab Mission" — a single grade-appropriate
 * simulation chosen deterministically from the union of:
 *   (a) BUILT_IN_SIMULATIONS_META filtered by student grade, and
 *   (b) interactive_simulations rows where grade matches and is_active.
 *
 * Selection rules (Tier 2 R8):
 *   1. Determinism: same student + same calendar day (Asia/Kolkata) → same pick.
 *      Achieved by hashing (studentId, YYYY-MM-DD) into the pool index.
 *   2. Skip-recent: exclude any sim the student has completed in the last
 *      14 days (LEFT JOIN against experiment_observations).
 *   3. Subject diversity: if the deterministic picks for the previous 3 days
 *      were all the same subject, advance through the sorted pool until a
 *      different subject is found.
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       simulation_id, experiment_id | null, title, title_hi, subject,
 *       estimated_minutes, bonus_coins, deeplink, completed_today
 *     }
 *   }
 *
 * P5: grade is string. P9: authorizeRequest gate. P13: only counts logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { BUILT_IN_SIMULATIONS_META, type BuiltInSimulationMeta } from '@/components/simulations/metadata';
import { GUIDED_EXPERIMENTS } from '@/components/stem/experiments';

/** +50 coin bonus for completing the daily lab. Whitelisted source: daily_challenge. */
export const DAILY_LAB_BONUS_COINS = 50;

interface PoolEntry {
  simulation_id: string;
  experiment_id: string | null;
  title: string;
  title_hi: string;
  subject: string;
  estimated_minutes: number;
  emoji: string;
  source: 'builtin' | 'db';
}

interface DbSimRow {
  id: string;
  title: string;
  subject_code: string | null;
  thumbnail_emoji: string | null;
  estimated_time_minutes: number | null;
}

/* ─── Date helpers (Asia/Kolkata = UTC+5:30, no DST) ─── */

/**
 * Returns a YYYY-MM-DD string for the calendar day in Asia/Kolkata.
 * IST is a fixed UTC+5:30 offset (no DST), so we shift the UTC instant by
 * +330 minutes and slice the ISO date. Avoids any locale dependency.
 */
function ymdInKolkata(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function ymdOffset(d: Date, dayOffset: number): string {
  return ymdInKolkata(new Date(d.getTime() + dayOffset * 86_400_000));
}

/**
 * Stable, deterministic 32-bit hash of `${studentId}-${ymd}`.
 * djb2 variant — no crypto dependency, sufficient entropy for picking
 * an index in a pool of <500 simulations.
 */
function hashKey(studentId: string, ymd: string): number {
  const s = `${studentId}-${ymd}`;
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/**
 * Pick a pool entry deterministically. If the natural index lands on a
 * subject that matches the last-3-days history, walk forward through the
 * (sorted) pool until we hit a different subject. Returns the chosen entry
 * and its index within the pool.
 */
function pickFromPool(
  pool: PoolEntry[],
  studentId: string,
  ymd: string,
  recentSubjects: string[],
): PoolEntry | null {
  if (pool.length === 0) return null;
  const startIndex = hashKey(studentId, ymd) % pool.length;
  // Diversity guard only triggers when last 3 picks share a subject.
  const allSameSubject =
    recentSubjects.length === 3 &&
    recentSubjects[0] === recentSubjects[1] &&
    recentSubjects[1] === recentSubjects[2];
  const blocked = allSameSubject ? recentSubjects[0] : null;

  for (let step = 0; step < pool.length; step++) {
    const idx = (startIndex + step) % pool.length;
    const candidate = pool[idx];
    if (blocked && candidate.subject === blocked) continue;
    return candidate;
  }
  // Fallback: every sim in the pool matches the blocked subject — return the
  // deterministic pick anyway. Better to repeat than to return null.
  return pool[startIndex];
}

/** Build the candidate pool for a given grade (sorted by simulation_id for stability). */
function buildPool(grade: string, dbSims: DbSimRow[]): PoolEntry[] {
  const builtins: PoolEntry[] = BUILT_IN_SIMULATIONS_META
    .filter((s: BuiltInSimulationMeta) => s.grade.includes(grade))
    .map((s) => {
      const guided = GUIDED_EXPERIMENTS.find(
        (e) => e.simulationId === s.id && e.grades.includes(grade),
      );
      return {
        simulation_id: s.id,
        experiment_id: guided?.id ?? null,
        title: guided?.title ?? s.title,
        title_hi: guided?.titleHi ?? s.title,
        subject: guided?.subject ?? s.subject,
        estimated_minutes: guided?.estimatedMinutes ?? s.estimatedTimeMinutes,
        emoji: s.thumbnailEmoji,
        source: 'builtin' as const,
      };
    });

  const dbEntries: PoolEntry[] = dbSims.map((row) => ({
    simulation_id: row.id,
    experiment_id: null,
    title: row.title,
    title_hi: row.title, // DB sims don't carry a Hindi title; UI falls back to English.
    subject: row.subject_code ?? 'science',
    estimated_minutes: row.estimated_time_minutes ?? 10,
    emoji: row.thumbnail_emoji ?? '🧪',
    source: 'db' as const,
  }));

  // Sort by simulation_id so the deterministic index is stable across deploys
  // even if the source arrays are reordered.
  return [...builtins, ...dbEntries].sort((a, b) =>
    a.simulation_id.localeCompare(b.simulation_id),
  );
}

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'stem.observe', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  const studentId = auth.studentId!;

  // 1. Resolve student grade (P5: TEXT '6'..'12').
  const { data: studentRow, error: studentErr } = await supabaseAdmin
    .from('students')
    .select('grade')
    .eq('id', studentId)
    .maybeSingle();

  if (studentErr || !studentRow?.grade) {
    return err('Student profile incomplete', 400);
  }
  const grade = String(studentRow.grade);

  // 2. Pull DB simulations for this grade.
  const { data: dbSimsRaw } = await supabaseAdmin
    .from('interactive_simulations')
    .select('id,title,subject_code,thumbnail_emoji,estimated_time_minutes')
    .eq('is_active', true)
    .eq('grade', grade)
    .neq('widget_code', 'PLACEHOLDER')
    .neq('quality_status', 'rejected')
    .limit(500);

  const dbSims: DbSimRow[] = (dbSimsRaw as DbSimRow[] | null) ?? [];

  // 3. Pull recent completions (last 14 days) and today's completion flag.
  const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: recentObs } = await supabaseAdmin
    .from('experiment_observations')
    .select('simulation_id,created_at')
    .eq('student_id', studentId)
    .gte('created_at', since14);

  const completedRecently = new Set<string>(
    ((recentObs as { simulation_id: string }[] | null) ?? []).map((r) => r.simulation_id),
  );

  // 4. Build pool, exclude recently-completed.
  const fullPool = buildPool(grade, dbSims);
  const filteredPool = fullPool.filter((p) => !completedRecently.has(p.simulation_id));

  // If every lab in the grade has been completed in the last 14d, fall back
  // to the full pool (better to repeat than to send nothing).
  const pool = filteredPool.length > 0 ? filteredPool : fullPool;

  if (pool.length === 0) {
    return err('No simulations available for this grade', 404);
  }

  // 5. Compute today's pick + subject-diversity history.
  const now = new Date();
  const ymdToday = ymdInKolkata(now);
  const recentSubjects: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const prevYmd = ymdOffset(now, -i);
    // Past picks were drawn from the same pool-derivation algorithm. We use
    // the *current* pool snapshot — a small drift is acceptable: the diversity
    // guard exists to break monotonous runs, not to reconstruct exact history.
    const prev = pickFromPool(pool, studentId, prevYmd, []);
    if (prev) recentSubjects.push(prev.subject);
  }

  const todayPick = pickFromPool(pool, studentId, ymdToday, recentSubjects);
  if (!todayPick) {
    return err('No simulations available for this grade', 404);
  }

  // 6. Did the student already complete today's pick today (Asia/Kolkata)?
  const completedToday =
    ((recentObs as { simulation_id: string; created_at: string }[] | null) ?? [])
      .some((r) => r.simulation_id === todayPick.simulation_id && ymdInKolkata(new Date(r.created_at)) === ymdToday);

  // 7. P13: log only counts/IDs, never observation text.
  logger.info('daily_lab_pick', {
    studentId,
    grade,
    poolSize: pool.length,
    completedRecently: completedRecently.size,
    pickedSimulation: todayPick.simulation_id,
    subject: todayPick.subject,
    completedToday,
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        simulation_id: todayPick.simulation_id,
        experiment_id: todayPick.experiment_id,
        title: todayPick.title,
        title_hi: todayPick.title_hi,
        subject: todayPick.subject,
        emoji: todayPick.emoji,
        estimated_minutes: todayPick.estimated_minutes,
        bonus_coins: DAILY_LAB_BONUS_COINS,
        deeplink: `/stem-centre?lab=${encodeURIComponent(todayPick.simulation_id)}`,
        completed_today: completedToday,
      },
    },
    {
      headers: {
        // Cache per-user for 5 minutes; Asia/Kolkata day boundary changes are
        // rare relative to dashboard refresh cadence.
        'Cache-Control': 'private, max-age=300',
      },
    },
  );
}
