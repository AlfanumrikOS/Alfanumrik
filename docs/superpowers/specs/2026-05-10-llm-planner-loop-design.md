# LLM-as-Planner Loop Substrate — Design Spec

**Date:** 2026-05-10
**Status:** Approved (decisions locked by user during brainstorm 2026-05-10; end-to-end build authorized)
**Owner (design):** ai-engineer
**Strategy chosen:** D — Build the planner-loop substrate as standalone infra with a throwaway proving-ground agent (`chapter-explorer`)
**Invariants at risk:** P8 (RLS — new `agent_runs` and `agent_steps` tables), P10 (no PII in logs — addressed via per-tool redaction), P12 (AI safety — strengthened by step/token/wall budgets and per-tool circuit), P14 (cost discipline — explicit per-run cost ceiling at ~₹0.5 on Haiku). None violated.

---

## 1. Problem

Alfanumrik's AI surface today is built from **deterministic pipelines** ([grounded-answer/pipeline.ts](../../../supabase/functions/grounded-answer/pipeline.ts)) and **hardcoded state machines** ([foxy-graph.ts](../../../src/lib/ai/workflows/foxy-graph.ts)). Both are excellent at what they do but neither lets an LLM decide *which* steps to take or *which* data to fetch.

Several near-term features want exactly that capability:

- **Daily Study Planner** — agent reasons about mastery state + retention + exam calendar to write today's plan.
- **Question-Bank Quality Agent** — generate → critique → revise loop until P11 invariants pass.
- **Foxy investigate-then-answer** — Foxy calls tools mid-conversation to check student history before responding.
- **Parent Report Synthesizer** — pulls multiple signals, drafts, self-critiques in EN+हिं.

What's missing is a **single reusable agent loop** so each of these becomes a thin orchestration on top, instead of four parallel implementations of the same primitive.

## 2. What exists today (substrate audit)

| Component | Location | State |
|---|---|---|
| `callClaude()` | [src/lib/ai/clients/claude.ts:156](../../../src/lib/ai/clients/claude.ts) | Single-shot. No `tools` field in request body. No `tool_use` parsing. Has model fallback + circuit breaker. |
| Tool *implementations* | [src/lib/ai/tools/](../../../src/lib/ai/tools/) | `getNcertChunks`, `getStudentContext`, `saveTrace`, `flagContent`. DB adapters only — no JSON schemas, no dispatcher. |
| Workflow tracing | [src/lib/ai/types.ts:177-197](../../../src/lib/ai/types.ts) | `WorkflowTrace` exists, in-memory only. `TraceStepType` has no `tool_call` / `agent_step`. |
| Workflow state machine | [src/lib/ai/workflows/foxy-graph.ts](../../../src/lib/ai/workflows/foxy-graph.ts) | Hardcoded edges. Not LLM-driven. |
| Edge Function Claude clients | [supabase/functions/grounded-answer/claude.ts](../../../supabase/functions/grounded-answer/claude.ts), foxy-tutor inline | Separate single-shot clients. Out of scope for V1. |

The substrate is ~80% there. Missing: the loop itself + tool schema layer + agent-step persistence.

## 3. Decisions (approved 2026-05-10)

| # | Decision | Choice |
|---|---|---|
| 1 | Proving-ground agent | (D) Substrate alone + throwaway `chapter-explorer` |
| 2 | Runtime placement | Next.js Node only (V1). Reuse existing `callClaude`. Edge Function port deferred. |
| 3 | Streaming | **Not in V1.** Request → final response. |
| 4 | Parallel tool dispatch | **Not in V1.** Tools dispatched serially even when LLM emits multiple `tool_use` blocks. |
| 5 | Multi-turn / human-in-loop | **Not in V1.** Single-shot agent runs only. |
| 6 | Tool schema authoring | Hand-authored JSON Schema per tool. No Zod dependency. |
| 7 | Tool registration scope | Per-agent (each agent constructs its own registry). No global registry. |
| 8 | Tool failure behavior | Format error as `tool_result` with `is_error: true`, return to LLM. LLM decides whether to retry, switch, or give up. |
| 9 | Per-tool circuit | 3 consecutive failures of the same tool in a single run → tool returns synthesized "tool unavailable" error to LLM, doesn't crash agent. |
| 10 | Default budgets | `maxSteps=8`, `maxTotalTokens=50_000`, `maxWallMs=30_000`. Each overridable per agent. |
| 11 | Trace storage | New `agent_runs` and `agent_steps` tables. Service-role-only RLS. Reuse existing `logger` + `logOpsEvent`. |
| 12 | PII handling in traces | Each tool declares `redactInTrace?(input)`; default = redact entire input/output. |
| 13 | Throwaway agent target | `chapter-explorer` — given `(subject, grade, chapter)`, returns a 1-paragraph overview using `list_topics_in_chapter` + `lookup_ncert` tools. |
| 14 | Throwaway agent surface | `POST /api/internal/agents/chapter-explorer` (admin-only via `internal.admin` permission) + `npm run smoke:agent` CLI script. |
| 15 | Throwaway agent lifetime | Deleted in the next spec that ships the first real agent (Question-Bank Quality or Daily Planner). |
| 16 | Backwards compatibility | `callClaude()` extension is additive only. Existing callers (foxy router, ncert-solver, etc.) continue to work unchanged. |
| 17 | Edge Function port | Deferred. Document the porting recipe but do not implement. |

