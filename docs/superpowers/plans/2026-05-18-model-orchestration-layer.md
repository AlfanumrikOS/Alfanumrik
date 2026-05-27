# Model Orchestration Layer (MOL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace four hand-rolled Anthropic-only call sites with a single multi-provider Model Orchestration Layer (MOL) that classifies each request, routes to the best model (Claude / OpenAI / future), enforces fallbacks, captures cost+latency telemetry, and adapts output to student grade/language — feature-flagged so prod stays stable.

**Architecture:** Edge-Function-resident TypeScript module at `supabase/functions/_shared/mol/`. Single public entry `generateResponse(req)` runs Classifier → Normalizer → Prompt-Builder → Router → Provider chain (with circuit breaker + fallback) → Post-Processor → Telemetry. Providers implement a common `ModelProvider` interface; adding Gemini is one new file. Existing edge functions (foxy-tutor, ncert-solver, quiz-generator, scan-ocr) thin out to auth/quota/RAG and delegate generation to MOL behind `ff_mol_enabled`.

**Tech Stack:** Deno (Edge Functions), TypeScript, Supabase Postgres, plain `fetch` for both Anthropic and OpenAI APIs (no SDK — Deno + Edge Function size budget), Vitest for tests (already in repo), `@supabase/supabase-js@2` via esm.sh.

---

## Table of Contents

