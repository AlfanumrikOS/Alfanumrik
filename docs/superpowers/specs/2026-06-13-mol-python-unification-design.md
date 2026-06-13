# MOL Python Unification & Hardening — Design Spec

> **Status:** Approved (design) — 2026-06-13. Awaiting spec review before plan-writing.
> **Owner:** ai-engineer (implements) · architect (infra/security) · assessment (routing correctness + quality gate) · testing
> **Approver:** CEO (ceo@alfanumrik.com) — model-provider + architecture approval granted 2026-06-13.
> **Sub-project:** A of 5 (see "Program context"). Sub-projects B–E are explicitly out of scope here.

---

## Program context (why this is sub-project A)

The CEO request — "strengthen the AI/ML backend, autoscale NCERT → JEE/NEET/competitive, upload-and-solve question papers at high accuracy, beat top adaptive-learning EdTechs, and tune the Voyage RAG" — decomposes into five independent subsystems, each with its own spec → plan → implementation cycle:

| # | Sub-project | Depends on |
|---|---|---|
| **A** | **LLM Orchestration Hardening (this spec)** | — (foundation) |
| B | RAG / Retrieval Quality Engine | A |
| C | Core Adaptive Learning Engine | A, B |
| D | Curriculum Auto-Scale (NCERT → JEE/NEET/+) | A, B, C |
| E | Question-Paper Solver | A, B |

Build sequence: **A → B → (C ∥ E) → D.** This spec covers **A only**.

---

## Goal

Make the Model Orchestration Layer (MOL) a single, hardened, OpenAI-priority orchestration brain running on Python (Cloud Run), with Deno Edge Functions and Next.js routes reduced to thin clients. Eliminate the dual-runtime drift risk and close the reliability, cost, quality, latency, and observability gaps that block scaling.

**Objective priority (CEO-locked):** e (unify on Python) → a (reliability) → b (cost) → c (quality) → d (latency).

## Non-goals (out of scope for A)

- RAG retrieval tuning (sub-project B).
- Learner-state / mastery model changes (sub-project C).
- Competitive-exam curriculum or scope-rail expansion (sub-project D); P12 stays CBSE-locked.
- OCR / paper-solving flow (sub-project E).
- Changing the score/XP/anti-cheat invariants (P1–P6). MOL never computes scores.

---

## Current state (verified 2026-06-13)

- **Two full MOL implementations exist as hand-synced "mirror twins":**
  - Deno/TypeScript: `supabase/functions/_shared/mol/` (router, providers, classifier, prompt-builder, post-processor, grader, telemetry, 35-file test suite).
  - Python/FastAPI on Cloud Run: `python/services/ai/mol/` + `python/services/ai/api/` (mirrors the TS contract; `main.py` exposes `/v1/generate` and per-function business routers).
- **Strangler-fig migration scaffolding is already live:** `supabase/functions/_shared/python-ai-proxy.ts` forwards Edge Function calls to the Python service, gated per-function by `ff_python_*_v1` flags, with a hard kill-switch (empty `PYTHON_AI_BASE_URL` → `should_proxy=false`). Batch functions (`bulk-question-gen`, `generate-answers`) are first in the cutover order.
- **OpenAI-priority is already the de-facto default but non-deterministic:** `router.ts` selects the primary via `Math.random() < weights[task]` (default weight 0.8), plus an `openai_default` flag that pins `gpt-4o-mini` to the front of teaching tasks. Task matrix: `gpt-4o`/`sonnet` for reasoning + vision, `gpt-4o-mini`/`haiku` for teaching.
- **Reliability gap:** Python `orchestrator.py:_execute_pass` explicitly does NOT implement the per-worker circuit breaker the TS path has. Shifting traffic to Python today loses the breaker.
- **Telemetry plumbing is mature:** `MolResult` already carries `usd_cost`/`inr_cost`/`latency_ms`/`fallback_count`/`passes`; `mol_request_logs` gets one row per call; an LLM grader + grader-cron + shadow-pair tables exist.
- **Cost-cap is a defined error (`COST_CAP_EXCEEDED`) but enforcement is not wired.**
- **No streaming entry point in either MOL** (Foxy first-token latency suffers).

---

## Approach decision

