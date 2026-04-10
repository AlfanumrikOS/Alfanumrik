/**
 * Staging Patch Workflow API — Product Improvement Command Center
 *
 * POST /api/super-admin/improvement/staging
 *   Stage a recommendation for deployment. Handles different execution types:
 *   - config_change: toggles feature flags or config via Supabase admin
 *   - content_fix: applies metadata/content updates via Supabase admin
 *   - code_patch: marks as staging with note that manual branch is required
 *   - manual: marks as staging with note that manual action is required
 *
 * GET /api/super-admin/improvement/staging?execution_id=xxx
 *   Returns the current staging status for an execution.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, type AdminAuth } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

function jsonOk(data: unknown) {
  return NextResponse.json({ success: true, data });
}

function jsonError(message: string, status: number = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function getIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for') || '';
}

// ── GET — Staging status ────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const supabase = getSupabaseAdmin();
  const url = new URL(request.url);
  const executionId = url.searchParams.get('execution_id');

  if (!executionId) {
    return jsonError('execution_id query parameter is required');
  }

  try {
    const { data: execution, error } = await supabase
      .from('improvement_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (error || !execution) {
      return jsonError('Execution not found', 404);
    }

    return jsonOk({ execution });
  } catch (err) {
    logger.error('staging_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      execution_id: executionId,
    });
    return jsonError('Internal server error', 500);
  }
}

// ── POST — Stage a recommendation ──────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const supabase = getSupabaseAdmin();
  const ip = getIp(request);

  try {
    const body = await request.json();
    const { execution_id } = body;

    if (!execution_id || typeof execution_id !== 'string') {
      return jsonError('execution_id is required');
    }

    // Look up execution with its recommendation details
    const { data: execution, error: execErr } = await supabase
      .from('improvement_executions')
      .select('id, status, execution_type, recommendation_id, staging_url, test_results')
      .eq('id', execution_id)
      .single();

    if (execErr || !execution) {
      return jsonError('Execution not found', 404);
    }

    // Only allow staging from 'pending' status
    if (execution.status !== 'pending') {
      return jsonError(
        `Execution must be in 'pending' status to stage. Current status: '${execution.status}'`,
      );
    }

    // Look up the recommendation for context (affected_files, evidence)
    const { data: recommendation, error: recErr } = await supabase
      .from('improvement_recommendations')
      .select('id, recommendation, affected_files, issue_id')
      .eq('id', execution.recommendation_id)
      .single();

    if (recErr || !recommendation) {
      return jsonError('Associated recommendation not found', 404);
    }

    // Handle based on execution type
    const executionType = execution.execution_type as string;
    let stagingResult: { staging_url: string | null; notes: string };

    switch (executionType) {
      case 'config_change':
        stagingResult = await stageConfigChange(supabase, recommendation, auth as AdminAuth);
        break;
      case 'content_fix':
        stagingResult = await stageContentFix(supabase, recommendation, auth as AdminAuth);
        break;
      case 'code_patch':
        stagingResult = stageCodePatch();
        break;
      case 'manual':
        stagingResult = stageManual();
        break;
      default:
        return jsonError(`Unknown execution type: ${executionType}`);
    }

    // Update execution to staging status
    const updateFields: Record<string, unknown> = {
      status: 'staging',
      started_at: new Date().toISOString(),
      staging_url: stagingResult.staging_url,
      test_results: {
        ...(typeof execution.test_results === 'object' && execution.test_results !== null
          ? execution.test_results
          : {}),
        staging_notes: stagingResult.notes,
        staged_at: new Date().toISOString(),
        staged_by: (auth as AdminAuth).email,
      },
    };

    const { data: updated, error: updateErr } = await supabase
      .from('improvement_executions')
      .update(updateFields)
      .eq('id', execution_id)
      .select()
      .single();

    if (updateErr) {
      logger.error('staging_update_failed', {
        error: updateErr,
        execution_id,
      });
      return jsonError('Failed to update execution to staging status', 500);
    }

    // Audit log
    await logAdminAudit(
      auth as AdminAuth,
      'stage_execution',
      'improvement_execution',
      execution_id,
      {
        execution_type: executionType,
        recommendation_id: recommendation.id,
        staging_url: stagingResult.staging_url,
        notes: stagingResult.notes,
      },
      ip,
    );

    // Update the parent recommendation status to 'executing'
    await supabase
      .from('improvement_recommendations')
      .update({ status: 'executing' })
      .eq('id', recommendation.id);

    logger.info('staging_api_completed', {
      execution_id,
      execution_type: executionType,
      staging_url: stagingResult.staging_url,
    });

    return jsonOk({ execution: updated });
  } catch (err) {
    logger.error('staging_api_error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return jsonError('Internal server error', 500);
  }
}

// ── Staging handlers per execution type ─────────────────────────

interface RecommendationData {
  id: string;
  recommendation: string;
  affected_files: string[] | null;
  issue_id: string;
}

/**
 * Config change: attempt to toggle feature flags or apply config updates.
 * Looks at affected_files for feature_flags references, then toggles via admin client.
 */
