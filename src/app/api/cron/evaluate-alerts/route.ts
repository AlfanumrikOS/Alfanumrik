import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * POST /api/cron/evaluate-alerts
 * Evaluates active school_alert_rules against live metrics and creates
 * notifications when thresholds are exceeded.
 * Auth: CRON_SECRET header or Authorization Bearer.
 * Idempotent: 24h cooldown per rule. P13: no PII in logs.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

type RuleType = 'error_rate' | 'engagement_drop' | 'payment_failure' | 'ai_budget' | 'seat_limit';
interface AlertRule { id: string; school_id: string | null; rule_type: RuleType; threshold: number; is_active: boolean; last_triggered_at: string | null; }
interface EvalResult { triggered: boolean; currentValue: number; message: string; }

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAY_MS = COOLDOWN_MS;
const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function verifyCronSecret(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || !secret || secret.length !== expected.length) return false;
  let m = 0;
  for (let i = 0; i < secret.length; i++) m |= secret.charCodeAt(i) ^ expected.charCodeAt(i);
  return m === 0;
}

// ── Evaluators (one per rule_type) ──────────────────────────────────────────

async function evaluateErrorRate(rule: AlertRule): Promise<EvalResult> {
  const q = getSupabaseAdmin().from('audit_logs').select('id', { count: 'exact', head: true })
    .eq('action', 'error').gte('created_at', new Date(Date.now() - HOUR_MS).toISOString());
  if (rule.school_id) q.eq('entity_id', rule.school_id);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  const v = count ?? 0;
  return { triggered: v >= rule.threshold, currentValue: v, message: `${v} errors in last hour (threshold: ${rule.threshold})` };
}

async function evaluateEngagementDrop(rule: AlertRule): Promise<EvalResult> {
  const admin = getSupabaseAdmin();
  const now = Date.now();
  const twS = new Date(now - WEEK_MS).toISOString();
  const lwS = new Date(now - 2 * WEEK_MS).toISOString();
  const lwE = twS;

  let twQ = admin.from('quiz_sessions').select('id', { count: 'exact', head: true }).gte('created_at', twS);
  let lwQ = admin.from('quiz_sessions').select('id', { count: 'exact', head: true }).gte('created_at', lwS).lt('created_at', lwE);

  if (rule.school_id) {
    const { data } = await admin.from('students').select('id').eq('school_id', rule.school_id);
    const ids = (data ?? []).map((s: { id: string }) => s.id);
    if (ids.length === 0) return { triggered: false, currentValue: 0, message: 'No students in school' };
    twQ = twQ.in('student_id', ids);
    lwQ = lwQ.in('student_id', ids);
  }

  const [tw, lw] = await Promise.all([twQ, lwQ]);
  if (tw.error) throw new Error(tw.error.message);
  if (lw.error) throw new Error(lw.error.message);
  const twC = tw.count ?? 0, lwC = lw.count ?? 0;
  if (lwC === 0) return { triggered: false, currentValue: 0, message: 'No baseline from last week' };
  const drop = Math.round(((lwC - twC) / lwC) * 100);
  return { triggered: drop >= rule.threshold, currentValue: drop, message: `Engagement dropped ${drop}% (${lwC}->${twC} quizzes, threshold: ${rule.threshold}%)` };
}

async function evaluatePaymentFailure(rule: AlertRule): Promise<EvalResult> {
  const { count, error } = await getSupabaseAdmin().from('student_subscriptions')
    .select('id', { count: 'exact', head: true }).in('status', ['past_due', 'halted'])
    .gte('updated_at', new Date(Date.now() - DAY_MS).toISOString());
  if (error) throw new Error(error.message);
  const v = count ?? 0;
  return { triggered: v >= rule.threshold, currentValue: v, message: `${v} stuck/failed subscriptions in 24h (threshold: ${rule.threshold})` };
}

async function evaluateAiBudget(rule: AlertRule): Promise<EvalResult> {
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  let q = getSupabaseAdmin().from('ai_usage_logs').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString());
  if (rule.school_id) q = q.eq('school_id', rule.school_id);
  const { count, error } = await q;
  if (error) {
    if (error.message.includes('does not exist')) return { triggered: false, currentValue: 0, message: 'ai_usage_logs not available' };
    throw new Error(error.message);
  }
  const v = count ?? 0;
  return { triggered: v >= rule.threshold, currentValue: v, message: `${v} AI calls today (threshold: ${rule.threshold})` };
}