1. [System Architecture Diagram](#system-architecture-diagram)
2. [Folder Structure](#folder-structure)
3. [Routing Matrix](#routing-matrix)
4. [Sample Inputs / Outputs](#sample-inputs--outputs)
5. [Cost Optimization Strategy](#cost-optimization-strategy)
6. [Scaling Plan](#scaling-plan)
7. [Tasks](#tasks)
8. [Rollout Plan](#rollout-plan)
9. [Compliance](#compliance)

---

## System Architecture Diagram

```
                  ┌────────────────────────────────────────────────────────┐
                  │  EDGE FUNCTION ENTRY                                    │
                  │  (foxy-tutor / ncert-solver / quiz-generator / scan-ocr)│
                  │                                                          │
                  │  • CORS  • JWT verify  • RBAC                            │
                  │  • Rate limit (per-student, in-memory)                   │
                  │  • Quota (check_and_record_usage RPC)                    │
                  │  • Input sanitization                                    │
                  │  • RAG retrieve (match_rag_chunks RPC)                   │
                  └─────────────────────────┬──────────────────────────────┘
                                            │   GenerateRequest
                                            ▼
                  ╔════════════════════════════════════════════════════════╗
                  ║  MOL: generateResponse(req): Promise<MolResult>        ║
                  ║   _shared/mol/index.ts                                  ║
                  ╠════════════════════════════════════════════════════════╣
                  ║                                                          ║
                  ║   ┌──────────────────┐                                  ║
                  ║   │ 1. Classify      │  rule-based (classifier.ts)     ║
                  ║   │    task_type     │  keyword + heuristic match      ║
                  ║   └────────┬─────────┘                                  ║
                  ║            ▼                                            ║
                  ║   ┌──────────────────┐                                  ║
                  ║   │ 2. Normalize     │  trim, sanitize, validate       ║
                  ║   └────────┬─────────┘                                  ║
                  ║            ▼                                            ║
                  ║   ┌──────────────────┐                                  ║
                  ║   │ 3. Build Prompt  │  student-context aware:         ║
                  ║   │                  │   grade tier (junior/mid/sr)    ║
                  ║   │                  │   language (en/hi/hinglish)     ║
                  ║   │                  │   exam_goal (cbse/jee/neet)     ║
                  ║   │                  │   learning_speed adjustments    ║
                  ║   └────────┬─────────┘                                  ║
                  ║            ▼                                            ║
                  ║   ┌──────────────────┐                                  ║
                  ║   │ 4. Select Chain  │  router.ts: ROUTING_MATRIX      ║
                  ║   │   (primary +     │  + ff_mol_openai_default flag   ║
                  ║   │    fallbacks)    │  + mol_routing_weights override ║
                  ║   └────────┬─────────┘                                  ║
                  ║            ▼                                            ║
                  ║   ┌──────────────────────────────────────────────┐     ║
                  ║   │ 5. Execute Provider Chain                    │     ║
                  ║   │                                                │     ║
                  ║   │   for each provider in chain:                  │     ║
                  ║   │     circuit-breaker check → skip if OPEN       │     ║
                  ║   │     fetch with timeout                         │     ║
                  ║   │     2x retry with backoff on 429/500/502/503   │     ║
                  ║   │     on success → break                          │     ║
                  ║   │     on fail   → record + try next provider     │     ║
                  ║   │                                                │     ║
                  ║   │   Hybrid mode (doubt_solving):                 │     ║
                  ║   │     pass1: claude-sonnet deep reasoning        │     ║
                  ║   │     pass2: gpt-4o-mini simplify+teach          │     ║
                  ║   │                                                │     ║
                  ║   │   Providers (providers/*.ts):                  │     ║
                  ║   │     AnthropicProvider  →  api.anthropic.com    │     ║
                  ║   │     OpenAIProvider     →  api.openai.com       │     ║
                  ║   │     (GeminiProvider planned, not in scope)     │     ║
                  ║   └────────┬─────────────────────────────────────┘     ║
                  ║            ▼                                            ║
                  ║   ┌──────────────────┐                                  ║
                  ║   │ 6. Post-process  │  trim, dedup headings, redact   ║
                  ║   │                  │  PII, enforce length cap        ║
                  ║   └────────┬─────────┘                                  ║
                  ║            ▼                                            ║
                  ║   ┌──────────────────┐                                  ║
                  ║   │ 7. Telemetry     │  insert into mol_request_logs:  ║
                  ║   │                  │   provider, model, latency,     ║
                  ║   │                  │   prompt_tok, completion_tok,   ║
                  ║   │                  │   usd_cost, fallback_count      ║
                  ║   └────────┬─────────┘                                  ║
                  ║            ▼                                            ║
                  ║         MolResult                                       ║
                  ╚═════════════════════════╤══════════════════════════════╝
                                            │
                                            ▼
                  ┌────────────────────────────────────────────────────────┐
                  │  EDGE FUNCTION EXIT                                     │
                  │  • Persist chat_sessions / ai_tutor_logs (unchanged)    │
                  │  • Award XP                                              │
                  │  • Return JSON to client                                 │
                  └────────────────────────────────────────────────────────┘

      ┌──────────────────────────────────────────────────────────────────┐
      │  ASYNC SIDE FLOWS                                                 │
      │                                                                    │
      │   Student rating ──► /api/mol/feedback ──► mol_feedback table     │
      │                                                │                   │
      │                                                ▼                   │
      │                                       nightly cron updates         │
      │                                       mol_routing_weights          │
      │                                                                    │
      │   feature_flags  ────────────────────► loaded per-request          │
      │     ff_mol_enabled                                                  │
      │     ff_mol_openai_default                                           │
      │     ff_mol_hybrid_mode_v1                                           │
      │                                                                    │
      │   model_pricing ────────────────────► cost calc in telemetry       │
      └──────────────────────────────────────────────────────────────────┘
```

---

## Folder Structure

```
supabase/functions/_shared/mol/
├── index.ts                       # Public surface — generateResponse()
├── types.ts                       # TaskType, StudentContext, GenerateRequest, MolResult
├── classifier.ts                  # TaskClassifier (rule-based MVP)
├── router.ts                      # ROUTING_MATRIX + selectProviderChain()
├── prompt-builder.ts              # Student-context-aware prompt assembly
├── post-processor.ts              # Output normalization
├── telemetry.ts                   # Cost calc + mol_request_logs insert
├── feature-flag.ts                # Deno-side feature_flags reader (cached)
├── feedback.ts                    # Routing-weight reader + writer helpers
├── providers/
│   ├── base.ts                    # ModelProvider interface + shared types
│   ├── anthropic.ts               # AnthropicProvider
│   ├── openai.ts                  # OpenAIProvider
│   └── shared.ts                  # CircuitBreaker, retryWithBackoff, withTimeout
└── __tests__/
    ├── classifier.test.ts
    ├── router.test.ts
    ├── prompt-builder.test.ts
    ├── post-processor.test.ts
    ├── telemetry.test.ts
    └── integration.test.ts

supabase/migrations/
├── 20260518000001_mol_telemetry.sql
├── 20260518000002_mol_feedback.sql
├── 20260518000003_model_pricing.sql
└── 20260518000004_mol_feature_flags.sql

src/app/api/mol/feedback/route.ts  # Student feedback ingestion (Node-side)
src/lib/mol-feedback.ts            # Typed client helper

docs/MOL_ARCHITECTURE.md           # Design doc
docs/MOL_OPERATIONS.md             # Runbook (cost dashboards, fallback alerts)

scripts/mol-cost-report.ts         # Daily cost report query (optional)
```

Edge functions touched (modified, not rewritten):
- `supabase/functions/foxy-tutor/index.ts`
- `supabase/functions/ncert-solver/index.ts`
- `supabase/functions/quiz-generator/index.ts`
- `supabase/functions/scan-ocr/index.ts`

---

## Routing Matrix

Deterministic table used by `router.ts`. Each row: primary provider tried first, fallbacks tried in order on failure. `mode='hybrid'` triggers two-pass.

| `task_type`            | Primary                  | Fallback 1              | Fallback 2              | Mode    | Why |
|------------------------|--------------------------|-------------------------|-------------------------|---------|-----|
| `explanation`          | `openai/gpt-4o-mini`     | `anthropic/haiku-4.5`   | —                       | single  | Clear structured teaching, low cost |
| `concept_explanation`  | `openai/gpt-4o-mini`     | `anthropic/haiku-4.5`   | —                       | single  | Same — distinguishes intent only |
| `step_by_step`         | `openai/gpt-4o-mini`     | `anthropic/haiku-4.5`   | —                       | single  | Formatted output strength |
| `reasoning`            | `anthropic/sonnet-4.6`   | `openai/gpt-4o`         | `anthropic/haiku-4.5`   | single  | Long multi-step logic |
| `quiz_generation`      | `openai/gpt-4o-mini`     | `anthropic/haiku-4.5`   | —                       | single  | Strict JSON, low cost |
| `evaluation`           | `anthropic/haiku-4.5`    | `openai/gpt-4o-mini`    | —                       | single  | Rubric scoring — short prompts |
| `doubt_solving`        | `anthropic/sonnet-4.6` → `openai/gpt-4o-mini` | `anthropic/haiku-4.5` | — | hybrid  | Reason then simplify |
| `ocr_extraction`       | `anthropic/sonnet-4.6`   | `openai/gpt-4o`         | —                       | vision  | Vision-capable, Anthropic primary today |

Overrides (in precedence order, highest first):
1. `mol_routing_weights` table row for `(task_type, grade_tier)` if `weight > 0.5` shifts primary.
2. `ff_mol_openai_default=true` flips `step_by_step` / `quiz_generation` to OpenAI hard.
3. `ff_mol_hybrid_mode_v1=false` collapses `doubt_solving` to single-pass Sonnet.
4. Per-request `config.preferred_provider` (admin/eval requests only).

---

## Sample Inputs / Outputs

### Sample 1 — Explanation (junior student, Hindi)

**Input:**
```json
{
  "task_type": "explanation",
  "input": { "topic": "photosynthesis", "question": "पौधे भोजन कैसे बनाते हैं?" },
  "student_context": {
    "grade": "6",
    "learning_speed": "moderate",
    "language": "hi",
    "exam_goal": "cbse"
  },
  "rag_context": "<NCERT chunks from curriculum_topics chapter 'Food'>"
}
```

**MOL trace:**
- Classifier: `explanation` (keyword `कैसे`, topic= biology).
- Grade tier: `junior` (6–8).
- Router: `openai/gpt-4o-mini` primary.
- Prompt: simple language, analogies, max 200 words, Devanagari output.
- Provider: OpenAI, 312ms, 412 prompt_tok / 187 completion_tok = ₹0.034.

**Output:**
```json
{
  "text": "पौधे अपना भोजन **प्रकाश संश्लेषण** (photosynthesis) से बनाते हैं...\n\n## ज़रूरी चीज़ें\n- सूरज की रोशनी\n- पानी\n- कार्बन डाइऑक्साइड\n\n[KEY: प्रकाश संश्लेषण]\n[FORMULA: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂]",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "task_type": "explanation",
  "latency_ms": 312,
  "tokens": { "prompt": 412, "completion": 187 },
  "usd_cost": 0.00041,
  "inr_cost": 0.034,
  "fallback_count": 0,
  "request_id": "9f1e..."
}
```

### Sample 2 — Doubt solving with hybrid mode (Grade 11 JEE)

**Input:**
```json
{
  "task_type": "doubt_solving",
  "input": {
    "question": "Why does the moment of inertia depend on the axis of rotation, and how do I compute it for a thin rod about an arbitrary axis?"
  },
  "student_context": {
    "grade": "11",
    "learning_speed": "fast",
    "language": "en",
    "exam_goal": "jee"
  },
  "rag_context": "<NCERT Physics Class 11 Rotational Motion chunks>"
}
```

**MOL trace:**
- Classifier: `doubt_solving` (keyword `why`, `how`, multi-part).
- Grade tier: `senior`.
- Router: hybrid → Sonnet (deep) then GPT-4o-mini (simplify).
- Pass 1 (Sonnet 4.6): 980ms, returns rigorous derivation w/ parallel-axis theorem.
- Pass 2 (gpt-4o-mini): 410ms, rephrases for JEE prep, adds worked example.

**Output:**
```json
{
  "text": "## Why MoI depends on axis\nMoment of inertia is **distribution-weighted**, not just mass-weighted...\n\n## Computing for a thin rod\n**Step 1** — about center: I = (1/12) m L²\n**Step 2** — parallel-axis: I = I_cm + m d²\n...",
  "provider": "hybrid",
  "model": "claude-sonnet-4-6 + gpt-4o-mini",
  "task_type": "doubt_solving",
  "latency_ms": 1390,
  "tokens": { "prompt": 1102, "completion": 643 },
  "usd_cost": 0.00514,
  "inr_cost": 0.43,
  "fallback_count": 0,
  "passes": 2,
  "request_id": "a23c..."
}
```

### Sample 3 — Fallback in action

**Input:** Same as Sample 1, but OpenAI returns 503.

**MOL trace:**
- OpenAI attempt 1: 503 → backoff 1s
- OpenAI attempt 2: 503 → circuit-breaker increment, mark fallback
- Anthropic Haiku attempt 1: 200 in 488ms
- `fallback_count: 1`

**Output:** Identical user-facing text shape; telemetry row records `provider='anthropic'`, `fallback_count=1`, `failure_chain='openai:503,openai:503'`.

---

## Cost Optimization Strategy

**Price table (per 1M tokens, USD, May 2026):**

| Provider/Model          | Input | Output |
|-------------------------|-------|--------|
| `openai/gpt-4o-mini`    | 0.15  | 0.60   |
| `openai/gpt-4o`         | 2.50  | 10.00  |
| `anthropic/haiku-4-5`   | 1.00  | 5.00   |
| `anthropic/sonnet-4-6`  | 3.00  | 15.00  |

(Seeded into `model_pricing`; update via SQL when vendors change pricing.)

**Tactics (enforced by `router.ts` and `prompt-builder.ts`):**

1. **Cheap-default principle.** `explanation`, `step_by_step`, `quiz_generation` route to `gpt-4o-mini` — 6.6× cheaper input / 8.3× cheaper output than Haiku. Foxy "learn" mode is ~60% of all traffic → biggest win.
2. **Premium only when justified.** Sonnet/GPT-4o gated to `reasoning` and `doubt_solving` (~15% of traffic). Router refuses to upgrade unless classifier explicitly returns these task types.
3. **Token caps per task type.** `max_tokens` is task-typed in router: explanation=1024, step_by_step=1500, quiz_generation=2000, reasoning=3000, evaluation=400, doubt_solving pass1=2500/pass2=1200.
4. **Prompt-deduplication.** `prompt-builder.ts` strips duplicate context if it's already in chat history. Saves ~200 tok/turn on multi-turn Foxy sessions.
5. **Per-request cost cap.** `telemetry.ts` checks projected cost from token count + price; if >₹2.00, downgrades to fallback before the call (e.g. force Haiku instead of Sonnet). Configurable via `ff_mol_cost_cap_inr`.
6. **Cache hit-rate on system prompts.** Anthropic offers prompt caching (≥1024 tok system prompt); MOL adds `cache_control: { type: 'ephemeral' }` for Foxy system prompts → ~85% cost reduction on the system-prompt portion.
7. **Daily budget alerts.** `scripts/mol-cost-report.ts` runs in cron, alerts via existing `audit_logs` channel if 24h spend > configurable threshold.

**Projected impact (10k DAU baseline from prod-launch plan):**
- Pre-MOL: 100% Haiku → ~₹950/day.
- Post-MOL routing only (no caching): ~₹420/day (-55%).
- + prompt caching: ~₹260/day (-72%).

---

## Scaling Plan

**Phase A — 0 to 100k MAU (current → +6 mo).** No infrastructure changes. Edge Functions auto-scale on Supabase. Per-student rate-limit (in-memory per worker) holds. Sufficient. Monitor `mol_request_logs.latency_ms` p95 < 2s SLO.

**Phase B — 100k to 1M MAU (+6 to +12 mo).**
- Move in-memory rate-limit to Postgres-backed `rate_limit_counters` (Supabase has it; add per-student bucket).
- Add request_id correlation through Edge → MOL → providers for trace.
- Introduce **read-replica** for `mol_request_logs` analytics — writes stay on primary.
- Per-provider quota guards: if Anthropic hits `429 type=rate_limit_error`, MOL pauses primary for 30s and uses fallback.

**Phase C — 1M to 10M MAU (Year 2).**
- Move telemetry inserts to a **buffered async writer**: in-memory queue flushed every 5s into `mol_request_logs` in batches of 200 (Edge Functions don't have queues — use a `queue-consumer` function which already exists).
- Introduce **prompt caching across providers**: Anthropic native (already used), OpenAI Batch API for non-realtime generation (quiz pre-gen).
- Pre-compute quiz items in batch overnight using `gpt-4o-mini` batch (50% discount).
- Introduce **per-region routing** (Mumbai-1 vs Singapore) for latency.

**Phase D — 10M+ MAU (Year 3, NDEAR alignment).**
- MOL becomes its own microservice with a stable gRPC contract — extracted only when E1–E4 triggers fire from `microservices_plan_v1` memo.
- Per-tenant model preferences (white-label schools can choose provider mix).
- Federation: an open-spec MOL contract published so other NDEAR-aligned learning OS can plug providers in.

**SLOs (from day one):**
- p50 latency: <800ms (single-pass), <1500ms (hybrid).
- p95 latency: <2000ms (single), <3500ms (hybrid).
- Fallback rate: <2% steady-state. Alert at 5%.
- Error rate (user-visible): <0.3%.

---

## Tasks

### Task 1: Scaffold MOL skeleton

**Files:**
- Create: `supabase/functions/_shared/mol/types.ts`
- Create: `supabase/functions/_shared/mol/index.ts` (placeholder)

- [ ] **Step 1: Write types.ts**

```typescript
// supabase/functions/_shared/mol/types.ts

export type TaskType =
  | 'explanation'
  | 'concept_explanation'
  | 'step_by_step'
  | 'reasoning'
  | 'quiz_generation'
  | 'evaluation'
  | 'doubt_solving'
  | 'ocr_extraction'

export type Language = 'en' | 'hi' | 'hinglish'

export type LearningSpeed = 'slow' | 'moderate' | 'fast'

export type ExamGoal = 'cbse' | 'jee' | 'neet' | 'general'

export type GradeTier = 'junior' | 'middle' | 'senior'

export interface StudentContext {
  student_id: string
  grade: string
  language: Language
  learning_speed?: LearningSpeed
  exam_goal?: ExamGoal
  subject?: string
  board?: string | null
}

export interface GenerateRequest {
  task_type?: TaskType                  // optional: classifier infers if absent
  input: {
    question?: string
    topic?: string
    instruction?: string
    chat_history?: Array<{ role: 'user' | 'assistant'; content: string }>
    image_url?: string                  // ocr_extraction only
    options?: string[]                  // quiz/evaluation
  }
  student_context: StudentContext
  rag_context?: string | null
  config?: {
    preferred_provider?: 'openai' | 'anthropic'
    max_tokens_override?: number
    request_id?: string                 // for trace correlation
    surface?: 'foxy' | 'quiz' | 'solver' | 'ocr' | string
  }
}

export interface TokenUsage {
  prompt: number
  completion: number
}

export interface ProviderResponse {
  text: string
  provider: 'openai' | 'anthropic'
  model: string
  tokens: TokenUsage
  finish_reason: string
  raw?: unknown
}

export interface MolResult {
  text: string
  provider: 'openai' | 'anthropic' | 'hybrid'
  model: string
  task_type: TaskType
  latency_ms: number
  tokens: TokenUsage
  usd_cost: number
  inr_cost: number
  fallback_count: number
  passes: number
  request_id: string
}

export class MolError extends Error {
  constructor(
    public code:
      | 'NO_PROVIDER_AVAILABLE'
      | 'INVALID_INPUT'
      | 'TIMEOUT'
      | 'COST_CAP_EXCEEDED'
      | 'PROVIDER_CONFIG_MISSING',
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
  }
}
```

- [ ] **Step 2: Write index.ts placeholder**

```typescript
// supabase/functions/_shared/mol/index.ts

import type { GenerateRequest, MolResult } from './types.ts'

export async function generateResponse(_req: GenerateRequest): Promise<MolResult> {
  throw new Error('MOL not yet implemented — see Task 16')
}

export * from './types.ts'
```

- [ ] **Step 3: Verify Deno parses the file**

Run: `cd "C:\Users\Bharangpur Primary\Desktop\Alfanumrik App" && deno check supabase/functions/_shared/mol/index.ts`
Expected: no output, exit 0.

(If `deno` is not on PATH, skip — Supabase deploy will type-check at deploy time.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/mol/types.ts supabase/functions/_shared/mol/index.ts
git commit -m "feat(mol): scaffold types and entry point"
```

---

### Task 2: Provider interface + shared helpers (circuit breaker, retry, timeout)

**Files:**
- Create: `supabase/functions/_shared/mol/providers/base.ts`
- Create: `supabase/functions/_shared/mol/providers/shared.ts`

- [ ] **Step 1: Write providers/base.ts**

```typescript
// supabase/functions/_shared/mol/providers/base.ts

import type { ProviderResponse, TokenUsage } from '../types.ts'

export interface ProviderCallOptions {
  system_prompt: string
  user_messages: Array<{ role: 'user' | 'assistant'; content: string }>
  max_tokens: number
  temperature?: number
  timeout_ms?: number
  image_url?: string                    // for vision
}

export interface ModelProvider {
  readonly id: 'openai' | 'anthropic'
  readonly default_model: string
  isConfigured(): boolean
  call(model: string, opts: ProviderCallOptions): Promise<ProviderResponse>
}

export interface ProviderCallResult {
  ok: true
  response: ProviderResponse
} | {
  ok: false
  error: string
  status?: number
  retryable: boolean
}

export function emptyUsage(): TokenUsage {
  return { prompt: 0, completion: 0 }
}
```

- [ ] **Step 2: Write providers/shared.ts**

```typescript
// supabase/functions/_shared/mol/providers/shared.ts

import type { ProviderCallResult } from './base.ts'

/**
 * Per-provider circuit breaker. Shared across the MOL module so all callers
 * see consistent state. Trips OPEN after FAILURE_THRESHOLD failures within
 * the rolling window; resets to HALF-OPEN after RESET_TIMEOUT.
 */
type BreakerState = 'closed' | 'open' | 'half-open'

interface BreakerEntry {
  failures: number
  last_failure_at: number
  state: BreakerState
}

const breakers = new Map<string, BreakerEntry>()
const FAILURE_THRESHOLD = 5
const RESET_TIMEOUT_MS = 60_000

function getEntry(key: string): BreakerEntry {
  let e = breakers.get(key)
  if (!e) {
    e = { failures: 0, last_failure_at: 0, state: 'closed' }
    breakers.set(key, e)
  }
  return e
}

export function canRequest(provider_id: string): boolean {
  const e = getEntry(provider_id)
  if (e.state === 'closed') return true
  if (e.state === 'open') {
    if (Date.now() - e.last_failure_at > RESET_TIMEOUT_MS) {
      e.state = 'half-open'
      return true
    }
    return false
  }
  return true
}

export function recordSuccess(provider_id: string): void {
  const e = getEntry(provider_id)
  e.failures = 0
  e.state = 'closed'
}

export function recordFailure(provider_id: string): void {
  const e = getEntry(provider_id)
  e.failures += 1
  e.last_failure_at = Date.now()
  if (e.failures >= FAILURE_THRESHOLD) e.state = 'open'
}

/**
 * Retries the inner fn up to maxAttempts on retryable failures.
 * Sleeps `backoff_ms_base * 2^attempt` between attempts (capped at 4s).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<ProviderCallResult>,
  maxAttempts = 2,
  backoff_ms_base = 500,
): Promise<ProviderCallResult> {
  let last: ProviderCallResult | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await fn()
    if (last.ok) return last
    if (!last.retryable) return last
    if (attempt < maxAttempts - 1) {
      const delay = Math.min(backoff_ms_base * 2 ** attempt, 4000)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  return last as ProviderCallResult
}

/** Wraps a promise with a hard timeout via AbortController. */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeout_ms: number,
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout_ms)
  try {
    return await fn(ctrl.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** Classifies HTTP status into retryable / non-retryable. */
export function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/mol/providers/base.ts supabase/functions/_shared/mol/providers/shared.ts
git commit -m "feat(mol): add ModelProvider interface and shared circuit-breaker/retry/timeout helpers"
```

---

### Task 3: AnthropicProvider

**Files:**
- Create: `supabase/functions/_shared/mol/providers/anthropic.ts`
- Test: `supabase/functions/_shared/mol/__tests__/providers-anthropic.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/mol/__tests__/providers-anthropic.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnthropicProvider } from '../providers/anthropic.ts'

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // @ts-ignore - inject Deno shim for the unit test environment
    globalThis.Deno = { env: { get: (k: string) => k === 'ANTHROPIC_API_KEY' ? 'test-key' : '' } }
  })

  it('returns parsed response on 200', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: 'Hello, student!' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    }), { status: 200 }))
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const p = new AnthropicProvider()
    const r = await p.call('claude-haiku-4-5-20251001', {
      system_prompt: 'sys',
      user_messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    })
    expect(r.text).toBe('Hello, student!')
    expect(r.provider).toBe('anthropic')
    expect(r.tokens).toEqual({ prompt: 10, completion: 5 })
  })

  it('throws on non-200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('boom', { status: 503 })) as unknown as typeof fetch
    const p = new AnthropicProvider()
    await expect(p.call('claude-haiku-4-5-20251001', {
      system_prompt: 'sys', user_messages: [{ role: 'user', content: 'hi' }], max_tokens: 100,
    })).rejects.toMatchObject({ message: expect.stringContaining('503') })
  })

  it('isConfigured returns true when key present', () => {
    expect(new AnthropicProvider().isConfigured()).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/providers-anthropic.test.ts`
Expected: FAIL — `AnthropicProvider` does not exist.

- [ ] **Step 3: Implement providers/anthropic.ts**

```typescript
// supabase/functions/_shared/mol/providers/anthropic.ts

import type { ModelProvider, ProviderCallOptions } from './base.ts'
import type { ProviderResponse } from '../types.ts'
import { withTimeout } from './shared.ts'

const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic' as const
  readonly default_model = 'claude-haiku-4-5-20251001'

  private apiKey(): string {
    return Deno.env.get('ANTHROPIC_API_KEY') || ''
  }

  isConfigured(): boolean {
    return this.apiKey().length > 0
  }

  async call(model: string, opts: ProviderCallOptions): Promise<ProviderResponse> {
    if (!this.isConfigured()) {
      throw new Error('AnthropicProvider not configured (ANTHROPIC_API_KEY missing)')
    }

    const timeout = opts.timeout_ms ?? 20_000

    // Enable Anthropic prompt caching on the system block when it's long enough.
    const sysBlock = opts.system_prompt.length >= 1024
      ? [{ type: 'text', text: opts.system_prompt, cache_control: { type: 'ephemeral' } }]
      : opts.system_prompt

    // Vision: when image_url is provided, attach to the latest user message.
    let messages = opts.user_messages
    if (opts.image_url) {
      const last = messages[messages.length - 1]
      const others = messages.slice(0, -1)
      messages = [
        ...others,
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: opts.image_url } },
            { type: 'text', text: last?.content ?? '' },
          ] as unknown as string,
        },
      ]
    }

    const body = {
      model,
      max_tokens: opts.max_tokens,
      system: sysBlock,
      messages,
      temperature: opts.temperature ?? 0.7,
    }

    const res = await withTimeout(
      (signal) =>
        fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey(),
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal,
        }),
      timeout,
    )

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 300)}`)
    }

    const data = await res.json() as {
      content: Array<{ type: string; text?: string }>
      usage: { input_tokens: number; output_tokens: number }
      stop_reason: string
    }

    const text = data.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n')
      .trim()

    return {
      text,
      provider: 'anthropic',
      model,
      tokens: { prompt: data.usage.input_tokens, completion: data.usage.output_tokens },
      finish_reason: data.stop_reason,
      raw: data,
    }
  }
}
```

- [ ] **Step 4: Run the test, confirm pass**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/providers-anthropic.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/mol/providers/anthropic.ts supabase/functions/_shared/mol/__tests__/providers-anthropic.test.ts
git commit -m "feat(mol): AnthropicProvider with prompt caching and vision support"
```

---

### Task 4: OpenAIProvider

**Files:**
- Create: `supabase/functions/_shared/mol/providers/openai.ts`
- Test: `supabase/functions/_shared/mol/__tests__/providers-openai.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/mol/__tests__/providers-openai.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAIProvider } from '../providers/openai.ts'

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // @ts-ignore
    globalThis.Deno = { env: { get: (k: string) => k === 'OPENAI_API_KEY' ? 'sk-test' : '' } }
  })

  it('returns parsed response on 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Hi, scholar!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
      model: 'gpt-4o-mini',
    }), { status: 200 })) as unknown as typeof fetch

    const r = await new OpenAIProvider().call('gpt-4o-mini', {
      system_prompt: 'sys',
      user_messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    })
    expect(r.text).toBe('Hi, scholar!')
    expect(r.provider).toBe('openai')
    expect(r.tokens).toEqual({ prompt: 12, completion: 6 })
  })

  it('throws on non-200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('rate-limited', { status: 429 })) as unknown as typeof fetch
    await expect(new OpenAIProvider().call('gpt-4o-mini', {
      system_prompt: 'sys', user_messages: [{ role: 'user', content: 'hi' }], max_tokens: 100,
    })).rejects.toMatchObject({ message: expect.stringContaining('429') })
  })

  it('isConfigured returns true when key present', () => {
    expect(new OpenAIProvider().isConfigured()).toBe(true)
  })
})
```

- [ ] **Step 2: Confirm test fails**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/providers-openai.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement providers/openai.ts**

```typescript
// supabase/functions/_shared/mol/providers/openai.ts

