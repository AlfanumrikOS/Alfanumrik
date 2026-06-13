# MOL Python Cutover Runbook (strangler-fig)

**Spec:** A8 of the MOL Python-unification design (`docs/superpowers/specs/2026-06-13-mol-python-unification-design.md`).
**Phase:** 8 / Task 8.1.
**Owner:** ops (rollout execution) + architect (infra prerequisites) + assessment (quality-gate sign-off).
**Date:** 2026-06-13.

## What this is

The MOL orchestration brain is migrating from Deno (`supabase/functions/_shared/mol/`) to a single
Python service on Google Cloud Run (asia-south1 / Mumbai). The migration is a **strangler-fig**: each
AI Edge Function is cut over one at a time behind its own `ff_python_<function>_v1` flag, the Deno path
stays live as the safety net during transition, and the Deno MOL brain is deleted only after the last
function migrates.

This runbook is the locked operating procedure for that cutover. Each flag flip is reversible per
function (kill-switch) and globally (empty `PYTHON_AI_BASE_URL`). Nothing here is automatic — every flag
is activated deliberately, in the order below, with a 48h parity-green soak between bumps.

The proxy mechanics live in `supabase/functions/_shared/python-ai-proxy.ts` (`shouldProxyToPython` +
`forwardToPython`). The flag-name convention used by that helper is `ff_python_<function>_v1`, one flag
per function — confirmed against the helper's own header comment (`ff_python_bulk_question_gen_v1`,
`ff_python_foxy_tutor_v1`, `ff_python_ncert_solver_v1`, ...).

---

## Pre-rollout infrastructure prerequisites (architect-owned, MUST complete before ANY flag → ON in production)

These conditions were surfaced during the Phase 2 architect review and later phases. Every box must be
checked before the first production flag flip. Do not start the cutover order until this section is
green.

- [ ] Provision an Upstash Redis instance in (or nearest to) the Cloud Run region serving Indian
  traffic (asia-south1 / Mumbai), so breaker / cache round-trips stay single-digit-ms.
- [ ] Wire `UPSTASH_REDIS_REST_TOKEN` via Secret Manager — it is a bearer credential, **never** a plain
  env var, **never** logged. (`UPSTASH_REDIS_REST_URL` may be a plain env var.)
- [ ] Bound the Upstash HTTP client latency: set an explicit short timeout (~200-300ms) + low retry on
  the Redis client construction in `python/services/ai/mol/redis_client.py`, so a degraded Upstash adds
  bounded latency while still failing open. *(Tracked follow-up — required before enabling
  `ff_mol_circuit_breaker_v1` / `ff_mol_semantic_cache`.)*
- [ ] Confirm the Cloud Run image build installs `upstash-redis` (from `requirements.txt` /
  `pyproject.toml`).
- [ ] Ensure the Cloud Run entrypoint puts the repo root on `PYTHONPATH` so `cbse_parser` (imported by
  `foxy_tutor.py`, lives one level above `python/`) resolves at runtime — same path requirement pytest
  satisfies via `pyproject.toml pythonpath = [".", ".."]`. Without it the FastAPI app does not import.
- [ ] Set up the parity dashboard (ops): TS-baseline vs Python-shadow — answer-grade delta, cost delta,
  p95 latency delta, fallback-rate delta, and `event: error` rate; plus a ₹/student/day rollup from
  `mol_request_logs.inr_cost`.

---

## Cutover order (locked, spec A8)

Cut over in this exact order, top to bottom. Batch / non-student-facing functions go first (lowest blast
radius, no student waiting on the response); student-facing functions go last (highest blast radius).

### 1. Batch / non-student-facing first

| Function | Flag |
|---|---|
| `generate-answers` | `ff_python_generate_answers_v1` |
| `bulk-question-gen` (already started) | `ff_python_bulk_question_gen_v1` |
| `generate-concepts` | `ff_python_generate_concepts_v1` |
| `extract-ncert-questions` | `ff_python_extract_ncert_questions_v1` |
| `bulk-non-mcq-gen` | `ff_python_bulk_non_mcq_gen_v1` |
| `parent-report-generator` | `ff_python_parent_report_generator_v1` |
| `monthly-synthesis-builder` | `ff_python_monthly_synthesis_builder_v1` |

### 2. Semi-interactive

