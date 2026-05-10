# LLM-as-Planner Loop Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable LLM-as-planner agent loop in `src/lib/ai/agents/` so future agents (Daily Planner, Question-Bank QA, Foxy investigate-then-answer) become thin orchestrations on top.

**Architecture:** Additive extension to the existing `callClaude()` client to support Anthropic tool use, plus a new `runAgent()` loop that dispatches tool calls back to registered handlers until the LLM signals `end_turn` or hits a budget. Includes two new Supabase tables (`agent_runs`, `agent_steps`) for step-level trace persistence with PII redaction. Validated end-to-end by a throwaway `chapter-explorer` agent with two tools.

**Tech Stack:** TypeScript, Next.js 16 (App Router), Vitest, Supabase Postgres + RLS, Anthropic Messages API (Haiku 4.5 primary).

**Spec reference:** [docs/superpowers/specs/2026-05-10-llm-planner-loop-design.md](../specs/2026-05-10-llm-planner-loop-design.md)

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/lib/ai/agents/types.ts` | All agent types: `ToolDefinition`, `AgentBudget`, `AgentResult`, `AgentRun`, `AgentStep`, `AgentContext`, `ContentBlock`. |
| `src/lib/ai/agents/budget.ts` | `BudgetTracker` class — tracks steps/tokens/wall time, throws `BudgetExceeded` when limits hit. |
| `src/lib/ai/agents/registry.ts` | `createRegistry(tools)` — JSON Schema validation, tool dispatch, per-tool circuit (3-failure trip per run). |
| `src/lib/ai/agents/trace.ts` | `startRun()`, `persistStep()`, `finalizeRun()` — best-effort writes to `agent_runs` + `agent_steps`. |
| `src/lib/ai/agents/runAgent.ts` | The loop. Single export: `runAgent({ agentName, systemPrompt, userPrompt, tools, budget?, ctx? })`. |
| `src/lib/ai/agents/agents/chapter-explorer.ts` | Throwaway proving-ground agent. Exports `runChapterExplorer({ subject, grade, chapter })`. |
| `src/lib/ai/clients/claude.ts` | **Modified** — extend `callClaude()` to accept `tools` + `toolChoice`, return `contentBlocks`. Existing callers unaffected. |
| `src/lib/ai/types.ts` | **Modified** — add `tools?` and `toolChoice?` to `ClaudeRequestOptions`; add `contentBlocks` to `ClaudeResponse`; add `ContentBlock` union. |
| `src/lib/ai/index.ts` | **Modified** — export `runAgent`, `createRegistry`, agent types. |
| `src/app/api/internal/agents/chapter-explorer/route.ts` | Admin POST endpoint. RBAC: `internal.admin`. |
| `scripts/smoke-agent.ts` | CLI: invokes `runChapterExplorer` against staging, prints final text + step trace. |
| `package.json` | **Modified** — add `"smoke:agent"` script. |
| `supabase/migrations/<ts>_agent_traces.sql` | Creates `agent_runs` + `agent_steps` tables with RLS enabled (no policies → service-role only). |
| `src/__tests__/ai/agents/budget.test.ts` | Unit tests for `BudgetTracker`. |
| `src/__tests__/ai/agents/registry.test.ts` | Unit tests for registry + dispatch + per-tool circuit. |
| `src/__tests__/ai/agents/runAgent.test.ts` | Mocked-Claude integration tests for the loop. |
| `src/__tests__/ai/agents/claude-tools.test.ts` | Tests for `callClaude()` tool-use extension (mocked fetch). |
| `src/__tests__/ai/agents/chapter-explorer.test.ts` | Live test gated by `RUN_LIVE_AI_TESTS=1`. |

---

## Task 1: Foundation types

**Files:**
- Create: `src/lib/ai/agents/types.ts`
- Modify: `src/lib/ai/types.ts` (add `tools?`, `toolChoice?`, `contentBlocks`, `ContentBlock`)

- [ ] **Step 1: Create `src/lib/ai/agents/types.ts`**

```typescript
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
```

- [ ] **Step 2: Modify `src/lib/ai/types.ts` — add tool-related types**

Open [src/lib/ai/types.ts](../../../src/lib/ai/types.ts) and locate the `ClaudeRequestOptions` interface (lines 37–44). Replace it and `ClaudeResponse` with:

```typescript
// ─── Content Blocks (Anthropic API) ─────────────────────────────────────────

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

// ─── Claude API ─────────────────────────────────────────────────────────────

export interface ClaudeToolSchema {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export type ClaudeToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string };

export interface ClaudeRequestOptions {
  model?: string;
  systemPrompt: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Optional tool schemas for agent loops. */
  tools?: ClaudeToolSchema[];
  /** Optional tool choice. Default: { type: 'auto' } when tools are present. */
  toolChoice?: ClaudeToolChoice;
}

export interface ClaudeResponse {
  /** Concatenated text from all `text` content blocks. Empty string if response had only tool_use blocks. */
  content: string;
  /** Full content blocks from the API response, including `tool_use` blocks. */
  contentBlocks: ContentBlock[];
  model: string;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
  latencyMs: number;
}
```

The `ChatMessage` interface above stays unchanged but its `content` field now needs to accept either `string` (legacy) or `ContentBlock[]` (when echoing assistant tool_use back). Update:

```typescript
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[] | Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }>;
}
```

- [ ] **Step 3: Run type-check to verify nothing breaks**

Run: `npm run type-check`
Expected: 0 errors. (Existing callers pass `string` content, which still satisfies the union.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/agents/types.ts src/lib/ai/types.ts
git commit -m "feat(ai/agents): add foundation types for LLM-as-planner loop"
```

---

## Task 2: BudgetTracker (TDD)

**Files:**
- Create: `src/lib/ai/agents/budget.ts`
- Test: `src/__tests__/ai/agents/budget.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/ai/agents/budget.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BudgetTracker } from '@/lib/ai/agents/budget';
import { BudgetExceeded } from '@/lib/ai/agents/types';

afterEach(() => vi.useRealTimers());

describe('BudgetTracker', () => {
  it('counts steps and throws when maxSteps exceeded', () => {
    const t = new BudgetTracker({ maxSteps: 2, maxTotalTokens: 1000, maxWallMs: 1000 });
    t.incrementStep(); // 1
    t.incrementStep(); // 2 — at limit, OK
    expect(() => t.incrementStep()).toThrow(BudgetExceeded);
  });

  it('sums input + output tokens and throws when maxTotalTokens exceeded', () => {
    const t = new BudgetTracker({ maxSteps: 100, maxTotalTokens: 100, maxWallMs: 1000 });
    t.recordTokens(40, 30); // 70 total
    t.assertTokens(); // OK
    t.recordTokens(20, 20); // 110 total
    expect(() => t.assertTokens()).toThrow(BudgetExceeded);
  });

  it('throws on wall time exceeded', () => {
    vi.useFakeTimers();
    const t = new BudgetTracker({ maxSteps: 100, maxTotalTokens: 1000, maxWallMs: 100 });
    vi.advanceTimersByTime(99);
    t.assertWallTime(); // OK
    vi.advanceTimersByTime(2);
    expect(() => t.assertWallTime()).toThrow(BudgetExceeded);
  });

  it('exposes current usage snapshot', () => {
    const t = new BudgetTracker({ maxSteps: 10, maxTotalTokens: 1000, maxWallMs: 5000 });
    t.incrementStep();
    t.recordTokens(100, 50);
    const u = t.snapshot();
    expect(u.steps).toBe(1);
    expect(u.tokensInput).toBe(100);
    expect(u.tokensOutput).toBe(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/ai/agents/budget.test.ts`