import type { ModelProvider, ProviderCallOptions } from './base.ts'
import type { ProviderResponse } from '../types.ts'
import { withTimeout } from './shared.ts'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

export class OpenAIProvider implements ModelProvider {
  readonly id = 'openai' as const
  readonly default_model = 'gpt-4o-mini'

  private apiKey(): string {
    return Deno.env.get('OPENAI_API_KEY') || ''
  }

  isConfigured(): boolean {
    return this.apiKey().length > 0
  }

  async call(model: string, opts: ProviderCallOptions): Promise<ProviderResponse> {
    if (!this.isConfigured()) {
      throw new Error('OpenAIProvider not configured (OPENAI_API_KEY missing)')
    }

    const timeout = opts.timeout_ms ?? 20_000

    // OpenAI chat format. Vision via image_url content part on the last user msg.
    const chatMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: opts.system_prompt },
    ]
    for (let i = 0; i < opts.user_messages.length; i++) {
      const m = opts.user_messages[i]
      const isLast = i === opts.user_messages.length - 1
      if (isLast && opts.image_url) {
        chatMessages.push({
          role: m.role,
          content: [
            { type: 'image_url', image_url: { url: opts.image_url } },
            { type: 'text', text: m.content },
          ],
        })
      } else {
        chatMessages.push({ role: m.role, content: m.content })
      }
    }

    const body = {
      model,
      messages: chatMessages,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature ?? 0.7,
    }

    const res = await withTimeout(
      (signal) =>
        fetch(OPENAI_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal,
        }),
      timeout,
    )

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 300)}`)
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>
      usage: { prompt_tokens: number; completion_tokens: number }
      model: string
    }

    const text = (data.choices[0]?.message?.content ?? '').trim()

    return {
      text,
      provider: 'openai',
      model: data.model || model,
      tokens: { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens },
      finish_reason: data.choices[0]?.finish_reason ?? 'stop',
      raw: data,
    }
  }
}
```

- [ ] **Step 4: Confirm test passes**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/providers-openai.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/mol/providers/openai.ts supabase/functions/_shared/mol/__tests__/providers-openai.test.ts
git commit -m "feat(mol): OpenAIProvider with vision support"
```

---

### Task 5: Task classifier

**Files:**
- Create: `supabase/functions/_shared/mol/classifier.ts`
- Test: `supabase/functions/_shared/mol/__tests__/classifier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/mol/__tests__/classifier.test.ts

import { describe, it, expect } from 'vitest'
import { classify } from '../classifier.ts'

describe('classify', () => {
  it('honors explicit task_type if present', () => {
    expect(classify({
      task_type: 'reasoning',
      input: { question: 'anything' },
      student_context: { student_id: 's', grade: '10', language: 'en' },
    })).toBe('reasoning')
  })

  it('classifies "explain" as explanation', () => {
    expect(classify({
      input: { question: 'Explain photosynthesis in simple terms.' },
      student_context: { student_id: 's', grade: '6', language: 'en' },
    })).toBe('explanation')
  })

  it('classifies "why ... how" multipart as doubt_solving', () => {
    expect(classify({
      input: { question: 'Why does ice float on water and how do I calculate buoyancy?' },
      student_context: { student_id: 's', grade: '11', language: 'en' },
    })).toBe('doubt_solving')
  })

  it('classifies step-by-step request', () => {
    expect(classify({
      input: { question: 'Solve step by step: integrate x sin(x) dx' },
      student_context: { student_id: 's', grade: '12', language: 'en' },
    })).toBe('step_by_step')
  })

  it('classifies quiz request when surface=quiz', () => {
    expect(classify({
      input: { instruction: 'Generate 10 MCQs on cellular respiration' },
      student_context: { student_id: 's', grade: '11', language: 'en' },
      config: { surface: 'quiz' },
    })).toBe('quiz_generation')
  })

  it('classifies vision input', () => {
    expect(classify({
      input: { question: 'Solve this problem', image_url: 'https://x/img.png' },
      student_context: { student_id: 's', grade: '9', language: 'en' },
    })).toBe('ocr_extraction')
  })

  it('classifies "grade my answer" as evaluation', () => {
    expect(classify({
      input: { question: 'Grade my answer: photosynthesis is when plants eat sunlight.' },
      student_context: { student_id: 's', grade: '7', language: 'en' },
    })).toBe('evaluation')
  })

  it('falls back to explanation for short student question', () => {
    expect(classify({
      input: { question: 'What is photosynthesis?' },
      student_context: { student_id: 's', grade: '6', language: 'en' },
    })).toBe('explanation')
  })
})
```

- [ ] **Step 2: Confirm test fails**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/classifier.test.ts`
Expected: FAIL — `classify` not found.

- [ ] **Step 3: Implement classifier.ts**

```typescript
// supabase/functions/_shared/mol/classifier.ts

import type { GenerateRequest, TaskType } from './types.ts'

const KEYWORDS = {
  step_by_step: /\b(step[\s-]?by[\s-]?step|solve.*step|derive|show your work|show the steps|prove)\b/i,
  reasoning: /\b(why .* and why|prove that|derive|justify|compare and contrast|critically)\b/i,
  evaluation: /\b(grade (my|this)|evaluate (my|this)|is this correct|check my (answer|work)|mark this)\b/i,
  explanation: /\b(explain|what is|define|describe|tell me about|kya hai|कैसे|क्या है)\b/iu,
  doubt_solving: /\b(i don'?t understand|i'm confused|why does|how do i|samajh nahi|समझ नहीं)\b/iu,
  quiz_generation: /\b(generate|create|make).*(quiz|questions?|mcqs?|test)\b/i,
}

/**
 * Lightweight rule-based classifier. Returns a TaskType.
 * Priority order matters: more specific signals checked first.
 */
export function classify(req: GenerateRequest): TaskType {
  if (req.task_type) return req.task_type

  // Vision = OCR
  if (req.input.image_url) return 'ocr_extraction'

  // Surface hint short-circuits
  const surface = req.config?.surface
  if (surface === 'quiz') return 'quiz_generation'
  if (surface === 'ocr') return 'ocr_extraction'

  const text = (req.input.question || req.input.instruction || req.input.topic || '').trim()

  // Multi-part "why ... how" → doubt_solving
  const hasWhy = /\bwhy\b/i.test(text)
  const hasHow = /\bhow\b/i.test(text)
  if (hasWhy && hasHow && text.length > 40) return 'doubt_solving'

  if (KEYWORDS.evaluation.test(text)) return 'evaluation'
  if (KEYWORDS.quiz_generation.test(text)) return 'quiz_generation'
  if (KEYWORDS.step_by_step.test(text)) return 'step_by_step'
  if (KEYWORDS.doubt_solving.test(text)) return 'doubt_solving'
  if (KEYWORDS.reasoning.test(text)) return 'reasoning'
  if (KEYWORDS.explanation.test(text)) return 'explanation'

  // Default — student-facing surfaces are usually teaching
  return 'explanation'
}

export function gradeTier(grade: string): 'junior' | 'middle' | 'senior' {
  const g = parseInt(grade, 10) || 0
  if (g <= 8) return 'junior'
  if (g <= 10) return 'middle'
  return 'senior'
}
```

- [ ] **Step 4: Confirm test passes**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/classifier.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/mol/classifier.ts supabase/functions/_shared/mol/__tests__/classifier.test.ts
git commit -m "feat(mol): rule-based task classifier"
```

---

### Task 6: Router (deterministic chain selection)

**Files:**
- Create: `supabase/functions/_shared/mol/router.ts`
- Test: `supabase/functions/_shared/mol/__tests__/router.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/mol/__tests__/router.test.ts

import { describe, it, expect } from 'vitest'
import { selectProviderChain, getMaxTokens } from '../router.ts'

describe('selectProviderChain', () => {
  it('routes explanation to openai primary', () => {
    const chain = selectProviderChain('explanation', { hybrid_enabled: true, openai_default: false, weights: {} })
    expect(chain.passes.length).toBe(1)
    expect(chain.passes[0].chain[0]).toEqual({ provider: 'openai', model: 'gpt-4o-mini' })
    expect(chain.passes[0].chain[1]).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })
  })

  it('routes reasoning to anthropic sonnet primary', () => {
    const chain = selectProviderChain('reasoning', { hybrid_enabled: true, openai_default: false, weights: {} })
    expect(chain.passes[0].chain[0]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6-20251022' })
  })

  it('returns two passes for doubt_solving when hybrid enabled', () => {
    const chain = selectProviderChain('doubt_solving', { hybrid_enabled: true, openai_default: false, weights: {} })
    expect(chain.passes.length).toBe(2)
    expect(chain.passes[0].chain[0].provider).toBe('anthropic') // pass 1 = reason
    expect(chain.passes[1].chain[0].provider).toBe('openai')    // pass 2 = simplify
  })

  it('collapses doubt_solving to single pass when hybrid disabled', () => {
    const chain = selectProviderChain('doubt_solving', { hybrid_enabled: false, openai_default: false, weights: {} })
    expect(chain.passes.length).toBe(1)
  })

  it('forces openai primary when openai_default=true and task is step_by_step', () => {
    const chain = selectProviderChain('step_by_step', { hybrid_enabled: true, openai_default: true, weights: {} })
    expect(chain.passes[0].chain[0].provider).toBe('openai')
  })

  it('caps max_tokens per task type', () => {
    expect(getMaxTokens('explanation')).toBe(1024)
    expect(getMaxTokens('reasoning')).toBe(3000)
    expect(getMaxTokens('evaluation')).toBe(400)
    expect(getMaxTokens('quiz_generation')).toBe(2000)
  })
})
```

- [ ] **Step 2: Confirm test fails**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/router.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement router.ts**

```typescript
// supabase/functions/_shared/mol/router.ts

import type { TaskType } from './types.ts'

export type ProviderId = 'openai' | 'anthropic'

export interface ProviderTarget {
  provider: ProviderId
  model: string
}

export interface Pass {
  /** A primary target plus ordered fallbacks. First success in this list wins. */
  chain: ProviderTarget[]
  /** Optional purpose tag for telemetry. */
  role: 'single' | 'reason' | 'simplify' | 'vision'
}

export interface SelectedChain {
  task_type: TaskType
  passes: Pass[]
  mode: 'single' | 'hybrid' | 'vision'
}

export interface RouterOptions {
  hybrid_enabled: boolean
  openai_default: boolean
  /** Per-(task_type) weight in [0,1]. If weights[task] > 0.5, primary becomes openai. */
  weights: Record<string, number>
}

const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-6-20251022'
const GPT_MINI = 'gpt-4o-mini'
const GPT_FULL = 'gpt-4o'