**Chosen: Approach 1 — finish the strangler-fig.** Continue per-function `ff_python_*` cutover until 100% of AI traffic runs on Python, harden Python's gaps as each function cuts over, then delete the Deno MOL brain. Reversible per function via flag; hard kill-switch via `PYTHON_AI_BASE_URL`.

**Rejected:**
- *Big-bang to Python-sole-brain* — one bad deploy hits every AI surface at once; unacceptable blast radius.
- *Keep dual-twin + parity tests* — does not actually unify; perpetuates the maintenance burden the CEO asked to remove.

---

## Architecture (approved)

### A1. Target topology
Python Cloud Run = single orchestration brain. Deno Edge Functions + Next.js routes = thin clients that do auth + RAG retrieval, call the Python MOL endpoint, and stream the response back. The Deno MOL (`_shared/mol/`) is frozen on cutover start and deleted after the last function migrates.

### A2. OpenAI-priority routing (deterministic + health-aware)
- **Primary = OpenAI, always**, unless: the OpenAI circuit is OPEN, OR a per-task cost/quality rule overrides → fail over to Claude.
- The probabilistic `weights` / `Math.random()` mechanism is retained **only** behind a `shadow`/experiment flag, never on the live priority path.
- Task matrix preserved: `gpt-4o` (reasoning, vision), `gpt-4o-mini` (teaching/generation), with `sonnet`/`haiku` as the Claude failover tier.
- Result: OpenAI-first is a *guarantee*; Claude is the *safety net*.