async function evaluateSeatLimit(rule: AlertRule): Promise<EvalResult> {
  if (!rule.school_id) return { triggered: false, currentValue: 0, message: 'seat_limit requires school_id' };
  const admin = getSupabaseAdmin();
  const { data: sub } = await admin.from('school_subscriptions').select('seats_purchased')
    .eq('school_id', rule.school_id).in('status', ['active', 'trial']).limit(1).single();
  if (!sub) return { triggered: false, currentValue: 0, message: 'No active school subscription' };
  const { count } = await admin.from('students').select('id', { count: 'exact', head: true })
    .eq('school_id', rule.school_id).eq('is_active', true);
  const active = count ?? 0, seats = sub.seats_purchased ?? 0;
  const pct = seats > 0 ? Math.round((active / seats) * 100) : 0;
  return { triggered: pct >= rule.threshold, currentValue: pct, message: `${active}/${seats} seats (${pct}%, threshold: ${rule.threshold}%)` };
}

const EVALUATORS: Record<RuleType, (r: AlertRule) => Promise<EvalResult>> = {
  error_rate: evaluateErrorRate, engagement_drop: evaluateEngagementDrop,
  payment_failure: evaluatePaymentFailure, ai_budget: evaluateAiBudget, seat_limit: evaluateSeatLimit,
};

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  const summary = { rules_evaluated: 0, alerts_triggered: 0, errors: [] as string[], duration_ms: 0 };

  try {
    const admin = getSupabaseAdmin();
    const { data: rules, error: rulesErr } = await admin.from('school_alert_rules')
      .select('id, school_id, rule_type, threshold, is_active, last_triggered_at').eq('is_active', true);

    if (rulesErr) {
      if (rulesErr.message.includes('does not exist'))
        return NextResponse.json({ success: true, data: { ...summary, skipped: true, reason: 'table not available', duration_ms: Date.now() - t0 } });
      throw new Error(rulesErr.message);
    }

    for (const rule of (rules ?? []) as AlertRule[]) {
      try {
        // 24h cooldown
        if (rule.last_triggered_at && Date.now() - new Date(rule.last_triggered_at).getTime() < COOLDOWN_MS) continue;
        const evaluator = EVALUATORS[rule.rule_type];
        if (!evaluator) { summary.errors.push(`unknown_type:${rule.rule_type}`); continue; }

        summary.rules_evaluated++;
        const result = await evaluator(rule);
        if (!result.triggered) continue;

        // Create notification
        const { error: nErr } = await admin.from('notifications').insert({
          recipient_id: rule.school_id ?? 'super_admin',
          recipient_type: rule.school_id ? 'school' : 'super_admin',
          notification_type: `alert_${rule.rule_type}`,
          title: `Alert: ${rule.rule_type.replace(/_/g, ' ')} threshold exceeded`,
          body: result.message,
          created_at: new Date().toISOString(),
        });
        if (nErr) { summary.errors.push(`notif_${rule.id}:${nErr.message}`); continue; }

        // Stamp cooldown
        const { error: uErr } = await admin.from('school_alert_rules')
          .update({ last_triggered_at: new Date().toISOString() }).eq('id', rule.id);
        if (uErr) summary.errors.push(`update_${rule.id}:${uErr.message}`);
        summary.alerts_triggered++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`rule_${rule.id}:${msg}`);
        logger.error('cron/evaluate-alerts: rule failed', { ruleId: rule.id, ruleType: rule.rule_type, error: err instanceof Error ? err : new Error(msg) });
      }
    }

    summary.duration_ms = Date.now() - t0;
    logger.info('cron/evaluate-alerts: done', { rules_evaluated: summary.rules_evaluated, alerts_triggered: summary.alerts_triggered, errors_count: summary.errors.length, duration_ms: summary.duration_ms });
    return NextResponse.json({ success: true, data: summary });
  } catch (err) {
    summary.duration_ms = Date.now() - t0;
    logger.error('cron/evaluate-alerts: fatal', { error: err instanceof Error ? err : new Error(String(err)), duration_ms: summary.duration_ms });
    return NextResponse.json({ success: false, error: 'Internal cron error', data: summary }, { status: 500 });
  }
}