## 4. Architecture

### 4.1 Layout

```
src/lib/ai/agents/
  ├── types.ts            — Tool, ToolDefinition, AgentRun, AgentStep, AgentBudget, AgentResult
  ├── registry.ts         — createRegistry() + dispatch(name, input) + per-tool circuit
  ├── budget.ts           — BudgetTracker (steps, tokens, wall time)
  ├── trace.ts            — persistAgentRun() + persistAgentStep() + redaction helpers
  ├── runAgent.ts         — the loop
  ├── agents/
  │   └── chapter-explorer.ts   — throwaway proving-ground agent (deleted next spec)
  └── __tests__/
      ├── registry.test.ts
      ├── budget.test.ts
      ├── runAgent.test.ts          — mocked Claude, table-driven
      └── chapter-explorer.test.ts  — gated live test (RUN_LIVE_AI_TESTS=1)
```

### 4.2 The loop (canonical pseudocode)

```
runAgent({ agentName, systemPrompt, userPrompt, tools, budget, ctx }):
  budget = budget ?? DEFAULT_BUDGET
  run = startRun(agentName, ctx)
  messages = [{ role: 'user', content: userPrompt }]

  for step = 1..budget.maxSteps:
    budget.assertWallTime()
    response = callClaude({ system: systemPrompt, messages, tools: tools.schemas() })
    budget.recordTokens(response.tokensUsed)
    budget.assertTokens()
    persistStep(run, { type: 'llm_call', step, tokens, model, latency })

    if response.stopReason === 'end_turn':
      finalize(run, 'success', response.text)
      return { finalText: response.text, steps, tokens, runId: run.id }

    if response.stopReason === 'tool_use':
      messages.push({ role: 'assistant', content: response.contentBlocks })
      toolResults = []
      for each toolUse in response.contentBlocks where type === 'tool_use':
        result = registry.dispatch(toolUse.name, toolUse.input, ctx)
        persistStep(run, { type: 'tool_call', tool: toolUse.name, input, output, error })
        toolResults.push({ tool_use_id: toolUse.id, content: result, is_error: !!error })
      messages.push({ role: 'user', content: toolResults })
      continue

    if response.stopReason === 'max_tokens':
      finalize(run, 'budget_exceeded', null)
      throw BudgetExceeded('llm_max_tokens')

  finalize(run, 'budget_exceeded', null)
  throw BudgetExceeded('max_steps')
```

### 4.3 Extending `callClaude()`

Additive only — existing callers unaffected.

```ts
// types.ts
export interface ClaudeRequestOptions {
  // ... existing fields ...
  tools?: ToolSchema[];                    // NEW
  toolChoice?: 'auto' | 'any' | { type: 'tool'; name: string };  // NEW
}

export interface ClaudeResponse {
  // ... existing fields (content, model, tokensUsed, etc.) ...
  contentBlocks: ContentBlock[];           // NEW — full Anthropic content blocks
  // 'content' field continues to return concatenated text only
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };
```

`callClaude` change in [src/lib/ai/clients/claude.ts](../../../src/lib/ai/clients/claude.ts):
- Pass `tools` and `tool_choice` to Anthropic API when present
- Parse all content blocks (not just first text block) into `contentBlocks`
- `content` field preserved as concatenated text-only for back-compat

### 4.4 Tool definition shape