const BASE_MATRIX: Record<TaskType, Pass[]> = {
  explanation: [{
    role: 'single',
    chain: [
      { provider: 'openai', model: GPT_MINI },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
  concept_explanation: [{
    role: 'single',
    chain: [
      { provider: 'openai', model: GPT_MINI },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
  step_by_step: [{
    role: 'single',
    chain: [
      { provider: 'openai', model: GPT_MINI },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
  reasoning: [{
    role: 'single',
    chain: [
      { provider: 'anthropic', model: SONNET },
      { provider: 'openai', model: GPT_FULL },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
  quiz_generation: [{
    role: 'single',
    chain: [
      { provider: 'openai', model: GPT_MINI },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
  evaluation: [{
    role: 'single',
    chain: [
      { provider: 'anthropic', model: HAIKU },
      { provider: 'openai', model: GPT_MINI },
    ],
  }],
  doubt_solving: [
    {
      role: 'reason',
      chain: [
        { provider: 'anthropic', model: SONNET },
        { provider: 'anthropic', model: HAIKU },
      ],
    },
    {
      role: 'simplify',
      chain: [
        { provider: 'openai', model: GPT_MINI },
        { provider: 'anthropic', model: HAIKU },
      ],
    },
  ],
  ocr_extraction: [{
    role: 'vision',
    chain: [
      { provider: 'anthropic', model: SONNET },
      { provider: 'openai', model: GPT_FULL },
    ],
  }],
}

const MAX_TOKENS: Record<TaskType, number> = {
  explanation: 1024,
  concept_explanation: 1024,
  step_by_step: 1500,
  reasoning: 3000,
  quiz_generation: 2000,
  evaluation: 400,
  doubt_solving: 2500, // pass-1 cap; pass-2 uses simplifyMaxTokens
  ocr_extraction: 1500,
}

const PASS2_SIMPLIFY_MAX = 1200

export function selectProviderChain(task: TaskType, opts: RouterOptions): SelectedChain {
  // Clone so we never mutate BASE_MATRIX
  let passes: Pass[] = BASE_MATRIX[task].map((p) => ({ role: p.role, chain: [...p.chain] }))

  // Hybrid toggle
  if (task === 'doubt_solving' && !opts.hybrid_enabled) {
    passes = [{
      role: 'single',
      chain: [
        { provider: 'anthropic', model: SONNET },
        { provider: 'anthropic', model: HAIKU },
        { provider: 'openai', model: GPT_FULL },
      ],
    }]
  }

  // openai_default flip for teaching tasks
  if (opts.openai_default && (task === 'step_by_step' || task === 'quiz_generation' || task === 'explanation')) {
    passes = passes.map((p) => ({
      ...p,
      chain: [
        { provider: 'openai', model: GPT_MINI },
        ...p.chain.filter((t) => !(t.provider === 'openai' && t.model === GPT_MINI)),
      ],
    }))
  }

  // Per-task weight: weights[task] > 0.5 → ensure openai is primary
  const w = opts.weights[task]
  if (typeof w === 'number' && w > 0.5) {
    passes = passes.map((p) => {
      const openaiTarget = p.chain.find((t) => t.provider === 'openai')
      if (!openaiTarget) return p
      const reordered = [openaiTarget, ...p.chain.filter((t) => t !== openaiTarget)]
      return { ...p, chain: reordered }
    })
  }

  return {
    task_type: task,
    passes,
    mode: task === 'doubt_solving' && opts.hybrid_enabled
      ? 'hybrid'
      : task === 'ocr_extraction'
        ? 'vision'
        : 'single',
  }
}

export function getMaxTokens(task: TaskType): number {
  return MAX_TOKENS[task]
}

export function getSimplifyMaxTokens(): number {
  return PASS2_SIMPLIFY_MAX
}
```

- [ ] **Step 4: Confirm test passes**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/router.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/mol/router.ts supabase/functions/_shared/mol/__tests__/router.test.ts
git commit -m "feat(mol): deterministic routing matrix with hybrid + flag overrides"
```

---

### Task 7: Prompt builder (student-context aware)

**Files:**
- Create: `supabase/functions/_shared/mol/prompt-builder.ts`
- Test: `supabase/functions/_shared/mol/__tests__/prompt-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/mol/__tests__/prompt-builder.test.ts

import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildSimplifyPrompt } from '../prompt-builder.ts'

const baseCtx = { student_id: 's', grade: '6', language: 'en' as const, subject: 'science' }

describe('buildSystemPrompt', () => {
  it('produces junior-tier voice for grade 6', () => {
    const sys = buildSystemPrompt('explanation', baseCtx, null)
    expect(sys).toMatch(/simple/i)
    expect(sys).toMatch(/Grade 6/i)
    expect(sys).toMatch(/Foxy/)
    expect(sys).toMatch(/Never reveal/i)
  })

  it('produces senior-tier voice for grade 12 with exam_goal=jee', () => {
    const sys = buildSystemPrompt('reasoning', {
      ...baseCtx, grade: '12', exam_goal: 'jee',
    }, null)
    expect(sys).toMatch(/JEE/i)
    expect(sys).toMatch(/rigorous/i)
  })

  it('embeds RAG context with attribution clause', () => {
    const sys = buildSystemPrompt('explanation', baseCtx, 'Photosynthesis is the process...')
    expect(sys).toMatch(/Photosynthesis is the process/)
    expect(sys).toMatch(/Answer only using the provided NCERT context/i)
  })

  it('outputs Hindi instruction when language=hi', () => {
    const sys = buildSystemPrompt('explanation', { ...baseCtx, language: 'hi' }, null)
    expect(sys).toMatch(/Hindi \(Devanagari/i)
  })
})

describe('buildSimplifyPrompt', () => {
  it('contains explicit simplification instruction', () => {
    const sys = buildSimplifyPrompt(baseCtx, 'long technical answer')
    expect(sys).toMatch(/simplif/i)
    expect(sys).toMatch(/Grade 6/i)
    expect(sys).toMatch(/long technical answer/)
  })
})
```

- [ ] **Step 2: Confirm test fails**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/prompt-builder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement prompt-builder.ts**

```typescript
// supabase/functions/_shared/mol/prompt-builder.ts

import type { StudentContext, TaskType } from './types.ts'
import { gradeTier } from './classifier.ts'

const FOXY_BASE = `You are Foxy 🦊, a warm, encouraging AI tutor for Indian CBSE/NCERT students.
- Never reveal you are an AI model, GPT, Claude, or any vendor name. You are Foxy.
- Curriculum is current NCERT only. If unsure, say so honestly — do not invent content.
- Safety: this is a minor audience. No off-topic personal advice. Redirect emotional distress to a teacher/guardian.`

const TIER_STYLE = {
  junior: `Use very simple, friendly language (Grade 6–8). Short sentences. Lots of relatable everyday examples (food, cricket, family, school). Keep answers under 200 words. Avoid jargon — when you must use a term, immediately define it.`,
  middle: `Use clear, school-appropriate language (Grade 9–10). Moderate depth. Walk through reasoning. Connect to CBSE board exam patterns. Keep answers under 300 words.`,
  senior: `Use precise, rigorous language (Grade 11–12). Show full derivations and reasoning chains. Connect to competitive exam patterns. Up to 500 words.`,
}

const TASK_STYLE: Record<TaskType, string> = {
  explanation: `Teach the concept step by step. Start with a hook, then build the idea with one analogy, then state the formal definition, then give one worked example. End with a one-line check-for-understanding question.`,
  concept_explanation: `Define the concept clearly, then connect it to a familiar real-world phenomenon, then give the precise NCERT-aligned statement.`,
  step_by_step: `Produce a numbered list of solution steps. Each step has: (a) what we are doing, (b) why, (c) the result. End with a final boxed answer.`,
  reasoning: `Reason carefully. Lay out assumptions first, then derive. Cite NCERT chapter/section references where relevant. Show your work.`,
  quiz_generation: `Output strictly valid JSON. No prose outside JSON. Schema:
{ "items": [{ "stem": string, "options": string[4], "correct_index": 0|1|2|3, "explanation": string, "difficulty": "easy"|"medium"|"hard", "ncert_chapter": string }] }`,
  evaluation: `Grade the student's answer. Output JSON only.
Schema: { "score": 0-100, "rubric": [{"criterion": string, "max": number, "awarded": number, "feedback": string}], "overall_feedback": string }`,
  doubt_solving: `Diagnose the source of confusion first. Then resolve it with a short, clear explanation and one worked example. Avoid restating what the student already knows.`,
  ocr_extraction: `Read the image. Transcribe any printed/handwritten question text verbatim. Then identify subject, chapter (if inferable from content), and any options. Output JSON: { "extracted_text": string, "subject": string, "grade_hint": string|null, "options": string[]|null }`,
}

const EXAM_GOAL_HINT = {
  cbse: `Frame examples and tips for CBSE board exam patterns.`,
  jee: `Frame examples for JEE Main/Advanced — use rigorous derivations, dimensional analysis, and edge cases.`,
  neet: `Frame examples for NEET — emphasize biology/chemistry mechanisms with NCERT line numbers when relevant.`,
  general: ``,
}

const LEARNING_SPEED_HINT = {
  slow: `The student takes time to absorb new ideas. Pace slowly, recap at each step, and use one extra example.`,
  moderate: ``,
  fast: `The student moves quickly. Be concise. Skip elementary recap. Push toward harder applications.`,
}

const LANGUAGE_INSTRUCTION = {
  en: `Respond in English.`,
  hi: `Respond in Hindi (Devanagari script). Use age-appropriate Hindi.`,
  hinglish: `Respond in Hinglish (Hindi+English mix in Latin script, the way a Mumbai/Delhi student would write to a friend). Mix freely but keep the technical terms in English (e.g. "photosynthesis", "force", "integral").`,
}

export function buildSystemPrompt(
  task: TaskType,
  ctx: StudentContext,
  rag_context: string | null,
): string {
  const tier = gradeTier(ctx.grade)

  let p = FOXY_BASE + '\n\n'
  p += `STUDENT PROFILE\n`
  p += `- Grade: ${ctx.grade}\n`
  p += `- Subject: ${ctx.subject || 'general'}\n`
  if (ctx.exam_goal) p += `- Exam goal: ${ctx.exam_goal.toUpperCase()}\n`
  if (ctx.learning_speed) p += `- Pace: ${ctx.learning_speed}\n`
  p += '\n'

  p += `LANGUAGE\n${LANGUAGE_INSTRUCTION[ctx.language]}\n\n`

  p += `STYLE FOR THIS GRADE\n${TIER_STYLE[tier]}\n\n`

  if (ctx.exam_goal && EXAM_GOAL_HINT[ctx.exam_goal]) {
    p += `EXAM CONTEXT\n${EXAM_GOAL_HINT[ctx.exam_goal]}\n\n`
  }
  if (ctx.learning_speed && LEARNING_SPEED_HINT[ctx.learning_speed]) {
    p += `PACE\n${LEARNING_SPEED_HINT[ctx.learning_speed]}\n\n`
  }

  p += `TASK\n${TASK_STYLE[task]}\n\n`

  p += `FORMATTING\n`
  p += `- Use markdown headings (## for sections) and bullet points.\n`
  p += `- Bold key terms: **term**.\n`
  p += `- Wrap formulas in [FORMULA: expression] tags.\n`
  p += `- Wrap key concepts in [KEY: term] tags.\n`
  p += `- Wrap exam tips in [TIP: advice] tags.\n\n`

  if (rag_context && rag_context.trim().length > 0) {
    p += `NCERT REFERENCE MATERIAL (do not mention "reference material" to student):\n`
    p += rag_context.slice(0, 6000) + '\n\n'
    p += `Answer only using the provided NCERT context. If the context does not cover the question, say so honestly and suggest the student check with a teacher.\n`
  }

  return p
}

export function buildSimplifyPrompt(ctx: StudentContext, prior_answer: string): string {
  const tier = gradeTier(ctx.grade)
  return `You are Foxy 🦊, simplifying a more advanced answer for a Grade ${ctx.grade} student.

STYLE
${TIER_STYLE[tier]}
${LANGUAGE_INSTRUCTION[ctx.language]}

INSTRUCTION
Rewrite the answer below so it is clearer, more age-appropriate, and easier to follow.
Keep the same final result and the same NCERT references. Do not introduce new content.
Use the formatting tags ([KEY: …], [FORMULA: …], [TIP: …]).

ORIGINAL ANSWER
${prior_answer}`
}
```

- [ ] **Step 4: Confirm test passes**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/prompt-builder.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/mol/prompt-builder.ts supabase/functions/_shared/mol/__tests__/prompt-builder.test.ts
git commit -m "feat(mol): student-context-aware prompt builder"
```

---

### Task 8: Post-processor

**Files:**
- Create: `supabase/functions/_shared/mol/post-processor.ts`
- Test: `supabase/functions/_shared/mol/__tests__/post-processor.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/mol/__tests__/post-processor.test.ts

import { describe, it, expect } from 'vitest'
import { postProcess } from '../post-processor.ts'

describe('postProcess', () => {
  it('strips leading/trailing whitespace', () => {
    expect(postProcess('  hello\n\n  ', 'explanation')).toBe('hello')
  })

  it('removes any leaked vendor name', () => {
    const out = postProcess('As an AI language model from OpenAI, I think...', 'explanation')
    expect(out).not.toMatch(/AI language model/i)
    expect(out).not.toMatch(/OpenAI/i)
    expect(out).not.toMatch(/Anthropic/i)
    expect(out).not.toMatch(/Claude/i)
    expect(out).not.toMatch(/GPT/i)
  })

  it('redacts apparent email addresses', () => {
    const out = postProcess('Contact me at student@example.com for help.', 'explanation')
    expect(out).not.toMatch(/student@example\.com/)
  })

  it('truncates if absurdly long', () => {
    const long = 'x'.repeat(20000)
    expect(postProcess(long, 'explanation').length).toBeLessThanOrEqual(8000)
  })

  it('preserves JSON for quiz_generation without prose stripping', () => {
    const json = '{"items":[{"stem":"What?","options":["a","b","c","d"],"correct_index":0,"explanation":"because","difficulty":"easy","ncert_chapter":"1"}]}'
    expect(postProcess(json, 'quiz_generation')).toBe(json)
  })
})
```

- [ ] **Step 2: Confirm failure**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/post-processor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement post-processor.ts**

```typescript
// supabase/functions/_shared/mol/post-processor.ts

import type { TaskType } from './types.ts'

const MAX_LEN = 8000

const VENDOR_PATTERNS: RegExp[] = [
  /\bas an ai (language )?model[,.]?/gi,
  /\bi am an ai\b[^.]*\./gi,
  /\b(openai|anthropic|claude|gpt-\d+\w*|chatgpt|gpt|gemini)\b/gi,
]

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_PATTERN = /\+?\d[\d\s().-]{8,}\d/g

export function postProcess(text: string, task: TaskType): string {
  let out = text.trim()

  // Quiz/eval are strict JSON — don't touch.
  if (task !== 'quiz_generation' && task !== 'evaluation' && task !== 'ocr_extraction') {
    for (const p of VENDOR_PATTERNS) out = out.replace(p, '')
    out = out.replace(EMAIL_PATTERN, '[email]')
    out = out.replace(PHONE_PATTERN, '[number]')
    out = out.replace(/\n{3,}/g, '\n\n')
  }

  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN) + '\n\n…'
  return out.trim()
}
```

- [ ] **Step 4: Confirm pass**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/post-processor.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/mol/post-processor.ts supabase/functions/_shared/mol/__tests__/post-processor.test.ts
git commit -m "feat(mol): post-processor — vendor scrub, PII redact, length cap"
```

---

### Task 9: Feature-flag reader (Deno-side, cached)

**Files:**
- Create: `supabase/functions/_shared/mol/feature-flag.ts`

- [ ] **Step 1: Write feature-flag.ts**

```typescript
// supabase/functions/_shared/mol/feature-flag.ts

/**
 * Minimal Deno-side feature_flags reader for Edge Functions.
 * Mirrors src/lib/feature-flags.ts but uses Deno.env and avoids npm deps.
 * Cached per-worker for 5 minutes.
 */

interface FlagRow {
  flag_name: string
  is_enabled: boolean
  target_environments: string[] | null
  rollout_percentage: number | null
}

let cache: FlagRow[] | null = null
let cache_expiry = 0
const TTL_MS = 5 * 60_000

async function load(): Promise<FlagRow[]> {
  const now = Date.now()
  if (cache && now < cache_expiry) return cache

  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !key) return cache || []

  try {
    const res = await fetch(
      `${url}/rest/v1/feature_flags?select=flag_name,is_enabled,target_environments,rollout_percentage`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    )
    if (!res.ok) return cache || []
    cache = await res.json() as FlagRow[]
    cache_expiry = now + TTL_MS
    return cache
  } catch {
    return cache || []
  }
}

/**
 * Deterministic bucket: returns true for `student_id` if rollout_percentage covers it.
 * Uses simple string hash mod 100.
 */
function inRolloutBucket(student_id: string, percent: number): boolean {
  let h = 0
  for (let i = 0; i < student_id.length; i++) h = ((h << 5) - h + student_id.charCodeAt(i)) | 0
  return Math.abs(h) % 100 < percent
}

export async function isFlagEnabled(
  flag_name: string,
  ctx: { student_id?: string; environment?: string } = {},
): Promise<boolean> {
  const flags = await load()
  const f = flags.find((x) => x.flag_name === flag_name)
  if (!f || !f.is_enabled) return false

  if (f.target_environments && f.target_environments.length > 0) {
    const env = ctx.environment || Deno.env.get('ENVIRONMENT') || 'production'
    if (!f.target_environments.includes(env)) return false
  }

  if (typeof f.rollout_percentage === 'number' && f.rollout_percentage < 100) {
    if (!ctx.student_id) return false
    return inRolloutBucket(ctx.student_id, f.rollout_percentage)
  }

  return true
}

/** Force-clear cache (for tests / admin tools). */
export function _resetFlagCache(): void {
  cache = null
  cache_expiry = 0
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/mol/feature-flag.ts
git commit -m "feat(mol): Deno-side feature_flags reader with deterministic rollout buckets"
```

---

### Task 10: Telemetry — cost calc + log writer

**Files:**
- Create: `supabase/functions/_shared/mol/telemetry.ts`
- Test: `supabase/functions/_shared/mol/__tests__/telemetry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/mol/__tests__/telemetry.test.ts

import { describe, it, expect } from 'vitest'
import { calcCost } from '../telemetry.ts'

describe('calcCost', () => {
  it('computes openai gpt-4o-mini cost', () => {
    // input 0.15/1M, output 0.60/1M
    const usd = calcCost('openai', 'gpt-4o-mini', { prompt: 1_000_000, completion: 1_000_000 })
    expect(usd).toBeCloseTo(0.75, 4)
  })

  it('computes anthropic haiku cost', () => {
    // input 1/1M, output 5/1M
    const usd = calcCost('anthropic', 'claude-haiku-4-5-20251001', { prompt: 1_000_000, completion: 1_000_000 })
    expect(usd).toBeCloseTo(6.00, 4)
  })

  it('returns 0 for unknown model (no crash)', () => {
    expect(calcCost('openai', 'imaginary-model-9000', { prompt: 100, completion: 100 })).toBe(0)
  })
})
```

- [ ] **Step 2: Confirm fail**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/telemetry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement telemetry.ts**

```typescript
// supabase/functions/_shared/mol/telemetry.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { MolResult, ProviderResponse, TokenUsage, GenerateRequest } from './types.ts'

// USD per 1M tokens. Source: model_pricing table (seeded). Local fallback kept
// in sync with that migration. If you change either, change both.
const PRICING: Record<string, { input: number; output: number }> = {
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'openai/gpt-4o':      { input: 2.50, output: 10.00 },
  'anthropic/claude-haiku-4-5-20251001':  { input: 1.00, output: 5.00 },
  'anthropic/claude-sonnet-4-6-20251022': { input: 3.00, output: 15.00 },
}

const USD_TO_INR = Number(Deno.env.get('USD_TO_INR') ?? '83')

export function calcCost(provider: string, model: string, t: TokenUsage): number {
  const key = `${provider}/${model}`
  const p = PRICING[key]
  if (!p) return 0
  return (t.prompt / 1_000_000) * p.input + (t.completion / 1_000_000) * p.output
}

export function toInr(usd: number): number {
  return Math.round(usd * USD_TO_INR * 10000) / 10000
}

export interface LogPayload {
  request_id: string
  student_id: string | null
  task_type: string
  surface: string | null
  provider: string
  model: string
  passes: number
  fallback_count: number
  failure_chain: string | null
  latency_ms: number
  tokens: TokenUsage
  usd_cost: number
  inr_cost: number
  grade: string | null
  language: string | null
  exam_goal: string | null
}

let _client: ReturnType<typeof createClient> | null = null
function client() {
  if (_client) return _client
  _client = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
  return _client
}

/** Fire-and-forget. Never throw; observability must never break user requests. */
export function recordMolRequest(p: LogPayload): void {
  try {
    void client().from('mol_request_logs').insert({
      request_id: p.request_id,
      student_id: p.student_id,
      task_type: p.task_type,
      surface: p.surface,
      provider: p.provider,
      model: p.model,
      passes: p.passes,
      fallback_count: p.fallback_count,
      failure_chain: p.failure_chain,
      latency_ms: p.latency_ms,
      prompt_tokens: p.tokens.prompt,
      completion_tokens: p.tokens.completion,
      usd_cost: p.usd_cost,
      inr_cost: p.inr_cost,
      grade: p.grade,
      language: p.language,
      exam_goal: p.exam_goal,
    }).then(() => {}, () => {})
  } catch { /* swallow */ }
}

/** Combine pass-1 and pass-2 token usage into a single MolResult tokens block. */
export function sumTokens(responses: ProviderResponse[]): TokenUsage {
  return responses.reduce(
    (acc, r) => ({ prompt: acc.prompt + r.tokens.prompt, completion: acc.completion + r.tokens.completion }),
    { prompt: 0, completion: 0 } as TokenUsage,
  )
}
```

- [ ] **Step 4: Confirm pass**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/telemetry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/mol/telemetry.ts supabase/functions/_shared/mol/__tests__/telemetry.test.ts
git commit -m "feat(mol): cost calculation and mol_request_logs writer"
```

---

### Task 11: Routing-weight reader (feedback loop input)

**Files:**
- Create: `supabase/functions/_shared/mol/feedback.ts`

- [ ] **Step 1: Write feedback.ts**

```typescript
// supabase/functions/_shared/mol/feedback.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface WeightRow {
  task_type: string
  openai_weight: number  // 0..1
}

let cache: Record<string, number> | null = null
let cache_expiry = 0
const TTL_MS = 5 * 60_000

let _client: ReturnType<typeof createClient> | null = null
function client() {
  if (_client) return _client
  _client = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
  return _client
}

/** Returns { task_type: openai_weight } map. */
export async function getRoutingWeights(): Promise<Record<string, number>> {
  const now = Date.now()
  if (cache && now < cache_expiry) return cache

  try {
    const { data } = await client().from('mol_routing_weights')
      .select('task_type, openai_weight') as unknown as { data: WeightRow[] | null }
    cache = {}
    for (const r of data ?? []) cache[r.task_type] = r.openai_weight
    cache_expiry = now + TTL_MS
    return cache
  } catch {
    return cache || {}
  }
}

export function _resetWeightsCache(): void {
  cache = null
  cache_expiry = 0
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/mol/feedback.ts
git commit -m "feat(mol): routing-weights reader with 5min cache"
```

---

### Task 12: Migration — mol_request_logs

**Files:**
- Create: `supabase/migrations/20260518000001_mol_telemetry.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260518000001_mol_telemetry.sql
-- MOL request telemetry. One row per generateResponse() call.

create table if not exists public.mol_request_logs (
  id              uuid primary key default gen_random_uuid(),
  request_id      text not null,
  student_id      uuid references public.students(id) on delete set null,

  task_type       text not null,
  surface         text,                 -- 'foxy' | 'quiz' | 'solver' | 'ocr' | other

  provider        text not null,        -- 'openai' | 'anthropic' | 'hybrid'
  model           text not null,
  passes          smallint not null default 1,
  fallback_count  smallint not null default 0,
  failure_chain   text,                 -- e.g. 'openai:503,openai:503'

  latency_ms        integer not null,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  usd_cost          numeric(12,6) not null default 0,
  inr_cost          numeric(12,4) not null default 0,

  grade           text,
  language        text,
  exam_goal       text,

  created_at      timestamptz not null default now()
);

create index if not exists mol_request_logs_created_idx     on public.mol_request_logs (created_at desc);
create index if not exists mol_request_logs_student_idx     on public.mol_request_logs (student_id, created_at desc);
create index if not exists mol_request_logs_provider_idx    on public.mol_request_logs (provider, created_at desc);
create index if not exists mol_request_logs_task_type_idx   on public.mol_request_logs (task_type, created_at desc);
create index if not exists mol_request_logs_fallback_idx    on public.mol_request_logs (created_at desc) where fallback_count > 0;

alter table public.mol_request_logs enable row level security;

-- Only service role writes; super-admins read. Students never see this table.
create policy mol_request_logs_admin_read on public.mol_request_logs
  for select using (
    exists (
      select 1 from public.admin_users
      where admin_users.auth_user_id = auth.uid()
        and admin_users.admin_level in ('super_admin', 'platform_admin')
    )
  );

comment on table public.mol_request_logs is 'Per-call telemetry for the Model Orchestration Layer. See docs/MOL_ARCHITECTURE.md';
```

- [ ] **Step 2: Stage the migration but do NOT apply via MCP**

Per feedback memory `feedback_staging_migrations.md`, Supabase migrations go through the staging pipeline, not direct MCP apply. Just commit the file.

```bash
git add supabase/migrations/20260518000001_mol_telemetry.sql
git commit -m "feat(mol): migration for mol_request_logs telemetry table"
```

---

### Task 13: Migration — mol_feedback + mol_routing_weights

**Files:**
- Create: `supabase/migrations/20260518000002_mol_feedback.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260518000002_mol_feedback.sql
-- MOL student feedback and dynamic routing weights derived from feedback.

create table if not exists public.mol_feedback (
  id              uuid primary key default gen_random_uuid(),
  request_id      text not null,
  student_id      uuid references public.students(id) on delete cascade,
  rating          smallint not null check (rating between 1 and 5),
  helpful         boolean,
  time_spent_ms   integer,
  completed       boolean,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists mol_feedback_request_idx on public.mol_feedback (request_id);
create index if not exists mol_feedback_student_idx on public.mol_feedback (student_id, created_at desc);

alter table public.mol_feedback enable row level security;

-- Students can write feedback for their own requests (matched via mol_request_logs).
create policy mol_feedback_student_insert on public.mol_feedback
  for insert with check (
    student_id is null
    or exists (select 1 from public.students s where s.id = student_id and s.auth_user_id = auth.uid())
  );

-- Routing weights. Bayesian-style smoothing: openai_weight reflects relative
-- success rate of openai vs anthropic for this task_type, in [0,1].
create table if not exists public.mol_routing_weights (
  task_type       text primary key,
  openai_weight   numeric(4,3) not null default 0.500 check (openai_weight between 0 and 1),
  sample_size     integer not null default 0,
  updated_at      timestamptz not null default now()
);

-- Seed the table with neutral 0.5 weights for every task type
insert into public.mol_routing_weights (task_type, openai_weight)
values
  ('explanation', 0.500),
  ('concept_explanation', 0.500),
  ('step_by_step', 0.500),
  ('reasoning', 0.500),
  ('quiz_generation', 0.500),
  ('evaluation', 0.500),
  ('doubt_solving', 0.500),
  ('ocr_extraction', 0.500)
on conflict (task_type) do nothing;

alter table public.mol_routing_weights enable row level security;
create policy mol_routing_weights_read_all on public.mol_routing_weights for select using (true);

comment on table public.mol_feedback is 'Student feedback on MOL-generated responses. Drives mol_routing_weights.';
comment on table public.mol_routing_weights is 'Dynamic per-task routing weights. Updated nightly from mol_feedback.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260518000002_mol_feedback.sql
git commit -m "feat(mol): migrations for mol_feedback and mol_routing_weights"
```

---

### Task 14: Migration — model_pricing seed

**Files:**
- Create: `supabase/migrations/20260518000003_model_pricing.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260518000003_model_pricing.sql
-- Per-(provider, model) pricing rates. Used for cost reporting/audit.
-- Edge Functions keep an inline mirror in telemetry.ts for hot-path performance;
-- when you change a row here, change PRICING in telemetry.ts too.

create table if not exists public.model_pricing (
  provider           text not null,
  model              text not null,
  input_usd_per_1m   numeric(10,4) not null,
  output_usd_per_1m  numeric(10,4) not null,
  effective_from     timestamptz not null default now(),
  primary key (provider, model)
);

insert into public.model_pricing (provider, model, input_usd_per_1m, output_usd_per_1m) values
  ('openai',    'gpt-4o-mini',                    0.15,  0.60),
  ('openai',    'gpt-4o',                         2.50, 10.00),
  ('anthropic', 'claude-haiku-4-5-20251001',      1.00,  5.00),
  ('anthropic', 'claude-sonnet-4-6-20251022',     3.00, 15.00)
on conflict (provider, model) do update
  set input_usd_per_1m  = excluded.input_usd_per_1m,
      output_usd_per_1m = excluded.output_usd_per_1m,
      effective_from    = now();

alter table public.model_pricing enable row level security;
create policy model_pricing_read_all on public.model_pricing for select using (true);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260518000003_model_pricing.sql
git commit -m "feat(mol): seed model_pricing table"
```

---

### Task 15: Migration — feature flags seed (all default OFF)

**Files:**
- Create: `supabase/migrations/20260518000004_mol_feature_flags.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260518000004_mol_feature_flags.sql
-- All MOL flags default OFF. Promote via admin UI; rollout_percentage controls canary.

insert into public.feature_flags
  (flag_name, is_enabled, target_environments, rollout_percentage, description)
values
  ('ff_mol_enabled',          false, array['production','staging'], 0,
   'Master switch: route generation calls through the Model Orchestration Layer.'),
  ('ff_mol_openai_default',   false, array['production','staging'], 0,
   'Force OpenAI as primary for teaching tasks (explanation, step_by_step, quiz_generation).'),
  ('ff_mol_hybrid_mode_v1',   false, array['production','staging'], 0,
   'Enable two-pass hybrid mode (Claude reasoning → OpenAI simplify) for doubt_solving.'),
  ('ff_mol_cost_cap_inr',     false, array['production','staging'], 100,
   'Soft cost cap per request (₹). When enabled, MOL refuses to use premium models if projected cost > cap.')
on conflict (flag_name) do nothing;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260518000004_mol_feature_flags.sql
git commit -m "feat(mol): seed feature flags (all default OFF)"
```

---

### Task 16: Core orchestrator — generateResponse()

**Files:**
- Modify: `supabase/functions/_shared/mol/index.ts`

- [ ] **Step 1: Replace placeholder with real orchestrator**

```typescript
// supabase/functions/_shared/mol/index.ts

import type {
  GenerateRequest,
  MolResult,
  ProviderResponse,
  TaskType,
} from './types.ts'
import { MolError } from './types.ts'
import { classify } from './classifier.ts'
import { selectProviderChain, getMaxTokens, getSimplifyMaxTokens } from './router.ts'
import { buildSystemPrompt, buildSimplifyPrompt } from './prompt-builder.ts'
import { postProcess } from './post-processor.ts'
import {
  calcCost,
  toInr,
  recordMolRequest,
  sumTokens,
} from './telemetry.ts'
import { isFlagEnabled } from './feature-flag.ts'
import { getRoutingWeights } from './feedback.ts'
import { AnthropicProvider } from './providers/anthropic.ts'
import { OpenAIProvider } from './providers/openai.ts'
import type { ModelProvider, ProviderCallOptions } from './providers/base.ts'
import { canRequest, recordSuccess, recordFailure, isRetryable } from './providers/shared.ts'

export * from './types.ts'

const providers: Record<'openai' | 'anthropic', ModelProvider> = {
  openai:    new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
}

function newRequestId(): string {
  return crypto.randomUUID()
}

interface PassExecution {
  response: ProviderResponse
  fallback_count: number
  failure_chain: string[]
}

/**
 * Execute one Pass: try the chain top-down, retry retryable errors, fall through to next provider on failure.
 */
async function executePass(
  chain: Array<{ provider: 'openai' | 'anthropic'; model: string }>,
  opts: ProviderCallOptions,
): Promise<PassExecution> {
  let fallback = 0
  const failures: string[] = []

  for (let i = 0; i < chain.length; i++) {
    const target = chain[i]
    const provider = providers[target.provider]
    if (!provider.isConfigured()) {
      failures.push(`${target.provider}:not_configured`)
      fallback += 1
      continue
    }
    if (!canRequest(target.provider)) {
      failures.push(`${target.provider}:breaker_open`)
      fallback += 1
      continue
    }

    let attemptError: { code: string; status?: number } | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await provider.call(target.model, opts)
        recordSuccess(target.provider)
        return { response: r, fallback_count: i + (fallback - i), failure_chain: failures }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Extract status from "Provider 503: ..." form
        const m = msg.match(/(\d{3})/)
        const status = m ? parseInt(m[1], 10) : undefined
        attemptError = { code: msg, status }
        failures.push(`${target.provider}:${status ?? 'err'}`)
        if (status && !isRetryable(status)) break
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
          continue
        }
      }
    }

    recordFailure(target.provider)
    fallback += 1
    void attemptError // keep last-known error in `failures`
  }

  throw new MolError('NO_PROVIDER_AVAILABLE', 'All providers in chain failed', { failures })
}

export async function generateResponse(req: GenerateRequest): Promise<MolResult> {
  const start = Date.now()
  const request_id = req.config?.request_id || newRequestId()

  // Validate
  if (!req.input || !req.student_context?.student_id) {
    throw new MolError('INVALID_INPUT', 'student_context.student_id and input are required')
  }
  if (!req.input.question && !req.input.instruction && !req.input.image_url && !req.input.topic) {
    throw new MolError('INVALID_INPUT', 'input must contain question, instruction, image_url, or topic')
  }

  // Classify
  const task_type: TaskType = classify(req)

  // Read flags + weights in parallel
  const [hybridOn, openaiDefault, weights] = await Promise.all([
    isFlagEnabled('ff_mol_hybrid_mode_v1', { student_id: req.student_context.student_id }),
    isFlagEnabled('ff_mol_openai_default', { student_id: req.student_context.student_id }),
    getRoutingWeights(),
  ])

  const selected = selectProviderChain(task_type, {
    hybrid_enabled: hybridOn,
    openai_default: openaiDefault,
    weights,
  })

  // Per-request preferred_provider override (admin only)
  if (req.config?.preferred_provider) {
    selected.passes = selected.passes.map((p) => ({
      ...p,
      chain: [
        ...p.chain.filter((c) => c.provider === req.config!.preferred_provider),
        ...p.chain.filter((c) => c.provider !== req.config!.preferred_provider),
      ],
    }))
  }

  // Build prompt
  const system_prompt = buildSystemPrompt(task_type, req.student_context, req.rag_context ?? null)

  const user_messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (req.input.chat_history) user_messages.push(...req.input.chat_history.slice(-10))
  const user_text = req.input.question || req.input.instruction || req.input.topic || ''
  user_messages.push({ role: 'user', content: user_text })

  const max_tokens = req.config?.max_tokens_override ?? getMaxTokens(task_type)

  // Execute pass(es)
  const responses: ProviderResponse[] = []
  let totalFallback = 0
  const allFailures: string[] = []

  // Pass 1
  const pass1 = await executePass(selected.passes[0].chain, {
    system_prompt,
    user_messages,
    max_tokens,
    image_url: req.input.image_url,
    timeout_ms: 20_000,
  })
  responses.push(pass1.response)
  totalFallback += pass1.fallback_count
  allFailures.push(...pass1.failure_chain)

  // Pass 2 (simplify) for hybrid
  if (selected.mode === 'hybrid' && selected.passes[1]) {
    const simplify_prompt = buildSimplifyPrompt(req.student_context, pass1.response.text)
    const pass2 = await executePass(selected.passes[1].chain, {
      system_prompt: simplify_prompt,
      user_messages: [{ role: 'user', content: 'Rewrite the answer above.' }],
      max_tokens: getSimplifyMaxTokens(),
      timeout_ms: 15_000,
    })
    responses.push(pass2.response)
    totalFallback += pass2.fallback_count
    allFailures.push(...pass2.failure_chain)
  }

  // Combine
  const finalText = postProcess(responses[responses.length - 1].text, task_type)
  const tokens = sumTokens(responses)

  // Cost (sum across passes, each priced by its own model)
  let usd = 0
  for (const r of responses) usd += calcCost(r.provider, r.model, r.tokens)
  const inr = toInr(usd)

  const latency_ms = Date.now() - start

  // Telemetry (fire-and-forget)
  recordMolRequest({
    request_id,
    student_id: req.student_context.student_id,
    task_type,
    surface: req.config?.surface ?? null,
    provider: responses.length > 1 ? 'hybrid' : responses[0].provider,
    model: responses.map((r) => r.model).join(' + '),
    passes: responses.length,
    fallback_count: totalFallback,
    failure_chain: allFailures.length ? allFailures.join(',') : null,
    latency_ms,
    tokens,
    usd_cost: usd,
    inr_cost: inr,
    grade: req.student_context.grade,
    language: req.student_context.language,
    exam_goal: req.student_context.exam_goal ?? null,
  })

  return {
    text: finalText,
    provider: responses.length > 1 ? 'hybrid' : responses[0].provider,
    model: responses.map((r) => r.model).join(' + '),
    task_type,
    latency_ms,
    tokens,
    usd_cost: Math.round(usd * 1_000_000) / 1_000_000,
    inr_cost: inr,
    fallback_count: totalFallback,
    passes: responses.length,
    request_id,
  }
}
```

- [ ] **Step 2: Run all unit tests so far**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/`
Expected: PASS — classifier (8), router (6), prompt-builder (5), post-processor (5), telemetry (3), providers-anthropic (3), providers-openai (3) = 33 tests.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/mol/index.ts
git commit -m "feat(mol): generateResponse() orchestrator — classify→route→pass-chain→post→telemetry"
```

---

### Task 17: Integration test (full path, mocked providers)

**Files:**
- Create: `supabase/functions/_shared/mol/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// supabase/functions/_shared/mol/__tests__/integration.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'

function mockDeno(env: Record<string, string>) {
  // @ts-ignore
  globalThis.Deno = { env: { get: (k: string) => env[k] || '' } }
}

function mockFlags(flags: Array<{ flag_name: string; is_enabled: boolean; rollout_percentage: number | null; target_environments: string[] | null }>) {
  return new Response(JSON.stringify(flags), { status: 200 })
}

function mockOpenAIResponse(text: string) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
    model: 'gpt-4o-mini',
  }), { status: 200 })
}

function mockAnthropicResponse(text: string) {
  return new Response(JSON.stringify({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 50 },
    stop_reason: 'end_turn',
  }), { status: 200 })
}

describe('MOL integration', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    mockDeno({
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'ant-test',
      SUPABASE_URL: 'https://supa.test',
      SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
      USD_TO_INR: '83',
    })
    // Reset module caches (force re-import below)
    vi.resetModules()
  })

  it('routes explanation → openai gpt-4o-mini and computes cost', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/feature_flags')) return Promise.resolve(mockFlags([]))
      if (url.includes('mol_routing_weights')) return Promise.resolve(new Response('[]', { status: 200 }))
      if (url.includes('openai.com')) return Promise.resolve(mockOpenAIResponse('Photosynthesis is...'))
      if (url.includes('anthropic.com')) return Promise.resolve(mockAnthropicResponse('Shouldnt be called'))
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as unknown as typeof fetch

    const { generateResponse } = await import('../index.ts')
    const r = await generateResponse({
      input: { question: 'Explain photosynthesis' },
      student_context: { student_id: 's1', grade: '6', language: 'en' },
    })
    expect(r.provider).toBe('openai')
    expect(r.model).toBe('gpt-4o-mini')
    expect(r.task_type).toBe('explanation')
    expect(r.usd_cost).toBeGreaterThan(0)
    expect(r.fallback_count).toBe(0)
    expect(r.text).toMatch(/Photosynthesis/)
  })

  it('falls back to Anthropic when OpenAI returns 503', async () => {
    let openaiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/feature_flags')) return Promise.resolve(mockFlags([]))
      if (url.includes('mol_routing_weights')) return Promise.resolve(new Response('[]', { status: 200 }))
      if (url.includes('openai.com')) {
        openaiCalls += 1
        return Promise.resolve(new Response('upstream', { status: 503 }))
      }
      if (url.includes('anthropic.com')) return Promise.resolve(mockAnthropicResponse('From Claude'))
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as unknown as typeof fetch

    const { generateResponse } = await import('../index.ts')
    const r = await generateResponse({
      input: { question: 'Explain photosynthesis' },
      student_context: { student_id: 's1', grade: '6', language: 'en' },
    })
    expect(r.provider).toBe('anthropic')
    expect(r.fallback_count).toBeGreaterThanOrEqual(1)
    expect(openaiCalls).toBe(2) // 2 retries before fallback
    expect(r.text).toMatch(/From Claude/)
  })

  it('uses hybrid mode for doubt_solving when flag enabled', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/feature_flags')) {
        return Promise.resolve(mockFlags([
          { flag_name: 'ff_mol_hybrid_mode_v1', is_enabled: true, rollout_percentage: 100, target_environments: null },
        ]))
      }
      if (url.includes('mol_routing_weights')) return Promise.resolve(new Response('[]', { status: 200 }))
      if (url.includes('openai.com'))    return Promise.resolve(mockOpenAIResponse('Simplified for grade 11'))
      if (url.includes('anthropic.com')) return Promise.resolve(mockAnthropicResponse('Deep reasoning'))
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as unknown as typeof fetch

    const { generateResponse } = await import('../index.ts')
    const r = await generateResponse({
      input: { question: 'Why does moment of inertia depend on axis and how do I compute it for a rod?' },
      student_context: { student_id: 's1', grade: '11', language: 'en', exam_goal: 'jee' },
    })
    expect(r.task_type).toBe('doubt_solving')
    expect(r.provider).toBe('hybrid')
    expect(r.passes).toBe(2)
    expect(r.text).toMatch(/Simplified/)
  })
})
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run supabase/functions/_shared/mol/__tests__/`
Expected: PASS — 33 unit tests + 3 integration tests = 36 total.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/mol/__tests__/integration.test.ts
git commit -m "test(mol): full-path integration tests with fetch mocks"
```

---

### Task 18: Wire foxy-tutor behind ff_mol_enabled

**Files:**
- Modify: `supabase/functions/foxy-tutor/index.ts` (lines 230-414 only — keep auth/CORS/rate-limit/quota/RAG intact)

- [ ] **Step 1: Add MOL imports**

After line 38 (`import { createClient } from '...'`), add:

```typescript
import { generateResponse, MolError } from '../_shared/mol/index.ts'
import { isFlagEnabled } from '../_shared/mol/feature-flag.ts'
```

- [ ] **Step 2: Branch on flag inside the Deno.serve handler — replace lines 322 to 367**

Locate the block that begins with `const systemPrompt = buildSystemPrompt(...)` (around line 323) through the end of the Claude call (the `if (!claudeRes?.ok)` branch ending around line 367). Replace it with:

```typescript
    // ── MOL routing (flag-gated) ──────────────────────────────────────────────
    const useMol = await isFlagEnabled('ff_mol_enabled', { student_id })
    let reply: string
    let modelUsed = 'claude-haiku-4-5-20251001'
    let latencyMs = 0
    let molRequestId: string | null = null

    if (useMol) {
      const startMol = Date.now()
      try {
        const mol = await generateResponse({
          input: {
            question: safeMessage,
            chat_history: chatHistory.map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
          },
          student_context: {
            student_id,
            grade,
            language: safeLanguage as 'en' | 'hi' | 'hinglish',
            subject,
            board: studentBoard,
          },
          rag_context: ragContext,
          config: { surface: 'foxy', request_id: crypto.randomUUID() },
        })
        reply = mol.text
        modelUsed = mol.model
        latencyMs = mol.latency_ms
        molRequestId = mol.request_id
      } catch (err) {
        if (err instanceof MolError) console.error('MOL error:', err.code, err.message)
        else console.error('MOL unknown error:', err)
        circuitBreaker.recordFailure()
        return jsonResponse({
          reply: FALLBACK_REPLIES[safeLanguage] || FALLBACK_REPLIES.en,
          xp_earned: 5,
          session_id: activeSessionId,
          fallback: true,
        }, 200, {}, origin)
      }
      latencyMs = latencyMs || (Date.now() - startMol)
    } else {
      // ── Legacy direct Anthropic path (preserved unchanged) ──
      const systemPrompt = buildSystemPrompt(grade, subject, safeLanguage, safeMode, safeTopicTitle, safeChapters, safeLessonStep, ragContext)
      const messages = [...chatHistory, { role: 'user', content: safeMessage }]
      const startTime = Date.now()

      if (!circuitBreaker.canRequest()) {
        console.warn('Circuit breaker OPEN — returning fallback response')
        return jsonResponse({ reply: FALLBACK_REPLIES[safeLanguage] || FALLBACK_REPLIES.en, xp_earned: 5, session_id: activeSessionId, fallback: true }, 200, {}, origin)
      }

      async function callClaude(): Promise<Response> {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 20_000)
        try {
          return await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: systemPrompt, messages }),
            signal: controller.signal,
          })
        } finally { clearTimeout(timeoutId) }
      }

      let claudeRes: Response | null = null
      let lastError: string | null = null
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          claudeRes = await callClaude()
          if (claudeRes.ok) { circuitBreaker.recordSuccess(); break }
          if ([429, 500, 502, 503].includes(claudeRes.status) && attempt === 0) {
            lastError = `HTTP ${claudeRes.status}`
            await new Promise(r => setTimeout(r, 1000)); claudeRes = null; continue
          }
          lastError = `HTTP ${claudeRes.status}`; break
        } catch (fetchErr) {
          lastError = fetchErr instanceof DOMException && fetchErr.name === 'AbortError' ? 'Timeout (20s)' : String(fetchErr)
          if (attempt === 0) { await new Promise(r => setTimeout(r, 1000)); continue }
        }
      }

      latencyMs = Date.now() - startTime
      if (!claudeRes?.ok) {
        circuitBreaker.recordFailure()
        console.error('Claude API failed after retries:', lastError, `(${latencyMs}ms)`)
        return jsonResponse({ reply: FALLBACK_REPLIES[safeLanguage] || FALLBACK_REPLIES.en, xp_earned: 5, session_id: activeSessionId, fallback: true }, 200, {}, origin)
      }

      const claudeData = await claudeRes.json()
      reply = claudeData.content?.[0]?.text || 'Hmm, let me think about that...'
    }
```

- [ ] **Step 3: Update the ai_tutor_logs insert to record the correct model**

Find the `supabase.from('ai_tutor_logs').insert({...})` call (around line 401). Change the `model:` field from the literal string to the variable:

```typescript
    supabase.from('ai_tutor_logs').insert({
      student_id, session_id: activeSessionId, subject, grade, mode,
      topic_id: topic_id || null, lesson_step: safeLessonStep,
      message_length: safeMessage.length, reply_length: reply.length,
      latency_ms: latencyMs, model: modelUsed,
      xp_earned: xpEarned, language: safeLanguage, created_at: now,
      // new: link the ai_tutor_logs row to its MOL telemetry row when MOL was used
      mol_request_id: molRequestId,
    }).then(() => {}).catch(() => {})
```

- [ ] **Step 4: Add a tiny migration to add `mol_request_id` column to `ai_tutor_logs`**

Create: `supabase/migrations/20260518000005_ai_tutor_logs_mol_link.sql`

```sql
-- 20260518000005_ai_tutor_logs_mol_link.sql
-- Link ai_tutor_logs rows to mol_request_logs rows when MOL handled the call.
alter table public.ai_tutor_logs
  add column if not exists mol_request_id text;
create index if not exists ai_tutor_logs_mol_request_id_idx
  on public.ai_tutor_logs (mol_request_id) where mol_request_id is not null;
```

- [ ] **Step 5: Smoke-check the function lints under Deno (if available)**

Run: `deno check supabase/functions/foxy-tutor/index.ts`
Expected: no output, exit 0. If `deno` not on PATH, skip — Supabase deploy will type-check.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/foxy-tutor/index.ts supabase/migrations/20260518000005_ai_tutor_logs_mol_link.sql
git commit -m "feat(foxy-tutor): route through MOL when ff_mol_enabled (legacy path preserved)"
```

---

### Task 19: Wire ncert-solver behind ff_mol_enabled

**Files:**
- Modify: `supabase/functions/ncert-solver/index.ts`

- [ ] **Step 1: Add MOL imports near top**

After `import { getCorsHeaders, ... } from '../_shared/cors.ts'`, add:

```typescript
import { generateResponse, MolError } from '../_shared/mol/index.ts'
import { isFlagEnabled } from '../_shared/mol/feature-flag.ts'
```

- [ ] **Step 2: Branch the call**

Find the `const solutionRaw = await callClaude(solverPrompt, route.maxResponseTokens)` line. Replace it with:

```typescript
    const studentIdForFlag = user.id
    const useMol = await isFlagEnabled('ff_mol_enabled', { student_id: studentIdForFlag })

    let solutionRaw: string
    if (useMol) {
      try {
        const mol = await generateResponse({
          task_type: parsed.questionType === 'mcq' ? 'evaluation' : 'step_by_step',
          input: { question, options },
          student_context: {
            student_id: studentIdForFlag,
            grade,
            subject,
            language: 'en',
          },
          rag_context: ragContext,
          config: { surface: 'solver', request_id: crypto.randomUUID() },
        })
        solutionRaw = mol.text
      } catch (err) {
        if (err instanceof MolError) console.error('MOL error in solver:', err.code, err.message)
        solutionRaw = await callClaude(solverPrompt, route.maxResponseTokens)
      }
    } else {
      solutionRaw = await callClaude(solverPrompt, route.maxResponseTokens)
    }
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ncert-solver/index.ts
git commit -m "feat(ncert-solver): route through MOL when ff_mol_enabled"
```

---

### Task 20: Wire quiz-generator behind ff_mol_enabled

**Files:**
- Modify: `supabase/functions/quiz-generator/index.ts`

- [ ] **Step 1: Read the file's existing Anthropic call site**

Run: `grep -n "api.anthropic.com" supabase/functions/quiz-generator/index.ts`

Note the line numbers. The wire-up follows the same pattern as ncert-solver.

- [ ] **Step 2: Add MOL imports**

After existing imports, add:

```typescript
import { generateResponse, MolError } from '../_shared/mol/index.ts'
import { isFlagEnabled } from '../_shared/mol/feature-flag.ts'
```

- [ ] **Step 3: Wrap the existing Anthropic call**

Find the function that calls the Anthropic API (likely named `generateQuestions`, `callClaude`, or similar). Wrap its call site:

```typescript
    const useMol = await isFlagEnabled('ff_mol_enabled', { student_id })
    let raw: string
    if (useMol) {
      try {
        const mol = await generateResponse({
          task_type: 'quiz_generation',
          input: {
            instruction: `Generate ${count} multiple-choice questions on the chapter "${chapter}" for Grade ${grade} ${subject}. Difficulty mix: ${difficulty}. Output strict JSON only.`,
          },
          student_context: {
            student_id,
            grade,
            subject,
            language: 'en',
          },
          rag_context: ragContext,
          config: { surface: 'quiz', request_id: crypto.randomUUID(), max_tokens_override: 2500 },
        })
        raw = mol.text
      } catch (err) {
        if (err instanceof MolError) console.error('MOL error in quiz:', err.code, err.message)
        raw = await callClaude(generationPrompt) // existing legacy call
      }
    } else {
      raw = await callClaude(generationPrompt)
    }
```

(Variable names — `student_id`, `count`, `chapter`, `grade`, `subject`, `difficulty`, `ragContext`, `generationPrompt`, `callClaude` — match what the file currently uses. If a name differs, adapt to the file's actual identifiers; do not rename.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/quiz-generator/index.ts
git commit -m "feat(quiz-generator): route through MOL when ff_mol_enabled"
```

---

### Task 21: Wire scan-ocr behind ff_mol_enabled

**Files:**
- Modify: `supabase/functions/scan-ocr/index.ts`

- [ ] **Step 1: Add MOL imports + wrap the vision call**

Find the Anthropic vision call (the file POSTs to `api.anthropic.com/v1/messages` with an `image` content block). Wrap it:

```typescript
import { generateResponse, MolError } from '../_shared/mol/index.ts'
import { isFlagEnabled } from '../_shared/mol/feature-flag.ts'

// ... inside handler, where image_url + student_id are in scope ...

const useMol = await isFlagEnabled('ff_mol_enabled', { student_id })
let extractedJson: string
if (useMol) {
  try {
    const mol = await generateResponse({
      task_type: 'ocr_extraction',
      input: {
        question: 'Extract the question text and identify subject/grade from this image.',
        image_url,
      },
      student_context: { student_id, grade: grade ?? '10', subject: subject ?? 'general', language: 'en' },
      config: { surface: 'ocr', request_id: crypto.randomUUID() },
    })
    extractedJson = mol.text
  } catch (err) {
    if (err instanceof MolError) console.error('MOL ocr error:', err.code, err.message)
    extractedJson = await legacyVisionCall(image_url)
  }
} else {
  extractedJson = await legacyVisionCall(image_url)
}
```

(`legacyVisionCall` = whatever the file currently uses to call the Anthropic vision endpoint. Don't rename it; just wrap it.)

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/scan-ocr/index.ts
git commit -m "feat(scan-ocr): route through MOL when ff_mol_enabled (vision path)"
```

---

### Task 22: Student feedback API (Node-side App Router)

**Files:**
- Create: `src/app/api/mol/feedback/route.ts`

- [ ] **Step 1: Write route.ts**

```typescript
// src/app/api/mol/feedback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const BodySchema = z.object({
  request_id:    z.string().min(1).max(64),
  rating:        z.number().int().min(1).max(5),
  helpful:       z.boolean().optional(),
  time_spent_ms: z.number().int().min(0).max(86_400_000).optional(),
  completed:     z.boolean().optional(),
  notes:         z.string().max(500).optional(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten() }, { status: 400 })

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n) => cookieStore.get(n)?.value } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: student } = await supabase.from('students')
    .select('id').eq('auth_user_id', user.id).eq('is_active', true).maybeSingle()

  const { error } = await supabase.from('mol_feedback').insert({
    request_id:    parsed.data.request_id,
    student_id:    student?.id ?? null,
    rating:        parsed.data.rating,
    helpful:       parsed.data.helpful ?? null,
    time_spent_ms: parsed.data.time_spent_ms ?? null,
    completed:     parsed.data.completed ?? null,
    notes:         parsed.data.notes ?? null,
  })

  if (error) {
    console.error('mol_feedback insert failed:', error.message)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Add unit test**

Create: `src/__tests__/api-mol-feedback.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { POST } from '@/app/api/mol/feedback/route'

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' } }) }) }) }),
      insert: async () => ({ error: null }),
    }),
  }),
}))
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: '' }) }) }))