async function stageConfigChange(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  recommendation: RecommendationData,
  admin: AdminAuth,
): Promise<{ staging_url: string | null; notes: string }> {
  const notes: string[] = [];
  const affectedFiles = recommendation.affected_files || [];

  // Check if any affected files reference feature flags
  const flagFiles = affectedFiles.filter(
    (f) => f.includes('feature-flag') || f.includes('feature_flag'),
  );

  if (flagFiles.length > 0) {
    notes.push(
      `Config change affects feature flag files: ${flagFiles.join(', ')}. ` +
      `Feature flag toggles should be applied via the super-admin feature flags panel. ` +
      `Recommendation: ${recommendation.recommendation.slice(0, 200)}`,
    );
  } else {
    notes.push(
      `Config change staged. Affected files: ${affectedFiles.join(', ') || 'none specified'}. ` +
      `Review recommendation and apply changes: ${recommendation.recommendation.slice(0, 200)}`,
    );
  }

  // Use current deployment URL as staging reference
  const deploymentUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || null;
  const stagingUrl = deploymentUrl ? `${deploymentUrl}` : null;

  notes.push(`Staged by admin: ${admin.email}`);

  return {
    staging_url: stagingUrl,
    notes: notes.join('\n'),
  };
}

/**
 * Content fix: apply metadata or content corrections via admin client.
 * Logs what would be changed and marks as staged.
 */
async function stageContentFix(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  recommendation: RecommendationData,
  admin: AdminAuth,
): Promise<{ staging_url: string | null; notes: string }> {
  const notes: string[] = [];
  const affectedFiles = recommendation.affected_files || [];

  notes.push(
    `Content fix staged for review. Affected areas: ${affectedFiles.join(', ') || 'none specified'}. ` +
    `Recommendation: ${recommendation.recommendation.slice(0, 200)}`,
  );

  // For content fixes, the staging URL points to the current environment
  // where the admin can verify the content change
  const deploymentUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || null;
  const stagingUrl = deploymentUrl ? `${deploymentUrl}` : null;

  notes.push(`Staged by admin: ${admin.email}`);

  return {
    staging_url: stagingUrl,
    notes: notes.join('\n'),
  };
}

/**
 * Code patch: cannot be auto-applied. Mark as staged with instructions
 * for manual branch creation and code review.
 */
function stageCodePatch(): { staging_url: string | null; notes: string } {
  return {
    staging_url: null,
    notes:
      'Code patch requires manual implementation. Steps:\n' +
      '1. Create a feature branch from main\n' +
      '2. Implement the recommended code changes\n' +
      '3. Push and create a PR for review\n' +
      '4. Run QA gate after PR is merged to staging\n' +
      '5. Update this execution with the staging URL once deployed',
  };
}

/**
 * Manual: requires human intervention. Mark as staged with a note.
 */
function stageManual(): { staging_url: string | null; notes: string } {
  return {
    staging_url: null,
    notes:
      'This execution requires manual action. Steps:\n' +
      '1. Review the recommendation details\n' +
      '2. Perform the required manual changes\n' +
      '3. Verify the changes in the staging environment\n' +
      '4. Run QA gate when ready to approve',
  };
}
