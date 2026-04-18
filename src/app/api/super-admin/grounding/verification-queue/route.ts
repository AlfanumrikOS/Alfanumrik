import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logOpsEvent } from '@/lib/ops-events';

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
 * POST /api/super-admin/grounding/verification-queue
 *
 * Admin actions against the verification queue.
 * Body: { action: 're-verify' | 'soft-delete' | 'enable-enforcement', payload: {...} }
 *
 * Actions:
 *   - re-verify          payload: { id }
 *                        Reset verification_state to 'legacy_unverified' so the
 *                        retroactive verifier picks it up on next run.
 *   - soft-delete        payload: { id, reason? }
 *                        Set deleted_at=now() on the question_bank row.
 *   - enable-enforcement payload: { grade, subject_code }
 *                        UPSERT into ff_grounded_ai_enforced_pairs with
 *                        enabled=true. Server-side precondition: the pair's
 *                        verified_ratio MUST be >= 0.9 (matches spec §11
 *                        precondition for pilot rollout).
 *
 * All actions log an ops_events row (category='grounding.admin_action',
 * source='super-admin.verification-queue').
 *
 * Auth: super_admin.access permission.
 */

export const runtime = 'nodejs';

const ENFORCEMENT_MIN_VERIFIED_RATIO = 0.9;

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

// ─── POST handler ────────────────────────────────────────────────────────────

type PostAction = 're-verify' | 'soft-delete' | 'enable-enforcement';
const VALID_ACTIONS: readonly PostAction[] = ['re-verify', 'soft-delete', 'enable-enforcement'];

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function isGrade(v: unknown): v is string {
  // CBSE grades 6-12 (P5: always string)
  return typeof v === 'string' && /^(6|7|8|9|10|11|12)$/.test(v);
}

function isSubjectCode(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length < 64 && /^[a-z0-9_-]+$/.test(v);
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  let body: { action?: unknown; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const action = body.action;
  if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as PostAction)) {
    return NextResponse.json(
      { success: false, error: `Invalid action. Expected one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  const payload = (body.payload && typeof body.payload === 'object') ? body.payload as Record<string, unknown> : {};

  try {
    // ── re-verify ───────────────────────────────────────────────────────────
    if (action === 're-verify') {
      const id = payload.id;
      if (!isUuid(id)) {
        return NextResponse.json(
          { success: false, error: 're-verify requires payload.id (uuid)' },
          { status: 400 },
        );
      }

      const { error } = await supabaseAdmin
        .from('question_bank')
        .update({
          verification_state: 'legacy_unverified',
          verification_claimed_by: null,
          verification_claim_expires_at: null,
          verifier_failure_reason: null,
        })
        .eq('id', id);

      if (error) {
        return NextResponse.json(
          { success: false, error: `re-verify failed: ${error.message}` },
          { status: 500 },
        );
      }

      await logOpsEvent({
        category: 'grounding.admin_action',
        source: 'super-admin.verification-queue',
        severity: 'info',
        message: `re-verify requested for question_bank row ${id}`,
        subjectType: 'question_bank',
        subjectId: id,
        context: { action, admin_user_id: auth.userId },
      });

      return NextResponse.json({ success: true, data: { action, id } });
    }

    // ── soft-delete ─────────────────────────────────────────────────────────
    if (action === 'soft-delete') {
      const id = payload.id;
      const reason = typeof payload.reason === 'string' ? payload.reason : null;
      if (!isUuid(id)) {
        return NextResponse.json(
          { success: false, error: 'soft-delete requires payload.id (uuid)' },
          { status: 400 },
        );
      }

      const { error } = await supabaseAdmin
        .from('question_bank')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .is('deleted_at', null);

      if (error) {
        return NextResponse.json(
          { success: false, error: `soft-delete failed: ${error.message}` },
          { status: 500 },
        );
      }

      await logOpsEvent({
        category: 'grounding.admin_action',
        source: 'super-admin.verification-queue',
        severity: 'warning',
        message: `soft-delete applied to question_bank row ${id}`,
        subjectType: 'question_bank',
        subjectId: id,
        context: { action, reason, admin_user_id: auth.userId },
      });

      return NextResponse.json({ success: true, data: { action, id } });
    }

    // ── enable-enforcement ──────────────────────────────────────────────────
    if (action === 'enable-enforcement') {
      const grade = payload.grade;
      const subject_code = payload.subject_code;
      if (!isGrade(grade)) {
        return NextResponse.json(
          { success: false, error: 'enable-enforcement requires payload.grade (string "6"–"12")' },
          { status: 400 },
        );
      }
      if (!isSubjectCode(subject_code)) {
        return NextResponse.json(
          { success: false, error: 'enable-enforcement requires payload.subject_code' },
          { status: 400 },
        );
      }

      // Precondition: verified_ratio >= 0.9. Recompute server-side so the
      // client cannot bypass by passing a stale number.
      const { data: pairRows, error: pairErr } = await supabaseAdmin
        .from('question_bank')
        .select('verification_state')
        .eq('grade', grade)
        .eq('subject', subject_code)
        .is('deleted_at', null)
        .limit(50000);

      if (pairErr) {
        return NextResponse.json(
          { success: false, error: `verified_ratio lookup failed: ${pairErr.message}` },
          { status: 500 },
        );
      }

      const rows = (pairRows ?? []) as Array<{ verification_state: VerificationState }>;
      const total = rows.length;
      const verified = rows.filter((r) => r.verification_state === 'verified').length;
      const verified_ratio = total === 0 ? 0 : verified / total;

      if (verified_ratio < ENFORCEMENT_MIN_VERIFIED_RATIO) {
        return NextResponse.json(
          {
            success: false,
            error:
              `enable-enforcement denied: verified_ratio ${verified_ratio.toFixed(4)} ` +
              `< required ${ENFORCEMENT_MIN_VERIFIED_RATIO} for (grade=${grade}, subject=${subject_code}). ` +
              `Wait for the retroactive verifier to drain the queue for this pair.`,
            context: { verified, total, verified_ratio },
          },
          { status: 400 },
        );
      }

      // UPSERT into enforced_pairs (composite PK: grade, subject_code)
      const { error: upsertErr } = await supabaseAdmin
        .from('ff_grounded_ai_enforced_pairs')
        .upsert(
          {
            grade,
            subject_code,
            enabled: true,
            enabled_at: new Date().toISOString(),
            enabled_by: auth.userId,
            auto_disabled_at: null,
            auto_disabled_reason: null,
          },
          { onConflict: 'grade,subject_code' },
        );

      if (upsertErr) {
        return NextResponse.json(
          { success: false, error: `enforcement upsert failed: ${upsertErr.message}` },
          { status: 500 },
        );
      }

      await logOpsEvent({
        category: 'grounding.admin_action',
        source: 'super-admin.verification-queue',
        severity: 'warning',
        message: `grounding enforcement enabled for (grade=${grade}, subject=${subject_code})`,
        subjectType: 'enforcement_pair',
        subjectId: `${grade}::${subject_code}`,
        context: {
          action,
          grade,
          subject_code,
          verified_ratio,
          verified,
          total,
          admin_user_id: auth.userId,
        },
      });

      return NextResponse.json({
        success: true,
        data: { action, grade, subject_code, verified_ratio, enabled_at: new Date().toISOString() },
      });
    }

    // Unreachable — action is validated above.
    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}