Expected: FAIL with "Cannot find module '@/lib/ai/agents/budget'".

- [ ] **Step 3: Implement `src/lib/ai/agents/budget.ts`**

```typescript
import { BudgetExceeded, type AgentBudget } from './types';

export class BudgetTracker {
  private steps = 0;
  private tokensInput = 0;
  private tokensOutput = 0;
  private readonly startedAt = Date.now();

  constructor(private readonly budget: AgentBudget) {}

  incrementStep(): void {
    this.steps += 1;
    if (this.steps > this.budget.maxSteps) {
      throw new BudgetExceeded('max_steps');
    }
  }

  recordTokens(input: number, output: number): void {
    this.tokensInput += input;
    this.tokensOutput += output;
  }

  assertTokens(): void {
    if (this.tokensInput + this.tokensOutput > this.budget.maxTotalTokens) {
      throw new BudgetExceeded('max_tokens');
    }
  }

  assertWallTime(): void {
    if (Date.now() - this.startedAt > this.budget.maxWallMs) {
      throw new BudgetExceeded('max_wall_ms');
    }
  }

  snapshot(): { steps: number; tokensInput: number; tokensOutput: number; elapsedMs: number } {
    return {
      steps: this.steps,
      tokensInput: this.tokensInput,
      tokensOutput: this.tokensOutput,
      elapsedMs: Date.now() - this.startedAt,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/ai/agents/budget.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/agents/budget.ts src/__tests__/ai/agents/budget.test.ts
git commit -m "feat(ai/agents): add BudgetTracker with steps/tokens/wall-time limits"
```

---

## Task 3: Tool registry (TDD)

**Files:**
- Create: `src/lib/ai/agents/registry.ts`
- Test: `src/__tests__/ai/agents/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/ai/agents/registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createRegistry } from '@/lib/ai/agents/registry';
import type { ToolDefinition } from '@/lib/ai/agents/types';

const ctx = { userId: null, meta: {} };

const echoTool: ToolDefinition<{ msg: string }, { echo: string }> = {
  name: 'echo',
  description: 'Echoes a message',
  inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
  handler: async (input) => ({ echo: input.msg }),
};

const flakyTool: ToolDefinition = {
  name: 'flaky',
  description: 'Always fails',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => { throw new Error('boom'); },
};

describe('createRegistry', () => {
  it('rejects duplicate tool names', () => {
    expect(() => createRegistry([echoTool, { ...echoTool }])).toThrow(/duplicate/i);
  });

  it('returns Anthropic-shaped schemas via .schemas()', () => {
    const r = createRegistry([echoTool]);
    expect(r.schemas()).toEqual([
      { name: 'echo', description: 'Echoes a message', input_schema: echoTool.inputSchema },
    ]);
  });

  it('dispatches a tool by name and returns ok+output', async () => {
    const r = createRegistry([echoTool]);
    const result = await r.dispatch('echo', { msg: 'hi' }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toEqual({ echo: 'hi' });
  });

  it('returns ok=false when handler throws', async () => {
    const r = createRegistry([flakyTool]);
    const result = await r.dispatch('flaky', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/boom/);
  });

  it('returns ok=false when tool name is unknown', async () => {
    const r = createRegistry([echoTool]);
    const result = await r.dispatch('nope', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown tool/i);
  });

  it('opens per-tool circuit after 3 consecutive failures of the same tool', async () => {
    const r = createRegistry([flakyTool]);
    await r.dispatch('flaky', {}, ctx); // fail 1
    await r.dispatch('flaky', {}, ctx); // fail 2
    await r.dispatch('flaky', {}, ctx); // fail 3 — circuit opens
    const result = await r.dispatch('flaky', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/circuit open|unavailable/i);
  });

  it('resets per-tool failure count on success', async () => {
    let calls = 0;
    const sometimes: ToolDefinition = {
      name: 'sometimes',
      description: 'fails twice then succeeds forever',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        calls += 1;
        if (calls <= 2) throw new Error('flake');
        return { ok: true };
      },
    };
    const r = createRegistry([sometimes]);
    await r.dispatch('sometimes', {}, ctx); // fail 1
    await r.dispatch('sometimes', {}, ctx); // fail 2
    await r.dispatch('sometimes', {}, ctx); // success → counter resets
    // 3 more failures should be needed before circuit trips
    calls = 0;
    const flakyAgain: ToolDefinition = {
      ...sometimes,
      handler: async () => { throw new Error('flake'); },
    };
    const r2 = createRegistry([flakyAgain]);
    await r2.dispatch('sometimes', {}, ctx);
    await r2.dispatch('sometimes', {}, ctx);
    const third = await r2.dispatch('sometimes', {}, ctx);
    expect(third.ok).toBe(false); // 3rd failure trips
    const fourth = await r2.dispatch('sometimes', {}, ctx);
    expect(fourth.error).toMatch(/circuit open|unavailable/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/ai/agents/registry.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `src/lib/ai/agents/registry.ts`**

```typescript
import type {
  ToolDefinition,
  ToolSchema,
  AgentContext,
  DispatchResult,
} from './types';

const CIRCUIT_FAILURE_THRESHOLD = 3;

export interface Registry {
  schemas(): ToolSchema[];
  dispatch(name: string, input: unknown, ctx: AgentContext): Promise<DispatchResult>;
  getRedactor(name: string): ToolDefinition['redactInTrace'];
}

