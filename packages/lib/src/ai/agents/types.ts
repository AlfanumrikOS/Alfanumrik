/**
 * Types for the LLM-as-planner agent loop.
 *
 * See docs/superpowers/specs/2026-05-10-llm-planner-loop-design.md
 */

import type { ContentBlock } from '../types';

export interface JSONSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: JSONSchema;
}

export interface AgentContext {
  /** User on whose behalf the agent runs (null for system-initiated agents). */
  readonly userId: string | null;
  /** Free-form context, never persisted in raw form. */
  readonly meta: Record<string, unknown>;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (input: I, ctx: AgentContext) => Promise<O>;
  /** Optional: redact PII before persisting to agent_steps. Default: full redaction. */
  redactInTrace?: (input: I, output: O | null) => { input: unknown; output: unknown };
}

export interface AgentBudget {
  maxSteps: number;
  maxTotalTokens: number;
  maxWallMs: number;
}

export const DEFAULT_BUDGET: AgentBudget = {
  maxSteps: 8,
  maxTotalTokens: 50_000,
  maxWallMs: 30_000,
};

export type AgentRunStatus =
  | 'success'
  | 'budget_exceeded'
  | 'tool_failure'
  | 'llm_failure'
  | 'unknown_error';

export interface AgentResult {
  finalText: string;
  runId: string;
  stepCount: number;
  tokensInput: number;
  tokensOutput: number;
  status: 'success';
}

export interface DispatchOk {
  ok: true;
  output: unknown;
  durationMs: number;
}

export interface DispatchErr {
  ok: false;
  error: string;
  durationMs: number;
}

export type DispatchResult = DispatchOk | DispatchErr;

export class BudgetExceeded extends Error {
  constructor(public readonly reason: 'max_steps' | 'max_tokens' | 'max_wall_ms') {
    super(`Agent budget exceeded: ${reason}`);
    this.name = 'BudgetExceeded';
  }
}

/** Re-export for convenience. */
export type { ContentBlock };