```ts
export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;                                              // unique within registry
  description: string;                                       // shown to LLM
  inputSchema: JSONSchema;                                   // hand-authored
  handler: (input: I, ctx: AgentContext) => Promise<O>;
  /** Optional: redact PII before persisting to agent_steps. Default: full redaction. */
  redactInTrace?: (input: I, output: O | null) => { input: unknown; output: unknown };
}

export interface AgentContext {
  /** User on whose behalf the agent runs (null for system-initiated agents). */
  readonly userId: string | null;
  /** Free-form context, never persisted in raw form. */
  readonly meta: Record<string, unknown>;
}
```

### 4.5 Registry + dispatch

```ts
export function createRegistry(tools: ToolDefinition[]): Registry {
  // validates name uniqueness, JSON schema validity
  // tracks per-tool failure count for the run
  // dispatch() returns { ok: true, output } | { ok: false, error: string }
  //   — never throws; failure is returned to LLM as tool_result
}
```

### 4.6 Budgets

```ts
export interface AgentBudget {
  maxSteps: number;        // default 8
  maxTotalTokens: number;  // default 50_000
  maxWallMs: number;       // default 30_000
}

export const DEFAULT_BUDGET: AgentBudget = {
  maxSteps: 8,
  maxTotalTokens: 50_000,
  maxWallMs: 30_000,
};
```

Cost ceiling rationale (Haiku 4.5 pricing as of 2026-05-10):
- A run that hits the 50K-token ceiling is the worst case; typical agent runs are expected to use 5–15K tokens.
- Per-run worst-case cost on Haiku: ~₹3 (mixed input/output at current rates).
- 5,000 students × 1 agent run/day at typical 10K tokens ≈ ₹3,000–4,000/day, well within P14 cost discipline.
- The hard ceiling exists to bound *anomalies* (runaway loops, prompt-injection-induced infinite tool calls), not to size for typical traffic.

## 5. Data model

One migration: `supabase/migrations/<timestamp>_agent_traces.sql`

```sql
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  status text not null check (status in ('success', 'budget_exceeded', 'tool_failure', 'llm_failure', 'unknown_error')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  step_count int not null default 0,
  tokens_input int not null default 0,
  tokens_output int not null default 0,
  final_text_redacted text,                    -- redacted or null
  error_message text,
  user_id uuid references auth.users(id) on delete set null,
  context_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_agent_runs_agent_name_started on agent_runs (agent_name, started_at desc);
create index idx_agent_runs_user_id on agent_runs (user_id) where user_id is not null;
create index idx_agent_runs_status on agent_runs (status) where status != 'success';

create table agent_steps (
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

create index idx_agent_steps_run_id on agent_steps (run_id, step_number);

-- RLS: service role only (P8)
alter table agent_runs enable row level security;
alter table agent_steps enable row level security;

-- No SELECT/INSERT policies for anon or authenticated — service role bypasses RLS,
-- and these tables hold redacted operational data only. If an admin UI is later
-- added to view runs, that route uses supabase-admin server-side.
```

## 6. Throwaway agent: `chapter-explorer`

**Goal:** Validate the loop end-to-end with the smallest meaningful tool surface.

**System prompt** (abbreviated):
> You are a content explorer. Given a subject, grade, and chapter, produce a 1-paragraph overview of the chapter's main ideas. You MUST use the available tools to look up actual NCERT content — do not rely on memory. First call `list_topics_in_chapter` to see what's covered, then call `lookup_ncert` for the most central topics, then write the paragraph citing the specific topics you saw.

**Tools registered:**

```ts
// list_topics_in_chapter
{
  name: 'list_topics_in_chapter',
  description: 'List the distinct topics covered in a specific NCERT chapter.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      grade: { type: 'string', enum: ['6','7','8','9','10','11','12'] },
      chapter: { type: 'string' }
    },
    required: ['subject', 'grade', 'chapter']
  },
  // implementation: SELECT DISTINCT topic FROM rag_chunks WHERE ...
}

// lookup_ncert
{
  name: 'lookup_ncert',
  description: 'Fetch up to N NCERT content chunks for a specific subject/grade/chapter, optionally filtered by topic.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      grade:   { type: 'string', enum: ['6','7','8','9','10','11','12'] },
      chapter: { type: 'string' },
      topic:   { type: 'string' },
      limit:   { type: 'integer', minimum: 1, maximum: 10, default: 3 }
    },
    required: ['subject', 'grade', 'chapter']
  },
  // implementation: wraps existing getNcertChunks() + topic filter
}
```

**Why this is sufficient:** forces ≥2 tool calls, exercises real chaining (output of `list_topics` informs `lookup_ncert` calls), no PII (chapter content is public NCERT material), output is a string the route returns to the admin caller.