| Function | Flag |
|---|---|
| `quiz-generator` | `ff_python_quiz_generator_v1` |
| `ncert-solver` | `ff_python_ncert_solver_v1` |
| `verify-question-bank` | `ff_python_verify_question_bank_v1` |
| `grade-experiment-conclusion` | `ff_python_grade_experiment_conclusion_v1` |

### 3. Student-facing last

| Function | Flag |
|---|---|
| `foxy` / `grounded-answer` | `ff_python_foxy_tutor_v1` |
| `scan-solve` | `ff_python_scan_solve_v1` |

---

## Per-function gate sequence (repeat for each flag, top of order down)

Run this sequence in full for one flag before starting the next flag in the order.

1. **Pre-gate (quality):** `run_quality_gate` (Phase 6, `python/services/ai/mol/eval/harness.py`)
   returns `passed=True` for the function's task types. A `False` verdict **BLOCKS** the flip. Quality is
   owned by assessment (correctness reviewer); ai-engineer implements the harness.
2. **Confirm `PYTHON_AI_BASE_URL`** is set to the Cloud Run service URL (architect-controlled). Empty ⇒
   `shouldProxyToPython` returns `should_proxy=false` and the bump is a no-op (safe).
3. **Set the flag envelope `metadata`:** `{ "enabled": true, "kill_switch": false, "rollout_pct": 5 }`.
4. **Watch the parity dashboard (ops) for 48h.** Green criteria (all must hold):
   - answer-grade delta ≥ `-0.02` (Python not worse than the TS baseline beyond tolerance)
   - cost delta ≤ `+5%`
   - p95 latency delta ≤ `+500ms` (student-facing) / ≤ `+3s` (batch)
   - fallback-rate delta ≤ `+2pp`
   - zero `event: error` rate increase on student surfaces
5. **If green for 48h:** bump `rollout_pct` → `100`.
6. **After 100% green for a further 48h:** delete the corresponding Deno code path under
   `supabase/functions/_shared/mol/` for that function (freeze first, delete last, function-by-function).

---

## Kill-switch (any step)

- **Instant revert option A (per function):** set `metadata.kill_switch = true` — the proxy
  short-circuits to TS for that function.
- **Instant revert option B (global):** set `PYTHON_AI_BASE_URL` empty — all functions fall back to
  Deno at once.

Both are immediate and require no deploy.

---

## MOL flag inventory (cross-reference)

All flags below ship **OFF (dark)** by default and are activated deliberately, per this runbook.

| Flag | Layer | Default |
|---|---|---|
| `ff_mol_deterministic_priority` | MOL behavior (OpenAI-priority routing) | OFF |
| `ff_mol_circuit_breaker_v1` | MOL behavior (cross-instance breaker) | OFF |
| `ff_mol_cost_cap_v1` | MOL behavior (cost-cap enforcement) | OFF |
| `ff_mol_semantic_cache` | MOL behavior (semantic cache) | OFF |
| `ff_mol_stream_v1` | Caller-layer (SSE streaming path) | OFF |
| `ff_python_generate_answers_v1` | Per-function cutover | OFF |
| `ff_python_bulk_question_gen_v1` | Per-function cutover (already started) | OFF |
| `ff_python_generate_concepts_v1` | Per-function cutover | OFF |
| `ff_python_extract_ncert_questions_v1` | Per-function cutover | OFF |
| `ff_python_bulk_non_mcq_gen_v1` | Per-function cutover | OFF |
| `ff_python_parent_report_generator_v1` | Per-function cutover | OFF |
| `ff_python_monthly_synthesis_builder_v1` | Per-function cutover | OFF |
| `ff_python_quiz_generator_v1` | Per-function cutover | OFF |
| `ff_python_ncert_solver_v1` | Per-function cutover | OFF |
| `ff_python_verify_question_bank_v1` | Per-function cutover | OFF |
| `ff_python_grade_experiment_conclusion_v1` | Per-function cutover | OFF |
| `ff_python_foxy_tutor_v1` | Per-function cutover (student-facing) | OFF |
| `ff_python_scan_solve_v1` | Per-function cutover (student-facing) | OFF |

---

## Definition of done (sub-project A)

- All 13 `ff_python_*_v1` cutover flags at `rollout_pct=100` with 48h green parity.
- Deno `_shared/mol/` brain deleted.
- REG-120..REG-124 catalogued and passing in CI.
