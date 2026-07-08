/**
 * The LLM-as-planner agent loop.
 *
 * Spec: docs/superpowers/specs/2026-05-10-llm-planner-loop-design.md §4.2
 */

import { callClaude } from '@alfanumrik/lib/ai/clients/claude';
import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import type { ChatMessage, ContentBlock, ToolResultBlock } from '../types';
import {
  DEFAULT_BUDGET,
  BudgetExceeded,
  type AgentBudget,
  type AgentContext,
  type AgentResult,
  type AgentRunStatus,
  type ToolDefinition,
} from './types';
import { BudgetTracker } from './budget';
import { createRegistry } from './registry';
import { startRun, persistStep, finalizeRun, redactByDefault } from './trace';

export interface RunAgentArgs {
  agentName: string;
  systemPrompt: string;
  userPrompt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: ReadonlyArray<ToolDefinition<any, any>>;
  budget?: Partial<AgentBudget>;
  ctx?: Partial<AgentContext>;
  /** Override Claude model (default: primary from getAIConfig). */
  model?: string;
}

export async function runAgent(args: RunAgentArgs): Promise<AgentResult> {
  const budget: AgentBudget = { ...DEFAULT_BUDGET, ...(args.budget ?? {}) };
  const ctx: AgentContext = {
    userId: args.ctx?.userId ?? null,
    meta: args.ctx?.meta ?? {},
  };
  const tracker = new BudgetTracker(budget);
  const registry = createRegistry(args.tools);

  const runId = await startRun({
    agentName: args.agentName,
    userId: ctx.userId,
    contextMeta: ctx.meta,
  });

  const messages: ChatMessage[] = [{ role: 'user', content: args.userPrompt }];
  let finalText = '';
  let stepNumber = 0;
  let status: AgentRunStatus = 'unknown_error';
  let errorMessage: string | null = null;

  try {
    while (true) {
      tracker.assertWallTime();
      tracker.incrementStep();
      stepNumber += 1;

      const llmStart = Date.now();
      const response = await callClaude({
        systemPrompt: args.systemPrompt,
        messages,
        tools: registry.schemas(),
        toolChoice: registry.schemas().length > 0 ? { type: 'auto' } : undefined,
        model: args.model,
      });
      const llmDurationMs = Date.now() - llmStart;

      tracker.recordTokens(response.inputTokens, response.outputTokens);

      await persistStep({
        runId,
        stepNumber,
        stepType: 'llm_call',
        durationMs: llmDurationMs,
        llm: {
          model: response.model,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          stopReason: response.stopReason,
        },
      });

      tracker.assertTokens();

      if (response.stopReason === 'end_turn') {
        finalText = response.content;
        status = 'success';
        break;
      }

      if (response.stopReason === 'max_tokens') {
        throw new BudgetExceeded('max_tokens');
      }

      if (response.stopReason === 'tool_use') {
        // Echo assistant content blocks back into the conversation.
        messages.push({ role: 'assistant', content: response.contentBlocks });

        const toolUseBlocks = response.contentBlocks.filter(
          (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
        );

        const toolResults: ToolResultBlock[] = [];

        for (const tu of toolUseBlocks) {
          stepNumber += 1;
          const dispatch = await registry.dispatch(tu.name, tu.input, ctx);
          const redactor = registry.getRedactor(tu.name);
          const redacted = redactor
            ? redactor(tu.input as never, dispatch.ok ? (dispatch.output as never) : null)
            : {
                input: redactByDefault(tu.input),
                output: redactByDefault(dispatch.ok ? dispatch.output : null),
              };

          await persistStep({
            runId,
            stepNumber,
            stepType: 'tool_call',
            durationMs: dispatch.durationMs,
            tool: {
              name: tu.name,
              inputRedacted: redacted.input,
              outputRedacted: redacted.output,
              error: dispatch.ok ? null : dispatch.error,
            },
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: dispatch.ok ? JSON.stringify(dispatch.output) : dispatch.error,
            is_error: !dispatch.ok,
          });
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Unexpected stop_reason: treat as failure.
      errorMessage = `Unexpected stop_reason: ${response.stopReason}`;
      status = 'llm_failure';
      throw new Error(errorMessage);
    }
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      status = 'budget_exceeded';
      errorMessage = err.message;
    } else if (status === 'unknown_error') {
      status = 'llm_failure';
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    logger.warn('agent_run_failed', {
      agentName: args.agentName,
      runId,
      status,
      error: errorMessage,
    });
    await logOpsEvent({
      category: 'ai',
      source: 'runAgent',
      severity: 'warning',
      message: `Agent ${args.agentName} failed: ${status}`,
      context: { run_id: runId, error: errorMessage },
    });

    const usage = tracker.snapshot();
    await finalizeRun({
      runId,
      status,
      stepCount: usage.steps,
      tokensInput: usage.tokensInput,
      tokensOutput: usage.tokensOutput,
      finalTextRedacted: null,
      errorMessage,
    });

    throw err;
  }

  const usage = tracker.snapshot();
  await finalizeRun({
    runId,
    status,
    stepCount: usage.steps,
    tokensInput: usage.tokensInput,
    tokensOutput: usage.tokensOutput,
    finalTextRedacted: finalText.slice(0, 2000),
    errorMessage: null,
  });

  return {
    finalText,
    runId,
    stepCount: usage.steps,
    tokensInput: usage.tokensInput,
    tokensOutput: usage.tokensOutput,
    status: 'success',
  };
}