describe('POST /api/mol/feedback', () => {
  it('returns 200 on valid payload', async () => {
    const req = new Request('http://test/api/mol/feedback', {
      method: 'POST',
      body: JSON.stringify({ request_id: 'r1', rating: 4 }),
      headers: { 'content-type': 'application/json' },
    }) as unknown as import('next/server').NextRequest
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('rejects invalid rating', async () => {
    const req = new Request('http://test/api/mol/feedback', {
      method: 'POST',
      body: JSON.stringify({ request_id: 'r1', rating: 99 }),
      headers: { 'content-type': 'application/json' },
    }) as unknown as import('next/server').NextRequest
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/__tests__/api-mol-feedback.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/mol/feedback/route.ts src/__tests__/api-mol-feedback.test.ts
git commit -m "feat(api): /api/mol/feedback ingestion endpoint with Zod validation + RLS-friendly student linkage"
```

---

### Task 23: Routing-weight nightly updater (cron-callable SQL function)

**Files:**
- Create: `supabase/migrations/20260518000006_mol_weight_update_fn.sql`

- [ ] **Step 1: Write the SQL function**

```sql
-- 20260518000006_mol_weight_update_fn.sql
-- Nightly job: derive openai_weight per task_type from the last 7 days of feedback.
--
-- Logic: for each task_type, compute mean rating per provider.
-- openai_weight = openai_mean / (openai_mean + anthropic_mean), bounded to [0.1, 0.9]
-- so the router can never fully freeze out a provider — fallbacks must still flow.

create or replace function public.update_mol_routing_weights()
returns void
language plpgsql
security definer
as $$
declare
  rec record;
  oa numeric;
  an numeric;
  new_w numeric;
  total_samples integer;
begin
  for rec in select distinct task_type from public.mol_request_logs
            where created_at >= now() - interval '7 days'
  loop
    select coalesce(avg(f.rating)::numeric, 0), count(*)
      into oa, total_samples
      from public.mol_feedback f
      join public.mol_request_logs l on l.request_id = f.request_id
     where l.task_type = rec.task_type
       and l.provider in ('openai', 'hybrid')
       and f.created_at >= now() - interval '7 days';

    select coalesce(avg(f.rating)::numeric, 0)
      into an
      from public.mol_feedback f
      join public.mol_request_logs l on l.request_id = f.request_id
     where l.task_type = rec.task_type
       and l.provider = 'anthropic'
       and f.created_at >= now() - interval '7 days';

    if (oa + an) = 0 then
      new_w := 0.5;
    else
      new_w := oa / (oa + an);
      if new_w < 0.1 then new_w := 0.1; end if;
      if new_w > 0.9 then new_w := 0.9; end if;
    end if;

    insert into public.mol_routing_weights (task_type, openai_weight, sample_size, updated_at)
      values (rec.task_type, new_w, coalesce(total_samples, 0), now())
    on conflict (task_type) do update
      set openai_weight = excluded.openai_weight,
          sample_size   = excluded.sample_size,
          updated_at    = now();
  end loop;
end;
$$;

revoke all on function public.update_mol_routing_weights() from public;
grant execute on function public.update_mol_routing_weights() to service_role;
```

- [ ] **Step 2: Register the cron call**

The repo's `daily-cron` Edge Function (`supabase/functions/daily-cron/index.ts`) already runs once a day. Append one `supabase.rpc('update_mol_routing_weights')` call to its execution list.

Modify: `supabase/functions/daily-cron/index.ts`

Locate the function body. After the existing RPC invocations (search for `await supabase.rpc(`), append:

```typescript
// MOL: nightly routing-weight recomputation from last 7 days of feedback
try {
  const { error } = await supabase.rpc('update_mol_routing_weights')
  if (error) console.error('update_mol_routing_weights failed:', error.message)
  else console.log('update_mol_routing_weights: ok')
} catch (e) {
  console.error('update_mol_routing_weights threw:', e)
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260518000006_mol_weight_update_fn.sql supabase/functions/daily-cron/index.ts
git commit -m "feat(mol): nightly routing-weight updater + wire into daily-cron"
```

---

### Task 24: Super-admin health view (latency, fallback rate, cost)

**Files:**
- Create: `supabase/migrations/20260518000007_mol_health_view.sql`

- [ ] **Step 1: Write the view**

```sql
-- 20260518000007_mol_health_view.sql
-- Read-only view summarizing MOL health for the super-admin dashboard.
-- p50/p95 latency, fallback rate, cost per task_type over the last 24h.

create or replace view public.mol_health_24h as
with base as (
  select task_type, provider, fallback_count, latency_ms, usd_cost, inr_cost
    from public.mol_request_logs
   where created_at >= now() - interval '24 hours'
)
select
  task_type,
  count(*)                              as requests,
  round(avg(latency_ms))                as latency_avg_ms,
  percentile_cont(0.5) within group (order by latency_ms)  as p50_latency_ms,
  percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms,
  round(100.0 * sum(case when fallback_count > 0 then 1 else 0 end)::numeric / nullif(count(*),0), 2)
                                        as fallback_rate_pct,
  sum(usd_cost)::numeric(12,4)          as usd_cost_24h,
  sum(inr_cost)::numeric(12,2)          as inr_cost_24h
from base
group by task_type
order by requests desc;

grant select on public.mol_health_24h to authenticated;
-- RLS is on by virtue of underlying table; super-admin policy on mol_request_logs covers it.
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260518000007_mol_health_view.sql
git commit -m "feat(mol): mol_health_24h view for super-admin dashboard"
```

---

### Task 25: Cost-report script (manual + cron-friendly)

**Files:**
- Create: `scripts/mol-cost-report.ts`

- [ ] **Step 1: Write the script**

```typescript
// scripts/mol-cost-report.ts
//
// Usage: tsx scripts/mol-cost-report.ts [--hours=24]
//
// Prints a per-task / per-provider cost and volume summary.

import { createClient } from '@supabase/supabase-js'

const HOURS = Number(process.argv.find((a) => a.startsWith('--hours='))?.split('=')[1] ?? 24)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function main() {
  const since = new Date(Date.now() - HOURS * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('mol_request_logs')
    .select('task_type, provider, fallback_count, latency_ms, usd_cost, inr_cost')
    .gte('created_at', since)
  if (error) throw error

  const buckets = new Map<string, { count: number; usd: number; inr: number; latencySum: number; fallbacks: number }>()
  for (const r of data ?? []) {
    const key = `${r.task_type}/${r.provider}`
    const b = buckets.get(key) ?? { count: 0, usd: 0, inr: 0, latencySum: 0, fallbacks: 0 }
    b.count += 1
    b.usd += Number(r.usd_cost)
    b.inr += Number(r.inr_cost)
    b.latencySum += r.latency_ms
    b.fallbacks += r.fallback_count > 0 ? 1 : 0
    buckets.set(key, b)
  }

  const rows = [...buckets.entries()]
    .map(([k, v]) => ({
      bucket: k,
      requests: v.count,
      usd: v.usd.toFixed(4),
      inr: v.inr.toFixed(2),
      avg_latency: Math.round(v.latencySum / v.count),
      fallback_pct: ((v.fallbacks / v.count) * 100).toFixed(1),
    }))
    .sort((a, b) => parseFloat(b.usd) - parseFloat(a.usd))

  console.table(rows)
  const totalUsd = rows.reduce((s, r) => s + parseFloat(r.usd), 0)
  const totalInr = rows.reduce((s, r) => s + parseFloat(r.inr), 0)
  console.log(`\nWindow: last ${HOURS}h`)
  console.log(`Total: $${totalUsd.toFixed(4)}  /  ₹${totalInr.toFixed(2)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Commit**

```bash
git add scripts/mol-cost-report.ts
git commit -m "feat(mol): cost-report script"
```

---

### Task 26: Architecture documentation

**Files:**
- Create: `docs/MOL_ARCHITECTURE.md`

- [ ] **Step 1: Write the architecture doc**

```markdown
# Model Orchestration Layer — Architecture

## Why MOL exists

Before MOL, each AI surface (foxy-tutor, ncert-solver, quiz-generator, scan-ocr) carried its own copy of:
- HTTP retry logic
- Circuit breaker
- Rate limiter
- Prompt builder
- Fallback strings
- A hard-coded model name

Adding OpenAI meant duplicating that scaffolding four times. Switching from Haiku to Sonnet in one surface meant remembering to keep the other three in sync. The MOL collapses that surface area into one module with one entrypoint.

## One entrypoint

```typescript
import { generateResponse } from '../_shared/mol/index.ts'

const result = await generateResponse({
  input: { question, chat_history },
  student_context: { student_id, grade, language, exam_goal },
  rag_context,
  config: { surface: 'foxy', request_id },
})
```

The function:
1. Classifies `task_type` (or honors the explicit one).
2. Reads `ff_mol_*` flags + `mol_routing_weights`.
3. Picks a provider chain from the routing matrix.
4. Builds a student-context-aware system prompt.
5. Executes the chain (retry → circuit breaker → fallback to next provider).
6. For `doubt_solving` runs hybrid: Sonnet reasons, then gpt-4o-mini simplifies.
7. Post-processes (vendor scrub, PII redact, length cap).
8. Writes `mol_request_logs` row asynchronously.
9. Returns `MolResult`.

## Routing matrix

See `router.ts`. Defaults:

| task_type            | Primary               | Fallback              |
|----------------------|-----------------------|-----------------------|
| explanation          | openai/gpt-4o-mini    | anthropic/haiku-4.5   |
| step_by_step         | openai/gpt-4o-mini    | anthropic/haiku-4.5   |
| reasoning            | anthropic/sonnet-4.6  | openai/gpt-4o         |
| quiz_generation      | openai/gpt-4o-mini    | anthropic/haiku-4.5   |
| evaluation           | anthropic/haiku-4.5   | openai/gpt-4o-mini    |
| doubt_solving        | hybrid (sonnet→mini)  | anthropic/haiku-4.5   |
| ocr_extraction       | anthropic/sonnet-4.6  | openai/gpt-4o         |

Overrides (precedence order, highest first):
1. `mol_routing_weights.openai_weight > 0.5` → openai becomes primary.
2. `ff_mol_openai_default=true` → openai hard-primary for teaching tasks.
3. `ff_mol_hybrid_mode_v1=false` → `doubt_solving` collapses to single-pass.
4. `config.preferred_provider` per-request override (admin/eval only).

## Flags

| Flag                     | Default | Effect |
|--------------------------|---------|--------|
| `ff_mol_enabled`         | OFF     | Master switch. OFF = legacy direct-Anthropic path. |
| `ff_mol_openai_default`  | OFF     | Force OpenAI primary for teaching tasks. |
| `ff_mol_hybrid_mode_v1`  | OFF     | Enable Sonnet→GPT hybrid for `doubt_solving`. |
| `ff_mol_cost_cap_inr`    | OFF     | Soft cost cap per request (uses `rollout_percentage` as ₹ amount). |

All flags support `rollout_percentage` for canary; the Edge function reads `student_id` and buckets deterministically.

## Telemetry

Every call writes one row to `mol_request_logs`:
- `request_id`, `student_id`, `task_type`, `surface`
- `provider`, `model`, `passes`, `fallback_count`, `failure_chain`
- `latency_ms`, `prompt_tokens`, `completion_tokens`, `usd_cost`, `inr_cost`
- `grade`, `language`, `exam_goal`

`ai_tutor_logs.mol_request_id` cross-links so Foxy debugging can join.

`mol_health_24h` view powers the super-admin dashboard.

## Feedback loop

1. Student rates the answer → `POST /api/mol/feedback` writes `mol_feedback`.
2. Nightly `daily-cron` calls `update_mol_routing_weights()`.
3. The function reads last 7 days of (rating × provider) per task_type, computes per-task `openai_weight ∈ [0.1, 0.9]`, writes `mol_routing_weights`.
4. The Edge functions' 5-minute cache picks up the new weights on next refresh.

## Provider abstraction

`ModelProvider` interface (`providers/base.ts`):
```typescript
interface ModelProvider {
  id: 'openai' | 'anthropic'
  default_model: string
  isConfigured(): boolean
  call(model, opts): Promise<ProviderResponse>
}
```

To add **Gemini**: create `providers/gemini.ts` implementing the interface, add an `'gemini'` entry to the `providers` map in `index.ts`, add models to `model_pricing`, extend the routing matrix in `router.ts`. ~150 LOC, no other change.

## NCERT integrity

Per `references/ai-rag-foxy.md`: the MOL never invents curriculum content. RAG context is **always** built by the caller (the Edge function) before invoking MOL. The system prompt includes the "answer only using provided NCERT context" clause. If RAG returns empty, the caller is expected to return `{ code: 'CURRICULUM_GAP' }` and not call MOL at all.

## Cost model

See `telemetry.ts` `PRICING` (kept in sync with `model_pricing` table). Cost is calculated from `usage` returned by each provider; both passes of a hybrid call contribute to the total. INR conversion uses the `USD_TO_INR` env var (default 83).
```

- [ ] **Step 2: Commit**

```bash
git add docs/MOL_ARCHITECTURE.md
git commit -m "docs(mol): architecture overview"
```

---

### Task 27: Operations runbook

**Files:**
- Create: `docs/MOL_OPERATIONS.md`

- [ ] **Step 1: Write the runbook**

```markdown
# MOL Operations Runbook

## Daily checks

1. Open Super-admin → Platform health → MOL panel.
2. Verify the 24h table:
   - p95 latency < 2000ms (single), < 3500ms (hybrid).
   - Fallback rate < 2%.
   - Total cost trend within ±15% of yesterday.

Or from the CLI:
```bash
tsx scripts/mol-cost-report.ts --hours=24
```

## Rollout playbook

**Initial canary** (after staging green):
1. Set `ff_mol_enabled.rollout_percentage = 1` in admin UI.
2. Watch the cohort for 4 hours. Look for: p95 spike, fallback rate spike, user complaints.
3. If clean: ramp to 10% → 25% → 50% → 100% in 12-hour windows.

**Backout**:
- One toggle: `ff_mol_enabled.is_enabled = false`. Legacy path resumes immediately (5-min cache TTL).
- No code rollback needed.

## Alerts

| Condition                                 | Action |
|-------------------------------------------|--------|
| Fallback rate > 5% over 1h                | Check provider status pages. If one provider is down, the breaker should already be routing around it — verify with `select provider, count(*) from mol_request_logs where created_at > now() - interval '1 hour' group by 1`. |
| p95 latency > 4000ms                      | Likely upstream slowdown. Reduce `max_tokens` temporarily (env override) or shift to faster model. |
| Daily cost > ₹2000 (10x baseline)         | Check for runaway loop or dropped prompt-caching. Top offenders: `tsx scripts/mol-cost-report.ts --hours=24`. |
| Circuit breaker OPEN > 5 min              | Manual reset: redeploy the Edge function (workers restart, breaker state is per-worker). |

## Adding a new provider

1. Create `supabase/functions/_shared/mol/providers/<name>.ts` implementing `ModelProvider`.
2. Add `<name>` entries to `PRICING` in `telemetry.ts` AND to `model_pricing` migration.
3. Add `<name>` to the `providers` map in `index.ts`.
4. Extend `router.ts` `BASE_MATRIX` if it should be a primary anywhere.
5. Add the API key env var to Supabase Edge secrets.
6. Add a test stub mirroring `providers-anthropic.test.ts`.

## Updating prices

1. Update `model_pricing` rows via migration (do not UPDATE in-place — migration trail is the audit).
2. Update `PRICING` constant in `telemetry.ts` to match.
3. Ship both in one PR.

## Debugging a single bad answer

The student's response carries `request_id`. Lookup:
```sql
select * from public.mol_request_logs where request_id = '<id>';
select * from public.ai_tutor_logs where mol_request_id = '<id>';
```
Cross-reference the prompt by joining the chat session.

## Cost-cap behavior

When `ff_mol_cost_cap_inr` is enabled (`rollout_percentage` field is overloaded as the ₹ cap value), the router refuses to use premium models if the projected cost (rough estimate from input length × output cap × output price) exceeds the cap. The fallback provider/model is used instead. Logged in `failure_chain` as `<provider>:cost_cap`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/MOL_OPERATIONS.md
git commit -m "docs(mol): operations runbook"
```

---

### Task 28: Environment variable example update

**Files:**
- Modify: `.env.local.example`

- [ ] **Step 1: Append the new env vars**

Append to `.env.local.example`:

```bash

# === Model Orchestration Layer (MOL) ===
# OpenAI API key — created at platform.openai.com/api-keys
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx

# USD→INR conversion for cost reporting (defaults to 83)
USD_TO_INR=83

# (existing) Anthropic API key — used by MOL AnthropicProvider
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 2: Commit**

```bash
git add .env.local.example
git commit -m "docs(env): add OPENAI_API_KEY and USD_TO_INR for MOL"
```

---

### Task 29: Full test sweep + lint

- [ ] **Step 1: Run the MOL test suite**

```bash
npx vitest run supabase/functions/_shared/mol/__tests__/
```
Expected: PASS — 33 unit + 3 integration = 36 tests.

- [ ] **Step 2: Run the API test**

```bash
npx vitest run src/__tests__/api-mol-feedback.test.ts
```
Expected: PASS — 2 tests.

- [ ] **Step 3: Type-check the Next.js side**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: no errors. If the existing project type-checks, this should as well — the only new src/ file is the API route.

- [ ] **Step 4: Lint**

```bash
npm run lint
```
Expected: clean (or only pre-existing warnings).

- [ ] **Step 5: Build sanity**

```bash
npm run build
```
Expected: successful build. (Builds the Next.js app; does not deploy Edge Functions.)

- [ ] **Step 6: If all green, commit a tracking marker**

```bash
git commit --allow-empty -m "chore(mol): test + build sweep green"
```

---

### Task 30: Staging deploy + smoke test (operator step — coordinate with CEO)

**This step is human-coordinated. Do not auto-execute.**

- [ ] **Step 1: Push the branch + open the PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat: Model Orchestration Layer (MOL)" \
  --body "$(cat <<'EOF'
## Summary
- Add `supabase/functions/_shared/mol/` — unified multi-provider orchestration.
- Integrate OpenAI alongside Claude with deterministic routing + fallback chain.
- Migrate 4 Edge Functions (foxy-tutor, ncert-solver, quiz-generator, scan-ocr) to MOL behind `ff_mol_enabled` (default OFF — zero prod impact at merge).
- Add `mol_request_logs`, `mol_feedback`, `mol_routing_weights`, `model_pricing` tables.
- Add `/api/mol/feedback` ingestion endpoint and `mol_health_24h` view.
- All flags default OFF; legacy paths preserved verbatim.

## Test plan
- [ ] `npx vitest run supabase/functions/_shared/mol/__tests__/` (36 tests)
- [ ] `npx vitest run src/__tests__/api-mol-feedback.test.ts` (2 tests)
- [ ] `npm run build`
- [ ] Staging deploy: enable `ff_mol_enabled` at `rollout_percentage=1` for one synthetic student
- [ ] Verify `mol_request_logs` row, latency < 2s, no fallback
- [ ] Flip OFF, verify legacy path resumes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: After PR merges to main, staging pipeline applies migrations**

Per `feedback_staging_migrations.md`: do **NOT** apply migrations via MCP. Let the staging pipeline run. Verify all 7 migrations apply cleanly on staging.

- [ ] **Step 3: Set OPENAI_API_KEY on Supabase Edge secrets (staging then prod)**

```bash
supabase secrets set OPENAI_API_KEY="sk-proj-..." --project-ref gzpxqklxwzishrkiaatd  # staging
# After staging validation:
supabase secrets set OPENAI_API_KEY="sk-proj-..." --project-ref shktyoxqhundlvkiwguu  # prod
```

- [ ] **Step 4: Canary enable in staging**

In staging admin UI:
- `ff_mol_enabled.is_enabled = true`
- `ff_mol_enabled.rollout_percentage = 100` (staging is OK to fully enable)
- Run synthetic-student smoke against /foxy, /api/ncert-solver, /api/quiz-generator, /api/scan-ocr.

Confirm `select count(*) from mol_request_logs where created_at > now() - interval '15 minutes'` is > 0.

- [ ] **Step 5: Prod canary**

When staging is stable for ≥24h:
- Prod: `ff_mol_enabled.is_enabled = true`, `rollout_percentage = 1`.
- Watch the super-admin Platform health view for 4h.
- Ramp: 1% → 10% → 25% → 50% → 100% with 12h-24h between steps.

---

## Rollout Plan

| Stage         | When                          | Action                                                       | Rollback                  |
|---------------|-------------------------------|--------------------------------------------------------------|---------------------------|
| Merge         | PR green                       | Squash-merge to main; migrations apply via staging pipeline  | `git revert` the merge    |
| Staging       | After merge                    | `ff_mol_enabled` ON @ 100% in staging                         | Set flag OFF              |
| Prod canary   | 24h staging stable             | `ff_mol_enabled` ON @ 1% prod                                 | Set flag OFF              |
| Prod 10%      | 4h canary stable               | bump rollout_percentage                                      | Set flag OFF              |
| Prod 25%      | 12h stable                     | bump rollout_percentage                                      | Set flag OFF              |
| Prod 50%      | 12h stable                     | bump rollout_percentage                                      | Set flag OFF              |
| Prod 100%     | 24h stable at 50%              | bump rollout_percentage to 100                                | Set flag OFF              |
| Hybrid on     | After 1 week prod 100%         | Enable `ff_mol_hybrid_mode_v1` at 10% → 100%                  | Disable flag              |
| Legacy delete | After 2 weeks prod 100% stable | Remove inline Anthropic call paths from 4 Edge Functions (separate PR) | Re-add from git history |

---

## Compliance

Per Alfanumrik Blueprint §7:

```
Blueprint compliance
- Scope:
   * NEW: supabase/functions/_shared/mol/* (15 files)
   * NEW: src/app/api/mol/feedback/route.ts
   * NEW: 7 migrations (mol_request_logs, mol_feedback, model_pricing, feature_flags seed, ai_tutor_logs link, weight_update_fn, mol_health_view)
   * NEW: scripts/mol-cost-report.ts
   * NEW: docs/MOL_ARCHITECTURE.md, docs/MOL_OPERATIONS.md
   * MODIFIED: supabase/functions/{foxy-tutor,ncert-solver,quiz-generator,scan-ocr}/index.ts (additive, legacy paths preserved)
   * MODIFIED: supabase/functions/daily-cron/index.ts (one RPC call added)
   * MODIFIED: .env.local.example
- Hard rules: PASS
   * #1 Backward compat: legacy paths preserved verbatim, gated by ff_mol_enabled (default OFF)
   * #2 Minimal targeted changes: Edge Function modifications are wrapper additions
   * #3 No placeholders: all SQL uses real seed values; env-key placeholders are in .env.local.example only
   * #4 DB schema is SoT: new tables only — none of curriculum_topics/question_bank/student_learning_profiles/feature_flags structure altered
   * #5 NCERT-only via RAG: MOL receives rag_context from caller; caller still gates CURRICULUM_GAP
   * #6 Chapter taxonomy: untouched
   * #7 RBAC: mol_request_logs RLS limits read to super_admin / platform_admin
   * #8 Input validation: Zod on /api/mol/feedback; MolError on invalid input in MOL
   * #9 Razorpay/₹: N-A
   * #10 No ghost routes: only one new App Router route added, fully wired
   * #11 No new tools/services: stack-internal change; OpenAI added per explicit CEO request
   * #12 Root cause: N-A (greenfield)
- Backward compat: PASS — legacy Anthropic-direct path preserved in every modified Edge Function
- RBAC/auth: PASS — mol_request_logs admin-only read; mol_feedback RLS restricts write to row owner
- RAG/NCERT integrity: PASS — RAG retrieval remains in the caller; MOL prompt includes the NCERT-only clause
- Schema integrity: PASS — 4 new tables, 1 new view, 1 new function; no destructive ops
- Production impact: NONE at merge (flag OFF). Gradual via canary thereafter.
- Open questions: none
```

---

## Self-Review Notes

- **Spec coverage:** every section of the input brief maps to tasks — Unified API Layer (Tasks 1, 16), Task Classifier (Task 5), Routing Engine (Task 6), Response Pipeline (Tasks 7, 8, 16), Student Intelligence (Task 7 grade/language/exam tiers), Feedback (Tasks 11, 13, 22, 23), Cost Optimization (Tasks 10, 14, 25; routing matrix + caching + token caps section); architecture diagram (above), folder structure (above), engine code (Tasks 1-16), routing logic (Task 6), API endpoints (Task 22), inputs/outputs (above), cost strategy (above), scaling plan (above).
- **Placeholder scan:** no TBD/TODO; all SQL has real values; all code is complete; env-key placeholders confined to `.env.local.example`.
- **Type consistency:** `TaskType`, `StudentContext`, `GenerateRequest`, `MolResult`, `ProviderResponse`, `ModelProvider`, `Pass`, `SelectedChain` defined once in Task 1 and used unchanged through Tasks 3-17. Function names (`classify`, `selectProviderChain`, `getMaxTokens`, `buildSystemPrompt`, `buildSimplifyPrompt`, `postProcess`, `calcCost`, `recordMolRequest`, `isFlagEnabled`, `getRoutingWeights`, `generateResponse`) referenced consistently.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-model-orchestration-layer.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a ~30-task plan with strong test gating.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Higher context usage; you see every step.

Which approach?
