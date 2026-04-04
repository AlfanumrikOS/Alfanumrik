/**
 * Deployment Control & Rollback API
 *
 * POST  — Deploy an approved execution
 * PATCH — Rollback a deployed execution
 * GET   — List deployments (deployed + rolled_back)
 *
 * Uses session-based admin auth (authorizeAdmin).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, type AdminAuth } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// ── Helpers ──────────────────────────────────────────────────────

function jsonOk(data: unknown) {
  return NextResponse.json({ success: true, data });
}

function jsonError(message: string, status: number = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function getIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for') || '';
}

// ── GET — List deployments ──────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const supabase = getSupabaseAdmin();
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;

  try {
    // Get executions with deployed or rolled_back status
    const { data: executions, error, count } = await supabase
      .from('improvement_executions')
      .select('*', { count: 'exact' })
      .in('status', ['deployed', 'rolled_back'])
      .order('completed_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('deploy_list_query_failed', { error: new Error(error.message) });
      return jsonError(error.message, 500);
    }

    // Fetch related recommendation text for each execution
    const recIds = [...new Set((executions || []).map((e: Record<string, unknown>) => e.recommendation_id as string))];
    let recommendations: Record<string, string> = {};

    if (recIds.length > 0) {
      const { data: recs, error: recErr } = await supabase
        .from('improvement_recommendations')
        .select('id, recommendation, issue_id')
        .in('id', recIds);

      if (!recErr && recs) {
        recommendations = Object.fromEntries(
          recs.map((r: Record<string, unknown>) => [r.id as string, r.recommendation as string])
        );
      }
    }

    // Enrich executions with recommendation text
    const enriched = (executions || []).map((e: Record<string, unknown>) => ({
      ...e,
      recommendation_text: recommendations[e.recommendation_id as string] || null,
    }));

    return jsonOk({ deployments: enriched, total: count, limit, offset });
  } catch (err) {
    logger.error('deploy_list_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return jsonError('Internal server error', 500);
  }
}

// ── POST — Deploy an approved execution ─────────────────────────

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const supabase = getSupabaseAdmin();
  const ip = getIp(request);

  try {
    const body = await request.json();
    const { execution_id, deploy_commit } = body;

    if (!execution_id || typeof execution_id !== 'string') {
      return jsonError('execution_id is required');
    }

    // 1. Validate execution exists and has status 'approved'
    const { data: execution, error: execErr } = await supabase
      .from('improvement_executions')
      .select('id, status, recommendation_id')
      .eq('id', execution_id)
      .single();

    if (execErr || !execution) {
      return jsonError('Execution not found', 404);
    }

    if ((execution.status as string) !== 'approved') {
      return jsonError(
        `Execution must have status "approved" to deploy. Current status: "${execution.status}"`,
      );
    }

    const recommendationId = execution.recommendation_id as string;

    // 2. Look up the parent recommendation to get its issue_id
    const { data: recommendation, error: recErr } = await supabase
      .from('improvement_recommendations')
      .select('id, issue_id')
      .eq('id', recommendationId)
      .single();

    if (recErr || !recommendation) {
      return jsonError('Parent recommendation not found', 404);
    }

    const issueId = recommendation.issue_id as string;
    const now = new Date().toISOString();

    // 3. Update execution: status → 'deployed'
    const { data: updatedExecution, error: updateExecErr } = await supabase
      .from('improvement_executions')
      .update({
        status: 'deployed',
        deploy_commit: deploy_commit || null,
        completed_at: now,
      })
      .eq('id', execution_id)
      .select()
      .single();

    if (updateExecErr) {
      logger.error('deploy_update_execution_failed', { error: new Error(updateExecErr.message), execution_id });
      return jsonError(updateExecErr.message, 500);
    }

    // 4. Update parent recommendation status to 'completed'
    const { error: updateRecErr } = await supabase
      .from('improvement_recommendations')
      .update({ status: 'completed' })
      .eq('id', recommendationId);

    if (updateRecErr) {
      logger.warn('deploy_update_recommendation_failed', {
        error: updateRecErr.message,
        recommendation_id: recommendationId,
      });
    }

    // 5. Update parent issue status to 'resolved'
    const { error: updateIssueErr } = await supabase
      .from('improvement_issues')
      .update({ status: 'resolved', resolved_at: now })
      .eq('id', issueId);

    if (updateIssueErr) {
      logger.warn('deploy_update_issue_failed', {
        error: updateIssueErr.message,
        issue_id: issueId,
      });
    }

    // 6. Audit log
    await logAdminAudit(
      auth as AdminAuth,
      'improvement_deployed',
      'improvement_execution',
      execution_id,
      {
        recommendation_id: recommendationId,
        issue_id: issueId,
        deploy_commit: deploy_commit || null,
      },
      ip,
    );

    return jsonOk(updatedExecution);
  } catch (err) {
    logger.error('deploy_post_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return jsonError('Internal server error', 500);
  }
}

// ── PATCH — Rollback a deployed execution ───────────────────────

export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const supabase = getSupabaseAdmin();
  const ip = getIp(request);

  try {
    const body = await request.json();
    const { execution_id, rollback_reason } = body;

    if (!execution_id || typeof execution_id !== 'string') {
      return jsonError('execution_id is required');
    }
    if (!rollback_reason || typeof rollback_reason !== 'string') {
      return jsonError('rollback_reason is required');
    }

    // 1. Validate execution exists and has status 'deployed'
    const { data: execution, error: execErr } = await supabase
      .from('improvement_executions')
      .select('id, status, recommendation_id')
      .eq('id', execution_id)
      .single();

    if (execErr || !execution) {
      return jsonError('Execution not found', 404);
    }

    if ((execution.status as string) !== 'deployed') {
      return jsonError(
        `Execution must have status "deployed" to rollback. Current status: "${execution.status}"`,
      );
    }

    const recommendationId = execution.recommendation_id as string;

    // 2. Look up parent recommendation to get issue_id
    const { data: recommendation, error: recErr } = await supabase
      .from('improvement_recommendations')
      .select('id, issue_id')
      .eq('id', recommendationId)
      .single();

    if (recErr || !recommendation) {
      return jsonError('Parent recommendation not found', 404);
    }

    const issueId = recommendation.issue_id as string;
    const now = new Date().toISOString();

    // 3. Update execution: status → 'rolled_back'
    const { data: updatedExecution, error: updateExecErr } = await supabase
      .from('improvement_executions')
      .update({
        status: 'rolled_back',
        rolled_back_at: now,
        rollback_reason,
      })
      .eq('id', execution_id)
      .select()
      .single();

    if (updateExecErr) {
      logger.error('rollback_update_execution_failed', { error: new Error(updateExecErr.message), execution_id });
      return jsonError(updateExecErr.message, 500);
    }

    // 4. Update parent recommendation status back to 'approved'
    const { error: updateRecErr } = await supabase
      .from('improvement_recommendations')
      .update({ status: 'approved' })
      .eq('id', recommendationId);

    if (updateRecErr) {
      logger.warn('rollback_update_recommendation_failed', {
        error: updateRecErr.message,
        recommendation_id: recommendationId,
      });
    }

    // 5. Update parent issue status back to 'in_progress'
    const { error: updateIssueErr } = await supabase
      .from('improvement_issues')
      .update({ status: 'in_progress', resolved_at: null })
      .eq('id', issueId);

    if (updateIssueErr) {
      logger.warn('rollback_update_issue_failed', {
        error: updateIssueErr.message,
        issue_id: issueId,
      });
    }

    // 6. Audit log
    await logAdminAudit(
      auth as AdminAuth,
      'improvement_rolled_back',
      'improvement_execution',
      execution_id,
      {
        recommendation_id: recommendationId,
        issue_id: issueId,
        rollback_reason,
      },
      ip,
    );

    return jsonOk(updatedExecution);
  } catch (err) {
    logger.error('rollback_patch_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return jsonError('Internal server error', 500);
  }
}