### A3. Reliability hardening (objective a)
- Port the TS circuit breaker into Python as a **cross-instance breaker** backed by Upstash Redis (Cloud Run is multi-instance; in-memory state won't share). State machine: CLOSED → (3 failures / 10s) → OPEN (30s) → HALF-OPEN (2 consecutive successes → CLOSE). Key: `(provider, task_type)`.
- Bounded retries with jittered exponential backoff; only retryable HTTP statuses retried.
- **Graceful degradation:** if all providers in the chain fail, return a safe, age-appropriate fallback message (P12-compliant) — a student never sees a raw error or stack trace.

### A4. Cost controls (objective b)
- Enforce `COST_CAP_EXCEEDED` with a real per-request token/₹ ceiling per task type.
- **Semantic cache** keyed on `(task_type, grade, subject, normalized_query)` with a TTL, to cut duplicate-question spend. Cache short-circuits before any provider call (consistent with the Foxy single-retrieval contract, REG-50).
- Per-tenant ₹ telemetry surfaced from existing `MolResult.inr_cost`; daily ₹/student rollup for the super-admin AI-health dashboard (ops).

### A5. Quality gate (objective c)
- Wire the existing LLM grader (`mol/grader.py`) into a **pre-cutover eval harness**: a golden set per task type, graded, with a regression threshold. A cutover flag flip is **blocked** if Python's graded answer quality is worse than the Deno baseline beyond tolerance.
- Quality is owned by assessment (correctness reviewer); ai-engineer implements the harness.

### A6. Latency / streaming (objective d)
- Add a streaming entry point to the Python MOL: `POST /v1/generate/stream` (Server-Sent Events). Foxy/solver student-facing surfaces stream first-token; batch jobs keep the non-streaming `/v1/generate`.
- Thin Deno/Next clients pass the stream through to the browser.

### A7. Observability
- Keep one `mol_request_logs` row per call.
- Add a **parity dashboard** (TS-baseline vs Python-shadow): answer-grade delta, cost delta, latency delta, fallback rate. This dashboard is the cutover gate for each function.

### A8. Rollout & safety (strangler-fig order)
1. Batch / non-student-facing first: `generate-answers`, `bulk-question-gen` (already started), `generate-concepts`, `extract-ncert-questions`, `bulk-non-mcq-gen`, `parent-report-generator`, `monthly-synthesis-builder`.
2. Semi-interactive: `quiz-generator`, `ncert-solver`, `verify-question-bank`, `grade-experiment-conclusion`.
3. Student-facing last: `foxy` / `grounded-answer`, `scan-solve`.

Per-function gate sequence: flag on at **5%** → parity dashboard green for **48h** → **100%** → delete the corresponding Deno code path. Kill-switch at any step: set `PYTHON_AI_BASE_URL` empty (instant revert to Deno).

### A9. Testing & regression
- **Contract-parity tests:** identical input → identical routing decision + identical `mol_request_logs` telemetry shape across TS and Python (golden cassettes).
- **Breaker tests:** OPEN/HALF-OPEN/CLOSE transitions on the cross-instance store.
- **Cost-cap tests:** request exceeding ceiling raises `COST_CAP_EXCEEDED` before provider call.
- **Streaming tests:** SSE chunking + cancellation.
- **Graceful-degradation test:** both providers down → safe P12 fallback, never a 5xx to the student.
- **New regression-catalog entries (REG-135+):** deterministic OpenAI-priority; cross-instance breaker; cost-cap enforcement; cutover parity gate; streaming-path safety.

---

## Component / file map (what changes)

**Python (primary work):**
- `python/services/ai/mol/router.py` — deterministic OpenAI-priority selection; gate probabilistic weights behind shadow flag.
- `python/services/ai/mol/orchestrator.py` — wire breaker, cost-cap enforcement, graceful degradation.
- `python/services/ai/mol/breaker.py` *(new)* — cross-instance circuit breaker (Upstash Redis client).
- `python/services/ai/mol/cache.py` *(new)* — semantic cache.
- `python/services/ai/api/v1/generate.py` — add `/v1/generate/stream` SSE endpoint.
- `python/services/ai/mol/eval/` *(new)* — golden-set quality harness + grader wiring.
- `python/tests/unit/`, `python/tests/integration/` — breaker, cost-cap, streaming, parity tests.

**Deno (thin-client conversion + freeze):**
- `supabase/functions/_shared/python-ai-proxy.ts` — extend to cover streaming + remaining functions.
- `supabase/functions/_shared/mol/` — frozen on cutover start; deleted per-function as each migrates.
- Per-function `index.ts` callers — route through `forwardToPython` once their flag reaches 100%.

**Infra / config (architect):**
- Cloud Run service config (`python/deploy/service.yaml`) — concurrency, min-instances for cold-start, Redis env wiring.
- New feature flags: `ff_mol_deterministic_priority`, `ff_python_*_v1` for remaining functions, `ff_mol_semantic_cache`.

**Ops:**
- Super-admin AI-health dashboard — add parity panel + ₹/student rollup.

---

## Review chain (P14)

AI orchestration change → **ai-engineer** (implements) must be reviewed by **assessment** (routing correctness + quality gate) and **testing**. Infra (Cloud Run, Redis, security, deploy config) → **architect**. Cost/health dashboard → **ops**. Model-provider approval: granted by CEO 2026-06-13.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Cloud Run cold-start adds latency on student-facing paths | `min-instances ≥ 1`; student-facing functions cut over last, after latency is measured |
| Cross-instance breaker adds a Redis dependency on the hot path | Fail-open: if Redis is unreachable, treat circuit as CLOSED and log; never block a request on breaker-store failure |
| Parity drift between TS and Python during the transition | Contract-parity golden tests run in CI; parity dashboard gates each cutover |
| Semantic cache returns stale/wrong answer | Conservative key (task+grade+subject+normalized query), short TTL, never cache low-confidence or personalized outputs |
| Deleting the Deno MOL removes the fallback | Delete only per-function, only after that function is 100% on Python for 48h with green parity |

## Open questions (resolve during plan-writing, not blocking design)

1. Exact per-task ₹ cost ceilings (assessment + ops to set from current `mol_request_logs` spend distribution).
2. Semantic-cache backing store: Upstash Redis (reuse) vs pgvector similarity. Default: Upstash exact-match first; pgvector semantic match as a follow-up.
3. Whether `ncert-solver` survives as a distinct task or folds into `doubt_solving` post-unification.

---

## Definition of done (sub-project A)

- 100% of AI traffic flows through the Python MOL; Deno `_shared/mol/` brain deleted.
- OpenAI-priority is deterministic and health-aware; verified by REG-135.
- Cross-instance breaker live and tested; graceful degradation verified.
- Cost-cap enforced; ₹/student telemetry on the AI-health dashboard.
- Quality eval harness gates cutovers; no quality regression vs Deno baseline.
- Streaming live on student-facing surfaces.
- All P-invariants intact (P10 bundle untouched — this is backend; P12 AI safety preserved; P13 no PII to providers).
