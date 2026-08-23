/** @license Apache-2.0 */
/**
 * GET /api/super-admin/ai-quality — Phase A.3: consolidated AI quality
 * signal dashboard data source.
 *
 * Reads read-only aggregates from 5 existing tables (no writes, no mastery/
 * XP/learner-state mutation — P1/P2/P3 untouched) and shapes them into the
 * `AiQualityData` contract consumed by
 * `apps/host/src/app/super-admin/ai-quality/page.tsx`:
 *   - foxy_quality_scores            → nightly Sonnet-judge rubric averages
 *   - ops_events (category 'ai*')    → AI-related operational event counts
 *   - foxy_message_feedback          → binary 👍/👎 feedback summary
 *   - foxy_message_dimension_feedback→ per-dimension 👍/👎 feedback summary
 *   - foxy_chat_messages             → assistant coach-mode distribution
 *
 * All windows are the trailing 30 days. Aggregate-only response — counts,
 * scores, and enum-like keys (dimension names, coach modes, judge model /
 * rubric version strings) ONLY. Never message text, `reason` free text, or
 * student identifiers (P13).
 *
 * Auth: `super_admin.access` — the SAME existing permission the sibling
 *   super-admin analytics/report routes use (marking-integrity/[studentId],
 *   foxy-report/[studentId]). No new permission, no new RBAC.
 *
 * Style precedent: apps/host/src/app/api/super-admin/foxy-report/[studentId]/route.ts
 * (auth gate, supabaseAdmin reads, try/catch → 500, logger usage).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';

// ── Response shapes (mirrors the interfaces in super-admin/ai-quality/page.tsx) ──

interface JudgeData {
  totalScored30d: number;
  avgOverall: number | null;
  avgAccuracy: number | null;
  avgScaffold: number | null;
  avgAge: number | null;
  avgScope: number | null;
  rubricVersions: Record<string, number>;
  judgeModels: Record<string, number>;
}

interface OpsData {
  totalAiEvents: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
}

interface FeedbackData {
  total30d: number;
  thumbsUp: number;
  thumbsDown: number;
  withReason: number;
  byDimension: Record<string, { up: number; down: number }>;
}

interface MessageData {
  total30d: number;
  coachModes: Record<string, number>;
  roles: Record<string, number>;
}

interface AiQualityData {
  judge: JudgeData;
  ops: OpsData;
  feedback: FeedbackData;
  messages: MessageData;
}

// Bounded reads — this is an admin at-a-glance aggregate surface, not a
// full export. 30d volume on any of these tables is not expected to exceed
// this in the current traffic regime; revisit if it does.
const AGG_LIMIT = 5000;

const WINDOW_DAYS = 30;

// ops_events holds ALL platform ops events, not just AI ones. Every
// production emitter found via `grep -rn "category:\s*['\"]ai" packages
// apps/host supabase` writes the exact literal `category: 'ai'` —
// packages/lib/src/ai/eval/emit.ts, packages/lib/src/ai/clients/claude.ts,
// packages/lib/src/ai/agents/runAgent.ts, packages/lib/src/ai/gateway/
// telemetry.ts, packages/lib/src/state/journey/journey.ts,
// apps/host/src/app/api/foxy/route.ts, supabase/functions/_shared/ops-events.ts.
// No non-AI category anywhere in the codebase starts with 'ai'. An `.in()`
// list (rather than a single `.eq`) is used so a future namespaced value
// (e.g. 'ai.eval') can be added here without changing the query shape.
const AI_OPS_CATEGORIES = ['ai'];

/** Coerce a Supabase array result to rows, treating any error as an empty read. */
function rows<T>(res: { data: unknown; error: unknown } | null | undefined): T[] {
  if (!res || res.error || !Array.isArray(res.data)) return [];
  return res.data as T[];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Count occurrences of a string field across rows, skipping null/undefined/empty. */
function countBy<T>(items: T[], pick: (item: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = pick(item);
    if (key === null || key === undefined || key === '') continue;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

// ── Row shapes (only the columns we read) ───────────────────────────────────

interface JudgeScoreRow {
  overall_score: number | null;
  accuracy_score: number | null;
  scaffold_fidelity_score: number | null;
  age_appropriateness_score: number | null;
  cbse_scope_score: number | null;
  rubric_version: string | null;
  judge_model: string | null;
}

interface OpsEventRow {
  source: string | null;
  category: string | null;
}

interface MessageFeedbackRow {
  is_up: boolean | null;
  reason: string | null;
}

interface DimensionFeedbackRow {
  dimension: string | null;
  is_up: boolean | null;
}

interface ChatMessageRow {
  coach_mode_used: string | null;
  role: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const cutoffIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [
      judgeRes,
      opsRes,
      feedbackRes,
      dimensionFeedbackRes,
      messagesRes,
    ] = await Promise.all([
      // foxy_quality_scores: timestamp column is `scored_at` (no `created_at`
      // on this table — verified in 20260508240000_foxy_quality_scores.sql).
      supabaseAdmin
        .from('foxy_quality_scores')
        .select(
          'overall_score, accuracy_score, scaffold_fidelity_score, age_appropriateness_score, cbse_scope_score, rubric_version, judge_model',
        )
        .gte('scored_at', cutoffIso)
        .limit(AGG_LIMIT),
      // ops_events: timestamp column is `occurred_at` (no `created_at` — see
      // the legacy Observability Console Cut 1a migration). This table holds
      // ALL ops events platform-wide, so it must be filtered to AI-related
      // rows only — see AI_OPS_CATEGORIES above for the research behind the
      // filter value.
      supabaseAdmin
        .from('ops_events')
        .select('source, category')
        .gte('occurred_at', cutoffIso)
        .in('category', AI_OPS_CATEGORIES)
        .limit(AGG_LIMIT),
      // foxy_message_feedback: has `created_at`.
      supabaseAdmin
        .from('foxy_message_feedback')
        .select('is_up, reason')
        .gte('created_at', cutoffIso)
        .limit(AGG_LIMIT),
      // foxy_message_dimension_feedback: has `created_at`
      // (20260818_01_create_foxy_message_dimension_feedback.sql:27).
      supabaseAdmin
        .from('foxy_message_dimension_feedback')
        .select('dimension, is_up')
        .gte('created_at', cutoffIso)
        .limit(AGG_LIMIT),
      // foxy_chat_messages: has `created_at`. Server-side filter to
      // role='assistant' — only assistant turns carry coach_mode_used /
      // are meaningful for this dashboard.
      supabaseAdmin
        .from('foxy_chat_messages')
        .select('coach_mode_used, role')
        .gte('created_at', cutoffIso)
        .eq('role', 'assistant')
        .limit(AGG_LIMIT),
    ]);

    // ── Judge (foxy_quality_scores) ──────────────────────────────────────
    const judgeRows = rows<JudgeScoreRow>(judgeRes);
    const judge: JudgeData = {
      totalScored30d: judgeRows.length,
      avgOverall: mean(judgeRows.map((r) => r.overall_score).filter((v): v is number => v !== null)),
      avgAccuracy: mean(judgeRows.map((r) => r.accuracy_score).filter((v): v is number => v !== null)),
      avgScaffold: mean(
        judgeRows.map((r) => r.scaffold_fidelity_score).filter((v): v is number => v !== null),
      ),
      avgAge: mean(
        judgeRows.map((r) => r.age_appropriateness_score).filter((v): v is number => v !== null),
      ),
      avgScope: mean(judgeRows.map((r) => r.cbse_scope_score).filter((v): v is number => v !== null)),
      rubricVersions: countBy(judgeRows, (r) => r.rubric_version),
      judgeModels: countBy(judgeRows, (r) => r.judge_model),
    };

    // ── Ops (ops_events, AI-only) ────────────────────────────────────────
    const opsRows = rows<OpsEventRow>(opsRes);
    const ops: OpsData = {
      totalAiEvents: opsRows.length,
      bySource: countBy(opsRows, (r) => r.source),
      byCategory: countBy(opsRows, (r) => r.category),
    };

    // ── Feedback (binary + dimension) ────────────────────────────────────
    const feedbackRows = rows<MessageFeedbackRow>(feedbackRes);
    const thumbsUp = feedbackRows.filter((r) => r.is_up === true).length;
    const thumbsDown = feedbackRows.filter((r) => r.is_up === false).length;
    const withReason = feedbackRows.filter(
      (r) => typeof r.reason === 'string' && r.reason.trim().length > 0,
    ).length;

    const dimensionRows = rows<DimensionFeedbackRow>(dimensionFeedbackRes);
    const byDimension: Record<string, { up: number; down: number }> = {};
    for (const r of dimensionRows) {
      if (!r.dimension) continue;
      if (!byDimension[r.dimension]) byDimension[r.dimension] = { up: 0, down: 0 };
      if (r.is_up) byDimension[r.dimension].up += 1;
      else byDimension[r.dimension].down += 1;
    }

    const feedback: FeedbackData = {
      total30d: feedbackRows.length,
      thumbsUp,
      thumbsDown,
      withReason,
      byDimension,
    };

    // ── Messages (coach-mode / role distribution) ────────────────────────
    const messageRows = rows<ChatMessageRow>(messagesRes);
    const rowsWithCoachMode = messageRows.filter((r) => r.coach_mode_used !== null);
    const messages: MessageData = {
      total30d: rowsWithCoachMode.length,
      coachModes: countBy(rowsWithCoachMode, (r) => r.coach_mode_used),
      roles: countBy(messageRows, (r) => r.role),
    };

    const data: AiQualityData = { judge, ops, feedback, messages };

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (err) {
    // P13: log failure metadata only — never message/reason content.
    logger.error('super-admin.ai-quality: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
