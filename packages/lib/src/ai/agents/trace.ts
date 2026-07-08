/**
 * Persistence helpers for agent_runs / agent_steps.
 * Best-effort: failures are logged (warn) but never thrown — agent execution
 * must not be blocked by trace persistence issues.
 */

import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import type { AgentRunStatus } from './types';

export interface StartRunArgs {
  agentName: string;
  userId: string | null;
  contextMeta: Record<string, unknown>;
}

export async function startRun(args: StartRunArgs): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin
      .from('agent_runs')
      .insert({
        agent_name: args.agentName,
        status: 'unknown_error', // overwritten by finalizeRun
        user_id: args.userId,
        context_meta: args.contextMeta,
      })
      .select()
      .single();

    if (error || !data) {
      logger.warn('agent_runs insert failed', {
        agentName: args.agentName,
        error: error?.message ?? 'no data',
      });
      return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return data.id as string;
  } catch (err) {
    logger.warn('agent_runs insert threw', {
      agentName: args.agentName,
      error: err instanceof Error ? err.message : String(err),
    });
    return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export interface PersistStepArgs {
  runId: string;
  stepNumber: number;
  stepType: 'llm_call' | 'tool_call';
  durationMs: number;
  llm?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    stopReason: string | null;
  };
  tool?: {
    name: string;
    inputRedacted: unknown;
    outputRedacted: unknown;
    error: string | null;
  };
}

export async function persistStep(args: PersistStepArgs): Promise<void> {
  try {
    const row = {
      run_id: args.runId,
      step_number: args.stepNumber,
      step_type: args.stepType,
      duration_ms: args.durationMs,
      tool_name: args.tool?.name ?? null,
      tool_input_redacted: args.tool?.inputRedacted ?? null,
      tool_output_redacted: args.tool?.outputRedacted ?? null,
      tool_error: args.tool?.error ?? null,
      llm_model: args.llm?.model ?? null,
      llm_input_tokens: args.llm?.inputTokens ?? null,
      llm_output_tokens: args.llm?.outputTokens ?? null,
      llm_stop_reason: args.llm?.stopReason ?? null,
    };
    const { error } = await supabaseAdmin.from('agent_steps').insert(row);
    if (error) {
      logger.warn('agent_steps insert failed', {
        runId: args.runId,
        stepNumber: args.stepNumber,
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn('agent_steps insert threw', {
      runId: args.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface FinalizeRunArgs {
  runId: string;
  status: AgentRunStatus;
  stepCount: number;
  tokensInput: number;
  tokensOutput: number;
  finalTextRedacted: string | null;
  errorMessage: string | null;
}

export async function finalizeRun(args: FinalizeRunArgs): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('agent_runs')
      .update({
        status: args.status,
        step_count: args.stepCount,
        tokens_input: args.tokensInput,
        tokens_output: args.tokensOutput,
        final_text_redacted: args.finalTextRedacted,
        error_message: args.errorMessage,
        ended_at: new Date().toISOString(),
      })
      .eq('id', args.runId);
    if (error) {
      logger.warn('agent_runs finalize failed', { runId: args.runId, error: error.message });
    }
  } catch (err) {
    logger.warn('agent_runs finalize threw', {
      runId: args.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Default redactor: replaces all values with "[REDACTED]" for objects,
 * returns "[REDACTED]" for primitives, null for null/undefined.
 * Used when a tool does not declare its own `redactInTrace`.
 */
export function redactByDefault(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return '[REDACTED]';
  if (Array.isArray(value)) return value.map(() => '[REDACTED]');
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out[k] = '[REDACTED]';
  }
  return out;
}
