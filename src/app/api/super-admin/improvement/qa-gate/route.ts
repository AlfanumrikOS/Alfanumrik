/**
 * QA Gate API — Product Improvement Command Center
 *
 * POST /api/super-admin/improvement/qa-gate
 * Triggers the QA gate (type-check, lint, test, build) for an execution,
 * stores results, and advances/fails the execution status.
 *
 * Body: { execution_id: string }
 *
 * Flow:
 *   1. Verify admin auth
 *   2. Validate execution exists and is in staging/pending status
 *   3. Set status to 'testing'
 *   4. Run QA gate checks
 *   5. Store results in test_results JSONB
 *   6. If passed → status = 'approved', set completed_at
 *   7. If failed → status = 'failed'
 *   8. Audit log the action
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, type AdminAuth } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { runQAGate, type QAGateResult } from '@/lib/improvement-qa-gate';
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

const ELIGIBLE_STATUSES = ['staging', 'pending'] as const;

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

    // Look up execution and verify it is eligible for QA gate
    const { data: execution, error: fetchErr } = await supabase
      .from('improvement_executions')
      .select('id, status, recommendation_id, execution_type')
      .eq('id', execution_id)
      .single();

    if (fetchErr || !execution) {
      return jsonError('Execution not found', 404);
    }

    if (!ELIGIBLE_STATUSES.includes(execution.status as typeof ELIGIBLE_STATUSES[number])) {
      return jsonError(
        `Execution must be in 'staging' or 'pending' status to run QA gate. Current status: '${execution.status}'`,
      );
    }

    // Transition to 'testing' while the gate runs
    const { error: testingErr } = await supabase
      .from('improvement_executions')
      .update({ status: 'testing' })
      .eq('id', execution_id);

    if (testingErr) {
      logger.error('qa_gate_status_update_failed', {
        error: testingErr,
        execution_id,
        target_status: 'testing',
      });
      return jsonError('Failed to update execution status to testing', 500);
    }

    // Run the QA gate — this may take several minutes
    let qaResult: QAGateResult;
    try {
      qaResult = await runQAGate();
    } catch (err) {
      // If the QA gate itself throws, mark execution as failed
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('qa_gate_execution_error', {
        error: err instanceof Error ? err : new Error(errMsg),
        execution_id,
      });

      await supabase
        .from('improvement_executions')
        .update({
          status: 'failed',
          test_results: { error: errMsg, ran_at: new Date().toISOString() },
        })
        .eq('id', execution_id);

      await logAdminAudit(
        auth as AdminAuth,
        'qa_gate_error',
        'improvement_execution',
        execution_id,
        { error: errMsg },
        ip,
      );

      return jsonError(`QA gate encountered an error: ${errMsg}`, 500);
    }

    // Determine final status based on QA result
    const finalStatus = qaResult.passed ? 'approved' : 'failed';
    const updateFields: Record<string, unknown> = {
      status: finalStatus,
      test_results: qaResult,
    };

    if (qaResult.passed) {
      updateFields.completed_at = new Date().toISOString();
    }

    const { data: updated, error: updateErr } = await supabase
      .from('improvement_executions')
      .update(updateFields)
      .eq('id', execution_id)
      .select()
      .single();

    if (updateErr) {
      logger.error('qa_gate_final_update_failed', {
        error: updateErr,
        execution_id,
        final_status: finalStatus,
      });
      return jsonError('Failed to store QA gate results', 500);
    }

    // Audit log
    await logAdminAudit(
      auth as AdminAuth,
      qaResult.passed ? 'qa_gate_passed' : 'qa_gate_failed',
      'improvement_execution',
      execution_id,
      {
        passed: qaResult.passed,
        type_check: qaResult.type_check.passed,
        lint: qaResult.lint.passed,
        tests: qaResult.tests.passed,
        build: qaResult.build.passed,
        test_count: qaResult.tests.total,
        test_passed: qaResult.tests.passed_count,
        test_failed: qaResult.tests.failed_count,
      },
      ip,
    );

    logger.info('qa_gate_api_completed', {
      execution_id,
      passed: qaResult.passed,
      final_status: finalStatus,
    });

    return jsonOk({
      execution: updated,
      qa_result: qaResult,
    });
  } catch (err) {
    logger.error('qa_gate_api_error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return jsonError('Internal server error', 500);
  }
}
