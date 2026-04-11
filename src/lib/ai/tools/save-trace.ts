/**
 * Persistence adapters for AI workflow traces and content flagging.
 *
 * Best-effort, fire-and-forget — failures are logged but never thrown.
 * No PII is stored (P13): only session IDs, topics, and quality metrics.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import type { WorkflowTrace } from '../types';

export async function saveTrace(trace: WorkflowTrace): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('ai_workflow_traces').insert({
      trace_id: trace.traceId,
      workflow: trace.workflow,
      started_at: trace.startedAt,
      total_duration_ms: trace.totalDurationMs,
      steps: trace.steps,
      student_id: trace.studentId ?? null,
      session_id: trace.sessionId ?? null,
      intent: trace.intent ?? null,
      model: trace.model ?? null,
      tokens_used: trace.tokensUsed ?? null,
      error: trace.error ?? null,
    });

    if (error) {
      // Table may not exist yet — log warning, don't crash
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        logger.warn('ai_workflow_traces table does not exist, skipping trace save', {
          traceId: trace.traceId,
        });
        return;
      }
      logger.warn('Failed to save workflow trace', {
        traceId: trace.traceId,
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn('Unexpected error saving trace', {
      traceId: trace.traceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function flagContent(params: {
  chunkId: string;
  reason: string;
  flaggedBy: string;
}): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('rag_content_flags').insert({
      chunk_id: params.chunkId,
      reason: params.reason,
      flagged_by: params.flaggedBy,
      created_at: new Date().toISOString(),
    });

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        logger.warn('rag_content_flags table does not exist, skipping flag', {
          chunkId: params.chunkId,
        });
        return;
      }
      logger.warn('Failed to flag content', {
        chunkId: params.chunkId,
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn('Unexpected error flagging content', {
      chunkId: params.chunkId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