**Invocation surface:**
- `POST /api/internal/agents/chapter-explorer` — body `{ subject, grade, chapter }`. Auth: server-side `authorizeRequest(req, 'internal.admin')`.
- `npm run smoke:agent -- --subject science --grade 9 --chapter "Force and Laws of Motion"` — Node script that calls `runAgent()` directly and prints the result + step trace.

**Lifetime:** Deleted in the next agent spec. The route, smoke script, and `chapter-explorer.ts` go. The substrate (`runAgent`, `registry`, `budget`, `trace`, `callClaude` extension, the two trace tables) stays.

## 7. Test plan

**Unit tests (`__tests__/`):**

| File | Cases |
|---|---|
| `registry.test.ts` | duplicate name rejected; invalid JSON Schema rejected; dispatch returns `{ok:true, output}` on success; dispatch returns `{ok:false, error}` on handler throw; per-tool circuit opens after 3 consecutive failures |
| `budget.test.ts` | step counter increments; `assertSteps` throws at limit; `recordTokens` sums input+output; `assertTokens` throws at limit; `assertWallTime` throws after `maxWallMs` |
| `runAgent.test.ts` | (mocked Claude) end_turn on first response → returns text; tool_use then end_turn → 1 tool dispatched, then text returned; 2 tool_use blocks in one response → both dispatched serially in order; max_steps trip; max_tokens trip; tool throws → tool_result with `is_error:true` sent back; per-tool circuit trip → "tool unavailable" message; trace persistence asserted via mock `persistStep` calls |
| `chapter-explorer.test.ts` | (gated `RUN_LIVE_AI_TESTS=1`) live run against grade 9 / science / "Force and Laws of Motion" → asserts ≥2 tool calls in trace, final text mentions ≥1 topic from the chapter, completes within budget |

**CI integration:**
- Unit tests run in standard `npm test` (no live AI). Live test gated by env var, runs nightly only.
- Coverage target: 80% for `src/lib/ai/agents/` (matches `cognitive-engine.ts` threshold per CLAUDE.md).

**Smoke validation (manual, before merge):**
- Run `npm run smoke:agent` against 3 different chapters
- Inspect `agent_runs` + `agent_steps` rows in staging Supabase: confirm step ordering, redaction, no PII leakage
- Confirm budget exhaustion path by setting `maxSteps=1` and observing `BudgetExceeded` thrown + `agent_runs.status='budget_exceeded'`

## 8. Out of scope (V1)

Explicitly cut to keep scope tight. Each becomes its own spec:

- Streaming responses from agents
- Parallel tool dispatch (multiple `tool_use` blocks → `Promise.all` instead of serial)
- Multi-turn / pause-resume agents
- Edge Function port (Deno runtime)
- Admin UI for viewing agent run traces
- Cost dashboards / per-agent cost aggregation
- Real agents (Daily Study Planner, Question-Bank Quality, Foxy investigate-then-answer, Parent Report Synthesizer) — each is a separate spec built on this substrate
- Tool versioning / schema migration tooling

## 9. Effort estimate (solo-dev days)

| Workstream | Days |
|---|---|
| Substrate: types, registry, budget, runAgent, callClaude tools extension | 2.0 |
| Trace migration + RLS + persistence helpers | 0.5 |
| Throwaway agent + admin route + smoke script | 0.5 |
| Tests (unit + gated live) + CI wiring | 1.0 |
| **Total** | **4.0** |

## 10. Migration / rollout

This is new infrastructure — no migration of existing AI surfaces required. Rollout is:

1. Land substrate + tests + migration in one PR
2. Verify smoke script passes against staging
3. Verify `agent_runs` / `agent_steps` populate correctly
4. Merge

Existing AI workflows (Foxy, NCERT solver, quiz generator) remain on their current single-shot `callClaude` calls. They migrate to `runAgent` only when there's a concrete reason — never as a refactor for its own sake.

## 11. Future port to Edge Function (recipe, not implemented)

When a future agent needs to live in the Edge Function runtime (Deno):

- Port `runAgent`, `registry`, `budget` to Deno modules under `supabase/functions/_shared/agents/`
- Replace `@/lib/supabase-admin` with the Edge Function's `createClient(SERVICE_ROLE_KEY)` pattern
- Replace `@/lib/logger` with the Edge Function `_shared/logger` equivalent
- Reuse the same `agent_runs` / `agent_steps` tables (cross-runtime, single source of truth)

Document this in `docs/runbooks/agents-edge-port.md` when the first Edge Function agent is needed.
