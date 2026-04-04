/**
 * Product Improvement Command Center API
 *
 * CRUD operations for improvement_issues, improvement_recommendations,
 * and improvement_executions. Uses session-based admin auth.
 *
 * GET  ?action=issues|recommendations|executions|dashboard
 * POST ?action=issue|recommendation|execution
 * PATCH ?action=issue|recommendation|execution
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

const VALID_ISSUE_CATEGORIES = ['onboarding', 'ux', 'learning', 'quiz', 'rag', 'performance', 'admin', 'payment', 'mobile'] as const;
const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const VALID_ISSUE_STATUSES = ['open', 'investigating', 'recommendation_pending', 'in_progress', 'resolved', 'wont_fix'] as const;
const VALID_RECOMMENDATION_STATUSES = ['proposed', 'approved', 'rejected', 'executing', 'completed', 'rolled_back'] as const;
const VALID_EXECUTION_STATUSES = ['pending', 'staging', 'testing', 'approved', 'deployed', 'rolled_back', 'failed'] as const;
const VALID_EXECUTION_TYPES = ['code_patch', 'config_change', 'content_fix', 'manual'] as const;
const VALID_IMPACT = ['high', 'medium', 'low'] as const;
const VALID_EFFORT = ['hours', 'days', 'weeks'] as const;
const VALID_RISK = ['low', 'medium', 'high'] as const;

// ── GET ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const supabase = getSupabaseAdmin();
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'dashboard';

  try {
    switch (action) {
      case 'issues':
        return await getIssues(supabase, url);
      case 'recommendations':
        return await getRecommendations(supabase, url);
      case 'executions':
        return await getExecutions(supabase, url);
      case 'dashboard':
        return await getDashboard(supabase);
      default:
        return jsonError(`Unknown action: ${action}`);
    }
  } catch (err) {
    logger.error('improvement_api_get_error', { error: err instanceof Error ? err : new Error(String(err)), action });
    return jsonError('Internal server error', 500);
  }
}

async function getIssues(supabase: ReturnType<typeof getSupabaseAdmin>, url: URL) {
  const status = url.searchParams.get('status');
  const category = url.searchParams.get('category');
  const severity = url.searchParams.get('severity');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;

  let query = supabase
    .from('improvement_issues')
    .select('*', { count: 'exact' })
    .order('detected_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (category) query = query.eq('category', category);
  if (severity) query = query.eq('severity', severity);

  const { data, error, count } = await query;
  if (error) return jsonError(error.message, 500);

  return jsonOk({ issues: data, total: count, limit, offset });
}

async function getRecommendations(supabase: ReturnType<typeof getSupabaseAdmin>, url: URL) {
  const issueId = url.searchParams.get('issue_id');
  const status = url.searchParams.get('status');

  let query = supabase
    .from('improvement_recommendations')
    .select('*')
    .order('created_at', { ascending: false });

  if (issueId) query = query.eq('issue_id', issueId);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);

  return jsonOk({ recommendations: data });
}

async function getExecutions(supabase: ReturnType<typeof getSupabaseAdmin>, url: URL) {
  const recommendationId = url.searchParams.get('recommendation_id');
  const status = url.searchParams.get('status');

  let query = supabase
    .from('improvement_executions')
    .select('*')
    .order('created_at', { ascending: false });

  if (recommendationId) query = query.eq('recommendation_id', recommendationId);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);

  return jsonOk({ executions: data });
}

async function getDashboard(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const [
    issuesBySeverity,
    issuesByStatus,
    recsByStatus,
    execsByStatus,
    recentIssues,
    resolvedIssues,
  ] = await Promise.all([
    // Issue counts by severity
    supabase.from('improvement_issues').select('severity'),
    // Issue counts by status
    supabase.from('improvement_issues').select('status'),
    // Recommendation counts by status
    supabase.from('improvement_recommendations').select('status'),
    // Execution counts by status
    supabase.from('improvement_executions').select('status'),
    // Recent issues (last 5)
    supabase
      .from('improvement_issues')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(5),
    // Resolved issues for avg resolution time
    supabase
      .from('improvement_issues')
      .select('detected_at, resolved_at')
      .eq('status', 'resolved')
      .not('resolved_at', 'is', null)
      .order('resolved_at', { ascending: false })
      .limit(100),
  ]);

  // Count by severity
  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of issuesBySeverity.data || []) {
    const s = (row as { severity: string }).severity;
    if (s in severityCounts) severityCounts[s]++;
  }

  // Count by status
  const statusCounts: Record<string, number> = {};
  for (const row of issuesByStatus.data || []) {
    const s = (row as { status: string }).status;
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  // Recommendation counts by status
  const recStatusCounts: Record<string, number> = {};
  for (const row of recsByStatus.data || []) {
    const s = (row as { status: string }).status;
    recStatusCounts[s] = (recStatusCounts[s] || 0) + 1;
  }

  // Execution counts by status
  const execStatusCounts: Record<string, number> = {};
  for (const row of execsByStatus.data || []) {
    const s = (row as { status: string }).status;
    execStatusCounts[s] = (execStatusCounts[s] || 0) + 1;
  }

  // Open issues count
  const openStatuses = ['open', 'investigating', 'recommendation_pending', 'in_progress'];
  const totalOpen = openStatuses.reduce((sum, s) => sum + (statusCounts[s] || 0), 0);

  // Average resolution time (hours)
  let avgResolutionHours = 0;
  const resolved = resolvedIssues.data || [];
  if (resolved.length > 0) {
    const totalMs = resolved.reduce((sum: number, row: Record<string, unknown>) => {
      const detected = new Date(row.detected_at as string).getTime();
      const resolvedAt = new Date(row.resolved_at as string).getTime();
      return sum + (resolvedAt - detected);
    }, 0);
    avgResolutionHours = Math.round(totalMs / resolved.length / (1000 * 60 * 60) * 10) / 10;
  }

  return jsonOk({
    issues_by_severity: severityCounts,
    issues_by_status: statusCounts,
    recommendations_by_status: recStatusCounts,
    executions_by_status: execStatusCounts,
    recent_issues: recentIssues.data || [],
    health: {
      total_open_issues: totalOpen,
      avg_resolution_hours: avgResolutionHours,
    },
  });
}

// ── POST ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const supabase = getSupabaseAdmin();
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const ip = getIp(request);

  try {
    const body = await request.json();

    switch (action) {
      case 'issue':
        return await createIssue(supabase, body, auth, ip);
      case 'recommendation':
        return await createRecommendation(supabase, body, auth, ip);
      case 'execution':
        return await createExecution(supabase, body, auth, ip);
      default:
        return jsonError(`Unknown action: ${action}. Use ?action=issue|recommendation|execution`);
    }
  } catch (err) {
    logger.error('improvement_api_post_error', { error: err instanceof Error ? err : new Error(String(err)), action });
    return jsonError('Internal server error', 500);
  }
}

async function createIssue(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  body: Record<string, unknown>,
  auth: AdminAuth,
  ip: string,
) {
  const { title, description, category, severity, source, evidence, assigned_agent } = body;

  if (!title || typeof title !== 'string') return jsonError('title is required');
  if (!category || !VALID_ISSUE_CATEGORIES.includes(category as typeof VALID_ISSUE_CATEGORIES[number])) {
    return jsonError(`category must be one of: ${VALID_ISSUE_CATEGORIES.join(', ')}`);
  }
  if (!severity || !VALID_SEVERITIES.includes(severity as typeof VALID_SEVERITIES[number])) {
    return jsonError(`severity must be one of: ${VALID_SEVERITIES.join(', ')}`);
  }

  const issueSource = source && typeof source === 'string' ? source : 'manual';

  const { data, error } = await supabase
    .from('improvement_issues')
    .insert({
      title,
      description: description || null,
      category,
      severity,
      source: issueSource,
      evidence: evidence || {},
      assigned_agent: assigned_agent || null,
      created_by: auth.email,
    })
    .select()
    .single();

  if (error) return jsonError(error.message, 500);

  await logAdminAudit(auth, 'create_improvement_issue', 'improvement_issue', data.id, { title, category, severity }, ip);

  return NextResponse.json({ success: true, data }, { status: 201 });
}

async function createRecommendation(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  body: Record<string, unknown>,
  auth: AdminAuth,
  ip: string,
) {
  const { issue_id, recommendation, impact_estimate, effort_estimate, risk_level, affected_files, agent_owner } = body;

  if (!issue_id || typeof issue_id !== 'string') return jsonError('issue_id is required');
  if (!recommendation || typeof recommendation !== 'string') return jsonError('recommendation is required');

  if (impact_estimate && !VALID_IMPACT.includes(impact_estimate as typeof VALID_IMPACT[number])) {
    return jsonError(`impact_estimate must be one of: ${VALID_IMPACT.join(', ')}`);
  }
  if (effort_estimate && !VALID_EFFORT.includes(effort_estimate as typeof VALID_EFFORT[number])) {
    return jsonError(`effort_estimate must be one of: ${VALID_EFFORT.join(', ')}`);
  }
  if (risk_level && !VALID_RISK.includes(risk_level as typeof VALID_RISK[number])) {
    return jsonError(`risk_level must be one of: ${VALID_RISK.join(', ')}`);
  }

  // Verify issue exists
  const { data: issue, error: issueErr } = await supabase
    .from('improvement_issues')
    .select('id')
    .eq('id', issue_id)
    .single();

  if (issueErr || !issue) return jsonError('Issue not found', 404);

  const { data, error } = await supabase
    .from('improvement_recommendations')
    .insert({
      issue_id,
      recommendation,
      impact_estimate: impact_estimate || null,
      effort_estimate: effort_estimate || null,
      risk_level: risk_level || null,
      affected_files: Array.isArray(affected_files) ? affected_files : null,
      agent_owner: agent_owner || null,
    })
    .select()
    .single();

  if (error) return jsonError(error.message, 500);

  await logAdminAudit(auth, 'create_improvement_recommendation', 'improvement_recommendation', data.id, { issue_id, recommendation: recommendation.slice(0, 200) }, ip);

  return NextResponse.json({ success: true, data }, { status: 201 });
}

async function createExecution(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  body: Record<string, unknown>,
  auth: AdminAuth,
  ip: string,
) {
  const { recommendation_id, execution_type } = body;

  if (!recommendation_id || typeof recommendation_id !== 'string') return jsonError('recommendation_id is required');
  if (!execution_type || !VALID_EXECUTION_TYPES.includes(execution_type as typeof VALID_EXECUTION_TYPES[number])) {
    return jsonError(`execution_type must be one of: ${VALID_EXECUTION_TYPES.join(', ')}`);
  }

  // Verify recommendation exists
  const { data: rec, error: recErr } = await supabase
    .from('improvement_recommendations')
    .select('id')
    .eq('id', recommendation_id)
    .single();

  if (recErr || !rec) return jsonError('Recommendation not found', 404);

  const { data, error } = await supabase
    .from('improvement_executions')
    .insert({
      recommendation_id,
      execution_type,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return jsonError(error.message, 500);

  await logAdminAudit(auth, 'create_improvement_execution', 'improvement_execution', data.id, { recommendation_id, execution_type }, ip);

  return NextResponse.json({ success: true, data }, { status: 201 });
}

// ── PATCH ────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const supabase = getSupabaseAdmin();
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const ip = getIp(request);

  try {
    const body = await request.json();

    switch (action) {
      case 'issue':
        return await updateIssue(supabase, body, auth, ip);
      case 'recommendation':
        return await updateRecommendation(supabase, body, auth, ip);
      case 'execution':
        return await updateExecution(supabase, body, auth, ip);
      default:
        return jsonError(`Unknown action: ${action}. Use ?action=issue|recommendation|execution`);
    }
  } catch (err) {
    logger.error('improvement_api_patch_error', { error: err instanceof Error ? err : new Error(String(err)), action });
    return jsonError('Internal server error', 500);
  }
}

async function updateIssue(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  body: Record<string, unknown>,
  auth: AdminAuth,
  ip: string,
) {
  const { id, updates } = body as { id?: string; updates?: Record<string, unknown> };
  if (!id || typeof id !== 'string') return jsonError('id is required');
  if (!updates || typeof updates !== 'object') return jsonError('updates object is required');

  const allowedFields: Record<string, unknown> = {};

  if (updates.status !== undefined) {
    if (!VALID_ISSUE_STATUSES.includes(updates.status as typeof VALID_ISSUE_STATUSES[number])) {
      return jsonError(`Invalid status. Must be one of: ${VALID_ISSUE_STATUSES.join(', ')}`);
    }
    allowedFields.status = updates.status;
    if (updates.status === 'resolved') {
      allowedFields.resolved_at = new Date().toISOString();
    }
  }
  if (updates.severity !== undefined) {
    if (!VALID_SEVERITIES.includes(updates.severity as typeof VALID_SEVERITIES[number])) {
      return jsonError(`Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}`);
    }
    allowedFields.severity = updates.severity;
  }
  if (updates.assigned_agent !== undefined) {
    allowedFields.assigned_agent = updates.assigned_agent;
  }
  if (updates.description !== undefined) {
    allowedFields.description = updates.description;
  }

  if (Object.keys(allowedFields).length === 0) {
    return jsonError('No valid fields to update');
  }

  const { data, error } = await supabase
    .from('improvement_issues')
    .update(allowedFields)
    .eq('id', id)
    .select()
    .single();

  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError('Issue not found', 404);

  await logAdminAudit(auth, 'update_improvement_issue', 'improvement_issue', id, { updates: allowedFields }, ip);

  return jsonOk(data);
}

async function updateRecommendation(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  body: Record<string, unknown>,
  auth: AdminAuth,
  ip: string,
) {
  const { id, updates } = body as { id?: string; updates?: Record<string, unknown> };
  if (!id || typeof id !== 'string') return jsonError('id is required');
  if (!updates || typeof updates !== 'object') return jsonError('updates object is required');

  const allowedFields: Record<string, unknown> = {};

  if (updates.status !== undefined) {
    if (!VALID_RECOMMENDATION_STATUSES.includes(updates.status as typeof VALID_RECOMMENDATION_STATUSES[number])) {
      return jsonError(`Invalid status. Must be one of: ${VALID_RECOMMENDATION_STATUSES.join(', ')}`);
    }
    allowedFields.status = updates.status;
    if (updates.status === 'approved') {
      allowedFields.approved_at = new Date().toISOString();
      allowedFields.approved_by = auth.email;
    }
  }
  if (updates.approved_by !== undefined && updates.status !== 'approved') {
    // Only allow explicit approved_by if not auto-setting from approval
    allowedFields.approved_by = updates.approved_by;
  }

  if (Object.keys(allowedFields).length === 0) {
    return jsonError('No valid fields to update');
  }

  const { data, error } = await supabase
    .from('improvement_recommendations')
    .update(allowedFields)
    .eq('id', id)
    .select()
    .single();

  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError('Recommendation not found', 404);

  await logAdminAudit(auth, 'update_improvement_recommendation', 'improvement_recommendation', id, { updates: allowedFields }, ip);

  return jsonOk(data);
}

async function updateExecution(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  body: Record<string, unknown>,
  auth: AdminAuth,
  ip: string,
) {
  const { id, updates } = body as { id?: string; updates?: Record<string, unknown> };
  if (!id || typeof id !== 'string') return jsonError('id is required');
  if (!updates || typeof updates !== 'object') return jsonError('updates object is required');

  const allowedFields: Record<string, unknown> = {};

  if (updates.status !== undefined) {
    if (!VALID_EXECUTION_STATUSES.includes(updates.status as typeof VALID_EXECUTION_STATUSES[number])) {
      return jsonError(`Invalid status. Must be one of: ${VALID_EXECUTION_STATUSES.join(', ')}`);
    }
    allowedFields.status = updates.status;
    if (updates.status === 'deployed') {
      allowedFields.completed_at = new Date().toISOString();
    }
    if (updates.status === 'rolled_back') {
      allowedFields.rolled_back_at = new Date().toISOString();
    }
  }
  if (updates.staging_url !== undefined) allowedFields.staging_url = updates.staging_url;
  if (updates.deploy_commit !== undefined) allowedFields.deploy_commit = updates.deploy_commit;
  if (updates.test_results !== undefined) allowedFields.test_results = updates.test_results;
  if (updates.rollback_reason !== undefined) allowedFields.rollback_reason = updates.rollback_reason;

  if (Object.keys(allowedFields).length === 0) {
    return jsonError('No valid fields to update');
  }

  const { data, error } = await supabase
    .from('improvement_executions')
    .update(allowedFields)
    .eq('id', id)
    .select()
    .single();

  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError('Execution not found', 404);

  await logAdminAudit(auth, 'update_improvement_execution', 'improvement_execution', id, { updates: allowedFields }, ip);

  return jsonOk(data);
}