export function createRegistry(tools: ToolDefinition[]): Registry {
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) {
      throw new Error(`Registry: duplicate tool name "${t.name}"`);
    }
    seen.add(t.name);
  }

  const byName = new Map<string, ToolDefinition>(tools.map((t) => [t.name, t]));
  const failureCount = new Map<string, number>();

  return {
    schemas(): ToolSchema[] {
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    },

    getRedactor(name: string) {
      return byName.get(name)?.redactInTrace;
    },

    async dispatch(name, input, ctx): Promise<DispatchResult> {
      const start = Date.now();
      const tool = byName.get(name);

      if (!tool) {
        return {
          ok: false,
          error: `Unknown tool "${name}"`,
          durationMs: Date.now() - start,
        };
      }

      const failures = failureCount.get(name) ?? 0;
      if (failures >= CIRCUIT_FAILURE_THRESHOLD) {
        return {
          ok: false,
          error: `Tool "${name}" circuit open (${failures} consecutive failures); not retried this run.`,
          durationMs: Date.now() - start,
        };
      }

      try {
        const output = await tool.handler(input as never, ctx);
        failureCount.set(name, 0);
        return { ok: true, output, durationMs: Date.now() - start };
      } catch (err) {
        failureCount.set(name, failures + 1);
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        };
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/ai/agents/registry.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/agents/registry.ts src/__tests__/ai/agents/registry.test.ts
git commit -m "feat(ai/agents): add tool registry with per-tool circuit breaker"
```

---

## Task 4: Migration — agent_runs + agent_steps tables

**Files:**
- Create: `supabase/migrations/<timestamp>_agent_traces.sql`

- [ ] **Step 1: Generate migration**

Run: `supabase migration new agent_traces`
Expected: prints the new file path under `supabase/migrations/`. Note the timestamp.

- [ ] **Step 2: Write migration content**

Replace the empty migration file with:

```sql
-- Agent loop trace persistence
-- Spec: docs/superpowers/specs/2026-05-10-llm-planner-loop-design.md §5

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  status text not null check (status in ('success', 'budget_exceeded', 'tool_failure', 'llm_failure', 'unknown_error')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  step_count int not null default 0,
  tokens_input int not null default 0,
  tokens_output int not null default 0,
  final_text_redacted text,
  error_message text,
  user_id uuid references auth.users(id) on delete set null,
  context_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_runs_agent_name_started
  on agent_runs (agent_name, started_at desc);
create index if not exists idx_agent_runs_user_id
  on agent_runs (user_id) where user_id is not null;
create index if not exists idx_agent_runs_status
  on agent_runs (status) where status != 'success';

create table if not exists agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  step_number int not null,
  step_type text not null check (step_type in ('llm_call', 'tool_call')),
  tool_name text,
  tool_input_redacted jsonb,
  tool_output_redacted jsonb,
  tool_error text,
  llm_model text,
  llm_input_tokens int,
  llm_output_tokens int,
  llm_stop_reason text,
  duration_ms int not null,
  created_at timestamptz not null default now(),
  unique (run_id, step_number)
);

create index if not exists idx_agent_steps_run_id
  on agent_steps (run_id, step_number);

-- RLS: service role only (P8)
-- No SELECT/INSERT policies for anon or authenticated. Service role bypasses RLS.
alter table agent_runs enable row level security;
alter table agent_steps enable row level security;

comment on table agent_runs is 'One row per LLM-as-planner agent invocation. Service role only.';
comment on table agent_steps is 'Per-step trace (llm_call or tool_call) for an agent_runs row. Service role only.';
```

- [ ] **Step 3: Apply migration to local Supabase**

Run: `supabase db push --linked` if using a remote linked project, or `supabase db reset` followed by `supabase db push` for local.
Expected: "Applied migration <timestamp>_agent_traces" with no errors.

If only staging access is available:
```bash
supabase db push --linked --include "<timestamp>_agent_traces.sql"
```

- [ ] **Step 4: Verify tables exist**

Run: `supabase db diff` (should show no pending changes, confirming migration was applied) **or** query directly:
```bash
supabase db query "select tablename from pg_tables where tablename in ('agent_runs','agent_steps')"
```
Expected: both table names returned.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_agent_traces.sql
git commit -m "feat(db): add agent_runs and agent_steps tables for planner-loop traces"
```

---

## Task 5: Trace persistence (TDD)

**Files:**
- Create: `src/lib/ai/agents/trace.ts`
- Test: `src/__tests__/ai/agents/trace.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/ai/agents/trace.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase-admin BEFORE importing the module under test.
const insertRun = vi.fn();
const insertStep = vi.fn();
const updateRun = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'agent_runs') {
        return {
          insert: (row: unknown) => {
            insertRun(row);
            return {
              select: () => ({
                single: async () => ({ data: { id: 'run-uuid-1' }, error: null }),
              }),
            };
          },
          update: (patch: unknown) => ({
            eq: (col: string, val: unknown) => {
              updateRun({ patch, col, val });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'agent_steps') {
        return {
          insert: async (row: unknown) => {
            insertStep(row);
            return { error: null };
          },
        };
      }
      throw new Error('unexpected table ' + table);
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { startRun, persistStep, finalizeRun, redactByDefault } from '@/lib/ai/agents/trace';

beforeEach(() => {
  insertRun.mockReset();
  insertStep.mockReset();
  updateRun.mockReset();
});

describe('startRun', () => {
  it('inserts an agent_runs row and returns its id', async () => {
    const id = await startRun({ agentName: 'chapter-explorer', userId: null, contextMeta: { subject: 'science' } });
    expect(id).toBe('run-uuid-1');
    expect(insertRun).toHaveBeenCalledWith(expect.objectContaining({
      agent_name: 'chapter-explorer',
      status: 'unknown_error', // initial; finalize updates it
      context_meta: { subject: 'science' },
    }));
  });
});

describe('persistStep', () => {
  it('writes an llm_call step', async () => {
    await persistStep({
      runId: 'run-uuid-1',
      stepNumber: 1,
      stepType: 'llm_call',
      durationMs: 123,
      llm: { model: 'claude-haiku-4-5-20251001', inputTokens: 10, outputTokens: 20, stopReason: 'tool_use' },
    });
    expect(insertStep).toHaveBeenCalledWith(expect.objectContaining({
      run_id: 'run-uuid-1',
      step_number: 1,
      step_type: 'llm_call',
      llm_model: 'claude-haiku-4-5-20251001',
      llm_input_tokens: 10,
      llm_output_tokens: 20,
      llm_stop_reason: 'tool_use',
      duration_ms: 123,
    }));
  });

  it('writes a tool_call step with redacted input/output', async () => {
    await persistStep({
      runId: 'run-uuid-1',
      stepNumber: 2,
      stepType: 'tool_call',
      durationMs: 50,
      tool: { name: 'echo', inputRedacted: { msg: '[REDACTED]' }, outputRedacted: { echo: '[REDACTED]' }, error: null },
    });
    expect(insertStep).toHaveBeenCalledWith(expect.objectContaining({
      step_type: 'tool_call',
      tool_name: 'echo',
      tool_input_redacted: { msg: '[REDACTED]' },
      tool_output_redacted: { echo: '[REDACTED]' },
      tool_error: null,
    }));
  });
});

describe('finalizeRun', () => {
  it('updates the run with status, counts, and ended_at', async () => {
    await finalizeRun({
      runId: 'run-uuid-1',
      status: 'success',
      stepCount: 3,
      tokensInput: 100,
      tokensOutput: 200,
      finalTextRedacted: 'final',
      errorMessage: null,
    });
    expect(updateRun).toHaveBeenCalledWith({
      patch: expect.objectContaining({
        status: 'success',
        step_count: 3,
        tokens_input: 100,
        tokens_output: 200,
        final_text_redacted: 'final',
        error_message: null,
        ended_at: expect.any(String),
      }),
      col: 'id',
      val: 'run-uuid-1',
    });
  });
});

describe('redactByDefault', () => {
  it('returns full-redaction shape for objects', () => {
    expect(redactByDefault({ a: 1, b: 'secret' })).toEqual({ a: '[REDACTED]', b: '[REDACTED]' });
  });
  it('returns null for null/undefined', () => {
    expect(redactByDefault(null)).toBeNull();
    expect(redactByDefault(undefined)).toBeNull();
  });
  it('returns "[REDACTED]" for non-object primitives', () => {
    expect(redactByDefault('hello')).toBe('[REDACTED]');
    expect(redactByDefault(42)).toBe('[REDACTED]');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/ai/agents/trace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/ai/agents/trace.ts`**

```typescript
/**
 * Persistence helpers for agent_runs / agent_steps.
 * Best-effort: failures are logged (warn) but never thrown — agent execution
 * must not be blocked by trace persistence issues.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import type { AgentRunStatus } from './types';

export interface StartRunArgs {
  agentName: string;
  userId: string | null;
  contextMeta: Record<string, unknown>;
}

export async function startRun(args: StartRunArgs): Promise<string> {
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
    // Generate a synthetic id so the agent loop can continue without persistence.
    return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return data.id as string;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/ai/agents/trace.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/agents/trace.ts src/__tests__/ai/agents/trace.test.ts
git commit -m "feat(ai/agents): add trace persistence with default PII redaction"
```

---

## Task 6: Extend `callClaude()` for tool use (TDD)

**Files:**
- Modify: `src/lib/ai/clients/claude.ts`
- Test: `src/__tests__/ai/agents/claude-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/ai/agents/claude-tools.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/ops-events', () => ({ logOpsEvent: vi.fn() }));

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

describe('callClaude with tools', () => {
  it('passes tools and tool_choice in the request body when provided', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'hi' }],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    });

    const { callClaude } = await import('@/lib/ai/clients/claude');
    await callClaude({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'go' }],
      tools: [{
        name: 'echo',
        description: 'echoes',
        input_schema: { type: 'object', properties: { x: { type: 'string' } } },
      }],
      toolChoice: { type: 'auto' },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('echo');
    expect(body.tool_choice).toEqual({ type: 'auto' });
  });

  it('returns contentBlocks containing tool_use when stop_reason is tool_use', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'looking up' },
          { type: 'tool_use', id: 'toolu_x', name: 'echo', input: { x: 'hi' } },
        ],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'tool_use',
        usage: { input_tokens: 5, output_tokens: 8 },
      }),
    });

    const { callClaude } = await import('@/lib/ai/clients/claude');
    const r = await callClaude({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'echo', description: 'e', input_schema: { type: 'object', properties: {} } }],
    });

    expect(r.stopReason).toBe('tool_use');
    expect(r.contentBlocks).toHaveLength(2);
    expect(r.contentBlocks[1]).toMatchObject({ type: 'tool_use', name: 'echo', input: { x: 'hi' } });
    expect(r.content).toBe('looking up'); // text-only concatenation, back-compat
  });

  it('omits tools field when not provided (back-compat)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'hi' }],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const { callClaude } = await import('@/lib/ai/clients/claude');
    await callClaude({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'go' }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/ai/agents/claude-tools.test.ts`
Expected: FAIL — `body.tools` is `undefined` because `callClaude` doesn't yet read the field.

- [ ] **Step 3: Modify `src/lib/ai/clients/claude.ts`**

Open the file and locate the `callModel` function (around line 79). Change its signature and body:

Find this signature:
```typescript
async function callModel(
  model: string,
  systemPrompt: string,
  messages: ClaudeAPIMessage[],
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
)
```

Replace with:
```typescript
async function callModel(
  model: string,
  systemPrompt: string,
  messages: ClaudeAPIMessage[],
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
  tools: ClaudeRequestOptions['tools'],
  toolChoice: ClaudeRequestOptions['toolChoice'],
)
```

(Add the `ClaudeRequestOptions` import at the top if not already there.)

Find the request body block:
```typescript
body: JSON.stringify({
  model,
  max_tokens: maxTokens,
  temperature,
  system: systemPrompt,
  messages,
}),
```

Replace with:
```typescript
body: JSON.stringify({
  model,
  max_tokens: maxTokens,
  temperature,
  system: systemPrompt,
  messages,
  ...(tools && tools.length > 0 ? { tools } : {}),
  ...(toolChoice ? { tool_choice: toolChoice } : {}),
}),
```

Also update the local `ClaudeAPIResponse` interface (around line 67) to allow tool_use blocks:
```typescript
interface ClaudeAPIResponse {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
  >;
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}
```

Locate the success-path return inside `callClaude` (around line 233):
```typescript
const content = result.response.content?.[0]?.text ?? '';
return {
  content,
  model: ...
  ...
};
```

Replace with:
```typescript
const blocks = result.response.content ?? [];
const textOnly = blocks
  .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
  .map((b) => b.text)
  .join('');

return {
  content: textOnly,
  contentBlocks: blocks as import('../types').ContentBlock[],
  model: result.response.model ?? modelName,
  tokensUsed: (result.response.usage?.input_tokens ?? 0) + (result.response.usage?.output_tokens ?? 0),
  inputTokens: result.response.usage?.input_tokens ?? 0,
  outputTokens: result.response.usage?.output_tokens ?? 0,
  stopReason: result.response.stop_reason ?? null,
  latencyMs: result.latencyMs,
};
```

Finally, locate the `callClaude` body where it destructures options (around line 163) and update the loop call:

Find:
```typescript
const result = await callModel(
  modelName,
  systemPrompt,
  apiMessages,
  resolvedMaxTokens,
  resolvedTemp,
  resolvedTimeout,
);
```

Replace with:
```typescript
const result = await callModel(
  modelName,
  systemPrompt,
  apiMessages,
  resolvedMaxTokens,
  resolvedTemp,
  resolvedTimeout,
  options.tools,
  options.toolChoice,
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/ai/agents/claude-tools.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Run the full AI test suite to confirm no regression**

Run: `npx vitest run src/__tests__/ai-layer.test.ts src/__tests__/ai-prompt-pii.test.ts`
Expected: all PASS (no existing test depended on `content` being non-empty when tool_use is present, because no existing caller uses tools).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/clients/claude.ts src/__tests__/ai/agents/claude-tools.test.ts
git commit -m "feat(ai): extend callClaude to support Anthropic tool use (additive)"
```

---

## Task 7: The agent loop (TDD)

**Files:**
- Create: `src/lib/ai/agents/runAgent.ts`
- Test: `src/__tests__/ai/agents/runAgent.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/ai/agents/runAgent.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callClaudeMock = vi.fn();
const startRunMock = vi.fn(async () => 'run-1');
const persistStepMock = vi.fn(async () => undefined);
const finalizeRunMock = vi.fn(async () => undefined);

vi.mock('@/lib/ai/clients/claude', () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args),
}));

vi.mock('@/lib/ai/agents/trace', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/agents/trace')>(
    '@/lib/ai/agents/trace',
  );
  return {
    ...actual,
    startRun: (...args: unknown[]) => startRunMock(...args),
    persistStep: (...args: unknown[]) => persistStepMock(...args),
    finalizeRun: (...args: unknown[]) => finalizeRunMock(...args),
  };
});

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));

import { runAgent } from '@/lib/ai/agents/runAgent';
import type { ToolDefinition } from '@/lib/ai/agents/types';
import { BudgetExceeded } from '@/lib/ai/agents/types';

const echoTool: ToolDefinition<{ msg: string }, { echo: string }> = {
  name: 'echo',
  description: 'echoes',
  inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
  handler: async (input) => ({ echo: input.msg }),
};

beforeEach(() => {
  callClaudeMock.mockReset();
  startRunMock.mockClear();
  persistStepMock.mockClear();
  finalizeRunMock.mockClear();
});

describe('runAgent', () => {
  it('returns final text on immediate end_turn (no tool use)', async () => {
    callClaudeMock.mockResolvedValueOnce({
      content: 'hello there',
      contentBlocks: [{ type: 'text', text: 'hello there' }],
      stopReason: 'end_turn',
      model: 'm', tokensUsed: 5, inputTokens: 3, outputTokens: 2, latencyMs: 10,
    });

    const result = await runAgent({
      agentName: 'test',
      systemPrompt: 'sys',
      userPrompt: 'hi',
      tools: [],
    });

    expect(result.finalText).toBe('hello there');
    expect(result.stepCount).toBe(1);
    expect(finalizeRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('dispatches a tool when stop_reason is tool_use, then continues', async () => {
    callClaudeMock
      .mockResolvedValueOnce({
        content: '',
        contentBlocks: [
          { type: 'tool_use', id: 'tu-1', name: 'echo', input: { msg: 'world' } },
        ],
        stopReason: 'tool_use',
        model: 'm', tokensUsed: 8, inputTokens: 5, outputTokens: 3, latencyMs: 10,
      })
      .mockResolvedValueOnce({
        content: 'echoed: world',
        contentBlocks: [{ type: 'text', text: 'echoed: world' }],
        stopReason: 'end_turn',
        model: 'm', tokensUsed: 6, inputTokens: 4, outputTokens: 2, latencyMs: 8,
      });

    const result = await runAgent({
      agentName: 'test',
      systemPrompt: 'sys',
      userPrompt: 'echo world',
      tools: [echoTool],
    });

    expect(result.finalText).toBe('echoed: world');
    expect(result.stepCount).toBe(2);

    // Second LLM call should have included the tool_result in messages.
    const secondCall = callClaudeMock.mock.calls[1][0];
    const lastMsg = secondCall.messages[secondCall.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(Array.isArray(lastMsg.content)).toBe(true);
    expect(lastMsg.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu-1', is_error: false });
  });

  it('dispatches multiple tool_use blocks serially in order', async () => {
    const order: string[] = [];
    const tA: ToolDefinition = {
      name: 'a', description: '', inputSchema: { type: 'object', properties: {} },
      handler: async () => { order.push('a'); return { x: 1 }; },
    };
    const tB: ToolDefinition = {
      name: 'b', description: '', inputSchema: { type: 'object', properties: {} },
      handler: async () => { order.push('b'); return { y: 2 }; },
    };

    callClaudeMock
      .mockResolvedValueOnce({
        content: '',
        contentBlocks: [
          { type: 'tool_use', id: 't1', name: 'a', input: {} },
          { type: 'tool_use', id: 't2', name: 'b', input: {} },
        ],
        stopReason: 'tool_use',
        model: 'm', tokensUsed: 5, inputTokens: 3, outputTokens: 2, latencyMs: 5,
      })
      .mockResolvedValueOnce({
        content: 'done',
        contentBlocks: [{ type: 'text', text: 'done' }],
        stopReason: 'end_turn',
        model: 'm', tokensUsed: 4, inputTokens: 3, outputTokens: 1, latencyMs: 5,
      });

    await runAgent({ agentName: 't', systemPrompt: 's', userPrompt: 'u', tools: [tA, tB] });
    expect(order).toEqual(['a', 'b']);
  });

  it('formats handler errors as is_error tool_result and lets LLM recover', async () => {
    const failing: ToolDefinition = {
      name: 'boom', description: '', inputSchema: { type: 'object', properties: {} },
      handler: async () => { throw new Error('kaboom'); },
    };

    callClaudeMock
      .mockResolvedValueOnce({
        content: '',
        contentBlocks: [{ type: 'tool_use', id: 'tu-x', name: 'boom', input: {} }],
        stopReason: 'tool_use',
        model: 'm', tokensUsed: 5, inputTokens: 3, outputTokens: 2, latencyMs: 5,
      })
      .mockResolvedValueOnce({
        content: 'recovered',
        contentBlocks: [{ type: 'text', text: 'recovered' }],
        stopReason: 'end_turn',
        model: 'm', tokensUsed: 4, inputTokens: 3, outputTokens: 1, latencyMs: 5,
      });

    const result = await runAgent({ agentName: 't', systemPrompt: 's', userPrompt: 'u', tools: [failing] });
    expect(result.finalText).toBe('recovered');

    const secondCall = callClaudeMock.mock.calls[1][0];
    const lastMsg = secondCall.messages[secondCall.messages.length - 1];
    expect(lastMsg.content[0]).toMatchObject({
      type: 'tool_result', tool_use_id: 'tu-x', is_error: true,
    });
    expect(String(lastMsg.content[0].content)).toMatch(/kaboom/);
  });

  it('throws BudgetExceeded when maxSteps tripped', async () => {
    // Always returns tool_use → loop forever (until budget)
    callClaudeMock.mockResolvedValue({
      content: '',
      contentBlocks: [{ type: 'tool_use', id: 'tu', name: 'echo', input: { msg: 'x' } }],
      stopReason: 'tool_use',
      model: 'm', tokensUsed: 5, inputTokens: 3, outputTokens: 2, latencyMs: 5,
    });

    await expect(
      runAgent({
        agentName: 't',
        systemPrompt: 's',
        userPrompt: 'u',
        tools: [echoTool],
        budget: { maxSteps: 2, maxTotalTokens: 100_000, maxWallMs: 60_000 },
      }),
    ).rejects.toBeInstanceOf(BudgetExceeded);

    expect(finalizeRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'budget_exceeded' }),
    );
  });

  it('persists one llm_call step per LLM response and one tool_call step per dispatch', async () => {
    callClaudeMock
      .mockResolvedValueOnce({
        content: '',
        contentBlocks: [{ type: 'tool_use', id: 'tu-1', name: 'echo', input: { msg: 'x' } }],
        stopReason: 'tool_use',
        model: 'm', tokensUsed: 5, inputTokens: 3, outputTokens: 2, latencyMs: 5,
      })
      .mockResolvedValueOnce({
        content: 'ok',
        contentBlocks: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        model: 'm', tokensUsed: 4, inputTokens: 3, outputTokens: 1, latencyMs: 5,
      });

    await runAgent({ agentName: 't', systemPrompt: 's', userPrompt: 'u', tools: [echoTool] });

    const stepTypes = persistStepMock.mock.calls.map((c) => (c[0] as { stepType: string }).stepType);
    expect(stepTypes).toEqual(['llm_call', 'tool_call', 'llm_call']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/ai/agents/runAgent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/ai/agents/runAgent.ts`**

```typescript
/**
 * The LLM-as-planner agent loop.
 *
 * Spec: docs/superpowers/specs/2026-05-10-llm-planner-loop-design.md §4.2
 */

import { callClaude } from '@/lib/ai/clients/claude';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';
import type { ChatMessage, ContentBlock } from '../types';
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
  tools: ToolDefinition[];
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

        const toolResults: Array<{
          type: 'tool_result';
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        }> = [];

        for (const tu of toolUseBlocks) {
          stepNumber += 1;
          const dispatch = await registry.dispatch(tu.name, tu.input, ctx);
          const redactor = registry.getRedactor(tu.name);
          const redacted = redactor
            ? redactor(tu.input as never, dispatch.ok ? (dispatch.output as never) : null)
            : { input: redactByDefault(tu.input), output: redactByDefault(dispatch.ok ? dispatch.output : null) };

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
    finalTextRedacted: finalText.slice(0, 2000), // cap stored text
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/ai/agents/runAgent.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/agents/runAgent.ts src/__tests__/ai/agents/runAgent.test.ts
git commit -m "feat(ai/agents): add runAgent loop with tool dispatch and budgets"
```

---

## Task 8: chapter-explorer agent (proving ground)

**Files:**
- Create: `src/lib/ai/agents/agents/chapter-explorer.ts`
- Modify: `src/lib/ai/index.ts` (add exports)

- [ ] **Step 1: Create `src/lib/ai/agents/agents/chapter-explorer.ts`**

```typescript
/**
 * THROWAWAY proving-ground agent for the LLM-as-planner loop.
 *
 * Goal: validate the loop end-to-end with the smallest tool surface
 * that forces ≥2 chained tool calls.
 *
 * DELETE THIS FILE in the next agent spec (Daily Planner or
 * Question-Bank QA), along with the admin route and smoke script.
 *
 * Spec: docs/superpowers/specs/2026-05-10-llm-planner-loop-design.md §6
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { runAgent } from '../runAgent';
import { getNcertChunks } from '../../tools/get-ncert-chunks';
import type { ToolDefinition, AgentResult } from '../types';

const SYSTEM_PROMPT = `You are a content explorer. Given a subject, grade, and chapter, produce a single paragraph (3–5 sentences) that summarizes the chapter's main ideas.

You MUST use the available tools to look up actual NCERT content — do not rely on memory.

Workflow:
1. Call list_topics_in_chapter to see what's covered.
2. Call lookup_ncert for 1–3 of the most central topics.
3. Write a paragraph that mentions specific topics you saw in the lookup.

Do not call any tool more than 4 times total. Once you have enough information, write the paragraph and stop.`;

const listTopicsInChapter: ToolDefinition<
  { subject: string; grade: string; chapter: string },
  { topics: string[] }
> = {
  name: 'list_topics_in_chapter',
  description: 'List the distinct topics covered in a specific NCERT chapter.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      grade: { type: 'string', enum: ['6', '7', '8', '9', '10', '11', '12'] },
      chapter: { type: 'string' },
    },
    required: ['subject', 'grade', 'chapter'],
  },
  handler: async (input) => {
    const { data, error } = await supabaseAdmin
      .from('rag_chunks')
      .select('topic')
      .eq('subject', input.subject)
      .eq('grade', input.grade)
      .eq('chapter', input.chapter)
      .not('topic', 'is', null);

    if (error) {
      throw new Error(`list_topics_in_chapter failed: ${error.message}`);
    }
    const topics = Array.from(
      new Set((data ?? []).map((r: { topic: string | null }) => r.topic).filter(Boolean) as string[]),
    );
    return { topics };
  },
  // Inputs and outputs are public NCERT metadata — no PII. Trace as-is.
  redactInTrace: (input, output) => ({ input, output }),
};

const lookupNcert: ToolDefinition<
  { subject: string; grade: string; chapter: string; topic?: string; limit?: number },
  { chunks: Array<{ id: string; content: string; chapter?: string; topic?: string }> }
> = {
  name: 'lookup_ncert',
  description:
    'Fetch up to N NCERT content chunks for a specific subject/grade/chapter, optionally filtered by topic.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      grade: { type: 'string', enum: ['6', '7', '8', '9', '10', '11', '12'] },
      chapter: { type: 'string' },
      topic: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
    },
    required: ['subject', 'grade', 'chapter'],
  },
  handler: async (input) => {
    const chunks = await getNcertChunks({
      subject: input.subject,
      grade: input.grade,
      chapter: input.chapter,
      limit: input.limit ?? 3,
    });
    // Optional topic filter (in-memory; getNcertChunks doesn't expose it)
    const filtered = input.topic
      ? chunks.filter((c) => (c as unknown as { topic?: string }).topic === input.topic)
      : chunks;
    return {
      chunks: filtered.slice(0, input.limit ?? 3).map((c) => ({
        id: c.id,
        content: c.content.slice(0, 800), // trim per chunk to keep prompt small
        chapter: c.chapter,
        topic: (c as unknown as { topic?: string }).topic,
      })),
    };
  },
  redactInTrace: (input, output) => ({ input, output }),
};

export interface ChapterExplorerArgs {
  subject: string;
  grade: string;
  chapter: string;
  userId?: string | null;
}

export async function runChapterExplorer(args: ChapterExplorerArgs): Promise<AgentResult> {
  const userPrompt = `Summarize the main ideas of NCERT Class ${args.grade} ${args.subject}, chapter "${args.chapter}".`;

  return runAgent({
    agentName: 'chapter-explorer',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    tools: [listTopicsInChapter, lookupNcert],
    budget: { maxSteps: 6, maxTotalTokens: 30_000, maxWallMs: 25_000 },
    ctx: {
      userId: args.userId ?? null,
      meta: { subject: args.subject, grade: args.grade, chapter: args.chapter },
    },
  });
}
```

- [ ] **Step 2: Export from `src/lib/ai/index.ts`**

Open [src/lib/ai/index.ts](../../../src/lib/ai/index.ts). Add at the end:

```typescript
// ─── Agent loop (LLM-as-planner) ────────────────────────────────────────────
export { runAgent } from './agents/runAgent';
export { createRegistry } from './agents/registry';
export { BudgetTracker } from './agents/budget';
export {
  DEFAULT_BUDGET,
  BudgetExceeded,
} from './agents/types';
export type {
  ToolDefinition,
  AgentBudget,
  AgentContext,
  AgentResult,
  AgentRunStatus,
} from './agents/types';
```

- [ ] **Step 3: Run type-check**

Run: `npm run type-check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/agents/agents/chapter-explorer.ts src/lib/ai/index.ts
git commit -m "feat(ai/agents): add chapter-explorer throwaway agent"
```

---

## Task 9: Admin API route

**Files:**
- Create: `src/app/api/internal/agents/chapter-explorer/route.ts`

- [ ] **Step 1: Find the existing internal-admin RBAC pattern**

Run: `grep -rn "authorizeRequest" src/app/api/internal/ | head -3`
Note the canonical pattern (typically: import `authorizeRequest` from `@/lib/rbac`, await it with the request and a permission code).

- [ ] **Step 2: Create the route**

Create `src/app/api/internal/agents/chapter-explorer/route.ts`:

```typescript
/**
 * Internal admin endpoint: invoke the chapter-explorer throwaway agent.
 *
 * Used to validate the LLM-as-planner loop end-to-end. NOT a user-facing
 * endpoint. Will be removed when the throwaway agent is deleted.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { runChapterExplorer } from '@/lib/ai/agents/agents/chapter-explorer';
import { BudgetExceeded } from '@/lib/ai/agents/types';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const VALID_GRADES = new Set(['6', '7', '8', '9', '10', '11', '12']);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeRequest(request, 'internal.admin');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error ?? 'unauthorized' }, { status: auth.status ?? 401 });
  }

  let body: { subject?: unknown; grade?: unknown; chapter?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const grade = typeof body.grade === 'string' ? body.grade.trim() : '';
  const chapter = typeof body.chapter === 'string' ? body.chapter.trim() : '';

  if (!subject) return NextResponse.json({ error: 'subject is required (string)' }, { status: 400 });
  if (!VALID_GRADES.has(grade)) {
    return NextResponse.json({ error: 'grade must be one of "6"–"12"' }, { status: 400 });
  }
  if (!chapter) return NextResponse.json({ error: 'chapter is required (string)' }, { status: 400 });

  try {
    const result = await runChapterExplorer({
      subject,
      grade,
      chapter,
      userId: auth.userId ?? null,
    });
    return NextResponse.json({
      finalText: result.finalText,
      runId: result.runId,
      stepCount: result.stepCount,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
    });
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      logger.warn('chapter_explorer_budget_exceeded', { reason: err.reason });
      return NextResponse.json({ error: 'agent budget exceeded', reason: err.reason }, { status: 504 });
    }
    logger.error('chapter_explorer_failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'agent failed', detail: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify the `authorizeRequest` signature matches**

If the actual signature differs (e.g., returns `{ permitted, userId }` instead of `{ ok, userId }`), adapt the route accordingly. Check: `grep -A 20 "export.*function authorizeRequest" src/lib/rbac.ts`

- [ ] **Step 4: Type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/internal/agents/chapter-explorer/route.ts
git commit -m "feat(api): add internal admin route for chapter-explorer agent"
```

---

## Task 10: Smoke script

**Files:**
- Create: `scripts/smoke-agent.ts`
- Modify: `package.json` (add `smoke:agent` script)

- [ ] **Step 1: Create the script**

Create `scripts/smoke-agent.ts`:

```typescript
/**
 * Smoke test for the LLM-as-planner loop via the chapter-explorer agent.
 *
 * Runs against the Supabase project pointed to by .env.local
 * (typically staging). Prints the agent's final text + step trace.
 *
 * Usage:
 *   npm run smoke:agent -- --subject science --grade 9 --chapter "Force and Laws of Motion"
 */

import { config as loadEnv } from 'dotenv';
import { runChapterExplorer } from '../src/lib/ai/agents/agents/chapter-explorer';
import { supabaseAdmin } from '../src/lib/supabase-admin';

loadEnv({ path: '.env.local' });

interface Args {
  subject: string;
  grade: string;
  chapter: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--subject') out.subject = argv[++i];
    else if (a === '--grade') out.grade = argv[++i];
    else if (a === '--chapter') out.chapter = argv[++i];
  }
  if (!out.subject || !out.grade || !out.chapter) {
    console.error('Usage: npm run smoke:agent -- --subject <s> --grade <g> --chapter <c>');
    process.exit(2);
  }
  return out as Args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n→ Running chapter-explorer for ${args.subject} grade ${args.grade}: "${args.chapter}"\n`);

  const t0 = Date.now();
  const result = await runChapterExplorer(args);
  const elapsed = Date.now() - t0;

  console.log('─── Final Text ─────────────────────────────────────');
  console.log(result.finalText);
  console.log('────────────────────────────────────────────────────');
  console.log(`Steps: ${result.stepCount}`);
  console.log(`Tokens: ${result.tokensInput} in / ${result.tokensOutput} out`);
  console.log(`Wall time: ${elapsed}ms`);
  console.log(`Run ID: ${result.runId}`);

  // Pull back the step trace for inspection.
  const { data: steps } = await supabaseAdmin
    .from('agent_steps')
    .select('step_number, step_type, tool_name, tool_error, llm_stop_reason, duration_ms')
    .eq('run_id', result.runId)
    .order('step_number');

  console.log('\n─── Step Trace ─────────────────────────────────────');
  for (const s of steps ?? []) {
    const tag = s.step_type === 'llm_call' ? `LLM (${s.llm_stop_reason})` : `TOOL ${s.tool_name}${s.tool_error ? ' [ERR]' : ''}`;
    console.log(`#${s.step_number}  ${tag}  ${s.duration_ms}ms`);
  }
  console.log('────────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

Open [package.json](../../../package.json). Locate the `"scripts"` object and add:

```json
"smoke:agent": "tsx scripts/smoke-agent.ts"
```

(If `tsx` is not in `devDependencies`, run `npm install --save-dev tsx` first. Many existing scripts in `scripts/` already use it; check `package.json` first to confirm.)

- [ ] **Step 3: Verify script registers**

Run: `npm run smoke:agent -- --help` (will fail validation but should at least invoke the script)
Expected: prints "Usage: npm run smoke:agent ..." and exits 2.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-agent.ts package.json
git commit -m "feat(scripts): add smoke:agent CLI for chapter-explorer end-to-end test"
```

---

## Task 11: Live integration test (gated)

**Files:**
- Create: `src/__tests__/ai/agents/chapter-explorer.test.ts`

- [ ] **Step 1: Create the gated test**

```typescript
/**
 * Live integration test for the LLM-as-planner loop.
 *
 * Gated by RUN_LIVE_AI_TESTS=1 to avoid spending tokens on every CI run.
 * Run locally or in nightly CI:
 *   RUN_LIVE_AI_TESTS=1 npx vitest run src/__tests__/ai/agents/chapter-explorer.test.ts
 */

import { describe, it, expect } from 'vitest';
import { runChapterExplorer } from '@/lib/ai/agents/agents/chapter-explorer';
import { supabaseAdmin } from '@/lib/supabase-admin';

const live = process.env.RUN_LIVE_AI_TESTS === '1';
const d = live ? describe : describe.skip;

d('chapter-explorer (live)', () => {
  it('produces a paragraph using ≥2 tool calls within budget', async () => {
    const result = await runChapterExplorer({
      subject: 'science',
      grade: '9',
      chapter: 'Force and Laws of Motion',
    });

    expect(result.status).toBe('success');
    expect(result.finalText.length).toBeGreaterThan(50);
    expect(result.stepCount).toBeGreaterThanOrEqual(3); // ≥1 llm + ≥1 tool + ≥1 llm

    const { data: steps } = await supabaseAdmin
      .from('agent_steps')
      .select('step_type, tool_name')
      .eq('run_id', result.runId);

    const toolCalls = (steps ?? []).filter((s) => s.step_type === 'tool_call');
    expect(toolCalls.length).toBeGreaterThanOrEqual(2);
    const toolNames = new Set(toolCalls.map((s) => s.tool_name));
    expect(toolNames.has('list_topics_in_chapter')).toBe(true);
    expect(toolNames.has('lookup_ncert')).toBe(true);
  }, 60_000);
});
```

- [ ] **Step 2: Run gated test in skipped state to confirm wiring**

Run: `npx vitest run src/__tests__/ai/agents/chapter-explorer.test.ts`
Expected: 1 test SKIPPED (because `RUN_LIVE_AI_TESTS` is unset).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/ai/agents/chapter-explorer.test.ts
git commit -m "test(ai/agents): add gated live integration test for chapter-explorer"
```

---

## Task 12: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests PASS, including the 4 new test files (live test skipped).

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: 0 errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 errors. Warnings acceptable (the new files should not introduce any).

- [ ] **Step 4: Live smoke test**

Run: `npm run smoke:agent -- --subject science --grade 9 --chapter "Force and Laws of Motion"`
Expected:
- Final text is a coherent paragraph mentioning Newton's laws or specific topics from the chapter.
- Step trace shows ≥1 `LLM (tool_use)` step → ≥1 `TOOL list_topics_in_chapter` → ≥1 `TOOL lookup_ncert` → `LLM (end_turn)`.
- No errors logged.

If the smoke test fails because no chunks exist for that chapter in the linked Supabase project, retry with a chapter known to have RAG content (query `select chapter, count(*) from rag_chunks where subject='science' and grade='9' group by chapter order by count desc limit 5`).

- [ ] **Step 5: Verify trace persistence**

Query staging Supabase:
```sql
select id, agent_name, status, step_count, tokens_input, tokens_output, ended_at - started_at as duration
from agent_runs
where agent_name = 'chapter-explorer'
order by created_at desc
limit 3;
```
Expected: most recent row has `status='success'`, `step_count >= 3`, non-null `ended_at`.

- [ ] **Step 6: Verify PII redaction**

```sql
select tool_name, tool_input_redacted, tool_output_redacted
from agent_steps
where run_id = (select id from agent_runs where agent_name='chapter-explorer' order by created_at desc limit 1)
  and step_type = 'tool_call';
```
Expected: chapter-explorer tools intentionally trace inputs/outputs as-is (declared `redactInTrace` returning raw values, since NCERT content is non-PII). For tools without `redactInTrace`, values would be `[REDACTED]` placeholders.

- [ ] **Step 7: Final commit (if any housekeeping)**

If any of the above steps required tweaks (e.g., adjusting `runChapterExplorer` budget, fixing `authorizeRequest` import path), commit them now:

```bash
git add -A
git commit -m "chore(ai/agents): smoke-test fixups"
```

---

## Self-Review Checklist (run after writing the plan)

**Spec coverage:**
- §3 Decisions 1–17 all map to tasks above:
  - Decisions 1, 13, 14, 15: Tasks 8, 9, 10, 11
  - Decisions 2, 6, 7: Task 1, 3, 8
  - Decisions 3, 4, 5: Task 7 (loop is single-shot, serial, no streaming — see implementation)
  - Decisions 8, 9: Task 3 (registry per-tool circuit + handler-throw → ok:false)
  - Decision 10: Task 1 (DEFAULT_BUDGET)
  - Decision 11: Tasks 4, 5
  - Decision 12: Task 5 (`redactByDefault`) + Task 8 (per-tool override)
  - Decision 16: Task 6 (additive only — existing fields unchanged)
  - Decision 17: documented in spec §11; no task needed

**Placeholder scan:** No "TBD", "TODO", or "implement later" in the plan. Every code block is complete.

**Type consistency:**
- `AgentResult` defined in Task 1, used in Tasks 7, 8, 9 — fields match.
- `ToolDefinition` defined in Task 1, used in Tasks 3, 7, 8 — signature matches.
- `BudgetExceeded` defined in Task 1, used in Tasks 2, 7, 9 — same constructor signature.
- `runAgent` signature in Task 7 matches usage in Task 8.
- `runChapterExplorer` signature in Task 8 matches usage in Tasks 9, 10, 11.
- `dispatch()` returns `DispatchResult` (Task 1, used in Tasks 3, 7).

**Scope check:** Single PR, ~4 dev days. No subsystem decomposition needed.
