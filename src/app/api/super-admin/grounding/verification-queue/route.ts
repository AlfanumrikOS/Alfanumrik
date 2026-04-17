import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/grounding/verification-queue
 *
 * Surfaces the question_bank verification pipeline state for the super-admin
 * dashboard (Tasks 3.16/3.17). Ops inspect this to confirm the retroactive
 * verifier is draining the backlog and to triage recent failures.
 *
 * Response shape:
 *   {
 *     counts: { legacy_unverified, pending, verified, failed },
 *     byPair: [{ grade, subject, legacy_unverified, verified, failed, verified_ratio }, ...],
 *     failedSample: [...up to 20 failed rows for triage...],
 *     throughputLast24h: { verified_per_hour, failed_per_hour }
 *   }
 *
 * Auth: super_admin.access permission.
 */

export const runtime = 'nodejs';

type VerificationState = 'legacy_unverified' | 'pending' | 'verified' | 'failed';

async function countByState(state: VerificationState): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('question_bank')
    .select('id', { count: 'exact', head: true })
    .eq('verification_state', state)
    .is('deleted_at', null);
  if (error) return -1;
  return count ?? 0;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    // ── Total counts per state ───────────────────────────────────
    const [legacyUnverified, pending, verified, failed] = await Promise.all([
      countByState('legacy_unverified'),
      countByState('pending'),
      countByState('verified'),
      countByState('failed'),
    ]);

    // ── Per-pair breakdown ───────────────────────────────────────
    // Pull minimal fields for pair aggregation. Cap at 50k to stay performant.
    const { data: pairRows, error: pairErr } = await supabaseAdmin
      .from('question_bank')
      .select('grade, subject, verification_state')
      .is('deleted_at', null)
      .limit(50000);
    if (pairErr) throw new Error(`pair aggregation: ${pairErr.message}`);

    type PairAgg = { grade: string; subject: string; legacy_unverified: number; pending: number; verified: number; failed: number };
    const pairMap = new Map<string, PairAgg>();
    for (const row of (pairRows ?? []) as Array<{ grade: string; subject: string; verification_state: VerificationState }>) {
      const key = `${row.grade}::${row.subject}`;
      const agg = pairMap.get(key) ?? {
        grade: row.grade, subject: row.subject,
        legacy_unverified: 0, pending: 0, verified: 0, failed: 0,
      };
      if (row.verification_state === 'legacy_unverified') agg.legacy_unverified++;
      else if (row.verification_state === 'pending') agg.pending++;
      else if (row.verification_state === 'verified') agg.verified++;
      else if (row.verification_state === 'failed') agg.failed++;
      pairMap.set(key, agg);
    }

    const byPair = Array.from(pairMap.values())
      .map((p) => {
        const total = p.legacy_unverified + p.pending + p.verified + p.failed;
        return {
          ...p,
          verified_ratio: total === 0 ? 0 : Math.round((p.verified / total) * 10000) / 10000,
        };
      })
      .sort((a, b) => {
        const gc = a.grade.localeCompare(b.grade, undefined, { numeric: true });
        if (gc !== 0) return gc;
        return a.subject.localeCompare(b.subject);
      });

    // ── Failed sample (most recent 20 for triage) ────────────────
    const { data: failedSampleData, error: failedErr } = await supabaseAdmin
      .from('question_bank')
      .select(
        'id, grade, subject, chapter_number, chapter_title, question_text, ' +
        'correct_answer_index, verifier_failure_reason, verifier_trace_id, verified_at'
      )
      .eq('verification_state', 'failed')
      .is('deleted_at', null)
      .order('verified_at', { ascending: false })
      .limit(20);

    if (failedErr) throw new Error(`failedSample: ${failedErr.message}`);

    // ── Throughput last 24h ──────────────────────────────────────
    const since24h = new Date(Date.now() - 86400_000).toISOString();
    const [verified24Res, failed24Res] = await Promise.all([
      supabaseAdmin
        .from('question_bank')
        .select('id', { count: 'exact', head: true })
        .eq('verification_state', 'verified')
        .gte('verified_at', since24h),
      supabaseAdmin
        .from('question_bank')
        .select('id', { count: 'exact', head: true })
        .eq('verification_state', 'failed')
        .gte('verified_at', since24h),
    ]);

    const verified24 = verified24Res.count ?? 0;
    const failed24 = failed24Res.count ?? 0;

    return NextResponse.json({
      success: true,
      data: {
        counts: {
          legacy_unverified: legacyUnverified,
          pending,
          verified,
          failed,
        },
        byPair,
        failedSample: failedSampleData ?? [],
        throughputLast24h: {
          verified_per_hour: Math.round(verified24 / 24),
          failed_per_hour: Math.round(failed24 / 24),
          verified_total: verified24,
          failed_total: failed24,
        },
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}