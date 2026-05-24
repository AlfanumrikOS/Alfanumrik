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

## Caller status (updated 2026-05-24, Phase 1A)

| Caller | Status | Notes |
|---|---|---|
| `bulk-question-gen` (legacy single-pass + oracle grader) | wired | `task_type='quiz_generation'` / `'evaluation'`. Admin posture: `preferred_provider='openai'`. |
| `bulk-non-mcq-gen` | wired | `task_type='quiz_generation'`. |
| `generate-concepts` | wired | `task_type='concept_explanation'`. |
| `generate-answers` | wired | `task_type='explanation'`. RAG context baked into `system_prompt_override`. |
| `extract-ncert-questions` | wired | `task_type='quiz_generation'`. |
| `parent-report-generator` | wired | `task_type='evaluation'`. Uses real `student_id` (not synthetic); template fallback retained for hard failures. |
| `bulk-question-gen` (grounded two-pass path, behind `ff_grounded_ai_quiz_generator`) | unwired | Routes through `grounded-answer/` service which carries its own LLM client (claude.ts). C4 MOL-shadow already mirrors that traffic into mol_request_logs. |
| `foxy-tutor` Edge Function | unwired | Student-facing. Phase 1B (needs inline verifier). |
| `ncert-solver` | unwired | Student-facing. Phase 1B. |
| `ncert-question-engine` | unwired | Student-facing (answer grading). Phase 1B. |
| `quiz-generator` Edge Function | unwired | Student-facing wrapper around `question_bank` reads — minimal direct LLM call; defer until Phase 1B holistic review. |
| `cme-engine` | unwired | Algorithmic (BKT/IRT) — no LLM call to migrate. |
| `grade-experiment-conclusion` | unwired | Student-facing (writes coins). Phase 1B. |
| `scan-ocr` | unwired | Vision (Claude Sonnet). MoL `ocr_extraction` chain exists but vision is being migrated separately. |
| `daily-cron` (challenge generator) | unwired | Background cron, low volume; defer. |
| `extract-diagrams` (caption Claude call) | unwired | Tiny surface; defer. |
| `bulk-jee-neet-import` / `bulk-jee-neet-curated-import` | unwired | Source-grep test pins haiku model string; complex 4-call pipeline — defer. |
| `embed-ncert-qa`, `embed-questions`, `embed-diagrams`, `generate-embeddings` | unwired | Embedding-only paths — MoL does not yet expose an embedding entrypoint. |
| `nep-compliance` | unwired | No direct LLM call. |
| `coverage-audit`, `verify-question-bank`, `monthly-synthesis-builder` | unwired | Route through `grounded-answer/` service or have no LLM call at all. |
| `grounded-answer/` | not-a-direct-caller | Owns its own Claude client (`claude.ts`) plus the C4 shadow leg into MoL. |

## Transition to Python (Phase 0+, 2026-05-24 onwards)

The CEO approved a strategic shift to consolidate all AI/ML code into a
Python FastAPI service on Google Cloud Run (`asia-south1` / Mumbai). The
3-6 week migration ports the 6 Phase 1A admin-traffic functions first
(lowest blast radius), then student-facing functions (Phase 1B in the
original MoL plan). The Python service lives at `python/services/ai/`
and is owned by ai-engineer; the Cloud Run deploy pipeline is owned by
architect; the operational layer (runbooks, dashboards, alerts) is owned
by ops.

The proxy pattern keeps URLs stable during transition. Each Supabase
Edge Function becomes a thin forwarder gated by the `ff_python_ai_services_v1`
feature flag with per-function rollout via
`metadata.functions_enabled[]` and `metadata.rollout_percentage`. Mobile
and web callers continue to hit the same Edge Function URLs they always
have. The proxy fan-out: when the flag is OFF the Edge Function executes
locally (current behavior); when ON it forwards to the Python service
on Cloud Run, awaits the response, and returns it unchanged. The same
`mol_request_logs` row is written either way — the
[super-admin MOL dashboard](../src/app/super-admin/mol-shadow/page.tsx)
keeps working without changes.

The TS MoL framework described in this document REMAINS LIVE throughout
the transition. The Python service is not a replacement for MoL — it
implements MoL in Python (same routing matrix, same provider chain, same
telemetry, same rollback flag semantics). The cutover is a per-function
runtime change, not a framework change. Once a function reaches
100%-Python with 7 days of clean cost/latency parity, ai-engineer can
delete the legacy TS Edge handler in a follow-up PR and the migration
tracking table in [PYTHON_AI_OPERATIONS.md](PYTHON_AI_OPERATIONS.md#migration-tracking)
is updated in the same PR.

Where to learn more:
- `docs/PYTHON_AI_ARCHITECTURE.md` — Python service architecture (architect, in flight)
- [`docs/PYTHON_AI_OPERATIONS.md`](PYTHON_AI_OPERATIONS.md) — daily checks, alerts, rollback procedures, cost monitoring, migration tracking
- [`docs/super-admin-python-ai-dashboard-spec.md`](super-admin-python-ai-dashboard-spec.md) — spec for the `/super-admin/python-ai-health` dashboard (frontend follow-up)
- [`.claude/regression-catalog.md`](../.claude/regression-catalog.md) — REG-72 health-contract pin for `/healthz` vs `/readyz`
