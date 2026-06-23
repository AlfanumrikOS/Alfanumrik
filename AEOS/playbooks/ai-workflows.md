# AI Feature Workflow Playbook

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Playbook
**Priority:** P0 (Critical — operationalizes product invariant P12 "AI Safety" and P13 "Data Privacy" across every AI Edge Function)
**Applies To:** Every AI-powered request path at Alfanumrik — the grounded-answer RAG tutor, the NCERT solver, adaptive quiz generation, the cognitive mastery engine, and the shared model-orchestration layer they all build on.

---

# Purpose

AEOS v1.0 established the *principles* of AI safety and engineering discipline. This v1.1 playbook is the *how-to* layer: the concrete, repeatable request lifecycle that every AI feature on Alfanumrik must follow, grounded in the code that ships today.

An AI request at Alfanumrik is never a single `fetch` to a model. It is a governed pipeline — admit, ground, call, verify, cache, audit — where every stage has a defensible reason to exist and a failure mode it closes. This document is the canonical description of that pipeline. When you add or change an AI feature, you implement *this* lifecycle, not a shortcut around it.

The hard constraint above all guidance here is **P12**: no unfiltered LLM output ever reaches a student, every response is CBSE-scoped and age-appropriate, daily usage is quota-limited, and a fallback always exists. Where this playbook and P12 disagree, P12 wins.

---

# The standard AI request lifecycle

Every AI feature follows the same stage sequence. The reference implementation is `supabase/functions/grounded-answer/` — `index.ts` is thin HTTP glue, `pipeline.ts` owns the stage order (documented there as spec §6.4 steps 1-9).

```
1. Admit       → parse, validate, authenticate, authorize, reserve quota
2. Ground      → resolve student scope, retrieve + rerank NCERT chunks
3. Decide      → cache lookup, coverage precheck, circuit-breaker gate, abstain checks
4. Call        → model orchestration (Haiku-primary, fallback chain), capped timeout
5. Validate    → grounding-check, post-process, structured-schema validation, word cap
6. Cache       → store the grounded answer keyed by query + scope
7. Audit       → settle quota, record circuit outcome, write metadata-only audit row
```

No stage is optional. Skipping a stage is a rejection condition under the same logic AEOS core doc 16 applies to MCP operations — observable correctness over inferred shortcuts.

---

# Stage 1 — Input validation & admission

The request never touches a model until it has been admitted. In `grounded-answer/index.ts` this is the `admitRequest()` function, run before any model logic:

- **Read the raw body once**, hash it (`sha256Hex`) for attribution, then parse JSON. Malformed body → `400` before any work.
- **Validate the request shape** (`validators.ts` → `validateRequest`). A failed field → `400` with the offending field name, never a stack trace.
- **Resolve the security principal** (`_shared/security/auth.ts`) and the route policy (`_shared/security/policy.ts`). A disabled policy, a JWT caller on an internal-only route, or an internal caller where signed-internal is not allowed → `403`, short-circuited before DB I/O.
- **Estimate usage and reserve quota** (`_shared/security/quota.ts` → `estimateGroundedAnswerUsage` → `computeEstimatedCost` → `reserveQuota`). This is the daily-usage-limit gate and it runs **before** the Claude call (see "Daily usage limits" below).

Admission control is also expressed for the simpler routes via `_shared/security/ai-admission.ts` (`createStaticAiRouteProfile` / `admitAiRoute` / `finalizeAiRoute`) — e.g. `ncert-solver` declares a static profile (`callerTypes: ['student', 'internal_service']`, `modelName: 'claude-haiku-4-5-20251001'`, token floors) that gates who may call the route.

---

# Stage 2 — Retrieval & grounding (the anti-hallucination spine)

Grounding is what separates a tutor from a chatbot. The pipeline retrieves NCERT content and forces the model to answer *from it*.

1. Resolve the student scope: grade as a **string** `"6"`–`"12"` (P5), `subject_code`, and chapter. Out-of-grade content must never surface.
2. Run the coverage precheck (`coverage.ts`) — if the chapter is not ingested, abstain with `chapter_not_ready` rather than guessing.
3. Generate the query embedding (`embedding.ts`, Voyage) — best-effort; a null embedding degrades gracefully to keyword retrieval.
4. Retrieve candidate chunks (`retrieval.ts` + `_shared/retrieval.ts`), rerank (`_shared/reranking.ts`, Voyage rerank), and optionally diversify (`_shared/rag/mmr.ts`), all filtered by grade/subject.
5. Sanitize each chunk for the prompt (`_shared/rag/sanitize.ts`) before injection.
6. Inject the chunks into the Claude system block. Long system blocks carry Anthropic `cache_control: { type: 'ephemeral' }` (see `claude.ts` `callOnce`) so the grounded prefix is cached ~5 minutes and only the user-message delta is re-billed.

If, after scope verification, every candidate is dropped, the pipeline distinguishes `scope_mismatch` from a legitimately empty `no_chunks_retrieved` (pipeline §6 step 6b) — the two abstain for different reasons.

---

# Stage 3 — Model call & orchestration

Claude is called through `grounded-answer/claude.ts`, which is the canonical orchestration pattern:

- **Model IDs are pinned, dated constants** — `HAIKU_MODEL = 'claude-haiku-4-5-20251001'`, `SONNET_MODEL = 'claude-sonnet-4-20250514'`. Never `latest`. Changing a model ID is a **user-approval change** (see `extensions/anthropic.md` and ai-evaluation.md).
- **Haiku is the latency-sensitive default**; Sonnet and `gpt-4o` are reserved for reasoning-tier and fallback.
- **Never call a model without a fallback.** `resolveModelOrder()` builds an ordered chain (e.g. for `haiku` preference: OpenAI `gpt-4o-mini` then Anthropic Haiku). A timeout / `404` / `529` falls through to the next target; a `401`/`403` fails fast (auth won't recover on the next model).
- **Per-call timeout is capped** at `min(budget * 0.6, 45s)` so one slow turn cannot exhaust the Edge Function budget.
- **`anthropic-version` is fixed** at `2023-06-01`.
- **Streaming is the default for tutoring.** The streaming variant (`callClaudeStream`, parsed in `pipeline-stream.ts`, framed as SSE in `index.ts` `buildStreamingResponse`) commits to one model once the first token ships — fallback can only happen *before* `firstTokenSent`.
- **`callClaude` never throws.** It returns a discriminated union (`ok: true` with token usage, or `ok: false` with a classified `reason`). Callers handle one shape.

The non-LLM AI features — `quiz-generator/` and `cme-engine/` — skip this stage entirely. They are algorithmic (adaptive selection; BKT/IRT mastery math) and call no model. They are AI features, not LLM callers, and must not be retrofitted with a model call without an architecture review.

---

# Stage 4 — Output validation & safety

No model output reaches a student unfiltered (P12). Between Claude and the child sit:

- **Grounding-check** (`grounding-check.ts`) — a second, always-Haiku pass that fact-checks the candidate answer against the retrieved chunks. It is conservative: timeout, JSON parse error, or unknown verdict all **fail closed**. Better to ask the student to rephrase than to serve an ungrounded claim.
- **Structured-schema validation** (`structured-schema.ts`) — `validateFoxyResponse`, `validateSubjectRules`, with `rescueFromTruncatedJson` for capped streams, then `denormalizeFoxyResponse` for rendering.
- **Confidence + citations** (`confidence.ts`, `citations.ts`) — every grounded answer is scored and carries NCERT references.
- **Word cap** (`applyFoxyWordCap` in `index.ts`) — currently a no-op pending MoL grading confirmation, but the hook stays in the lifecycle.

For the simpler routes the post-processing utility is `_shared/mol/post-processor.ts`. The principle is identical: the boundary between the model and the student is never empty.

---

# The abstain / insufficient-context pattern

Abstaining is a first-class success outcome, not an error. The model is instructed that when no retrieved chunk supports an answer it must emit the exact sentinel `{{INSUFFICIENT_CONTEXT}}` (`INSUFFICIENT_CONTEXT_SENTINEL` in `claude.ts`). The caller surfaces this as `insufficientContext: true` and the pipeline builds a clean abstain response via `abstain.ts` (`buildAbstainResponse`), with one of the documented abstain reasons (e.g. `chapter_not_ready`, `no_chunks_retrieved`, `scope_mismatch`, `circuit_open`, `upstream_error`) and a list of suggested alternatives.

Rule: **a grounded tutor abstains rather than hallucinates.** Any new AI feature that produces factual content for students must implement an abstain path. An AI feature that cannot say "I don't have this in your textbook yet" is not shippable.

---

# Cache

Cache lookup happens early (pipeline §6.4 step 2, `cache.ts`) and is skipped for `retrieve_only` requests. A cache hit short-circuits before retrieval and before any model call — this is the single most important cost lever and is pinned as a regression invariant (Foxy single-retrieval contract, REG-50). When you change retrieval or prompt logic, confirm the cache key still incorporates query + full scope so a cache hit can never serve a wrong-grade answer.

---

# Audit (metadata only)

Every request — success, abstain, or failure — is finalized:

- **Settle quota** (`finalizeQuota` → `settleQuota`) with actual token usage so spend is observable per student/plan.
- **Record the circuit outcome** (`finalizeCircuit` → `recordCircuitOutcome`) so repeated failures trip the breaker.
- **Write the audit row** (`finalizeAudit` → `_shared/security/audit.ts` / `_shared/edge-audit-log.ts`) carrying **metadata only** — request id, route, school/role/caller type, quota decision, latency, status, breaker state, token estimates and actuals. **Never message text, name, email, phone, or raw IP** (P13). The IP is hashed (`hashRequestIp`) before it is used for attribution.

---

# Daily usage limits

Daily usage limits are a P12 hard requirement and are enforced server-side, before the model call, never bypassed:

- The quota estimate (`estimateGroundedAnswerUsage`) sizes input tokens from the prompt + match_count and output tokens from `max_tokens`, maps to a pinned model, and feeds `computeEstimatedCost` and `reserveQuota`.
- When the route is in `enforce` mode and the quota denies, the request returns `429` (quota) or `503` (breaker) — it does not reach Claude.
- `quiz-generator` carries its own rate limiter: an in-memory per-isolate `Map` (fast rejection, 20/min/student) backed by an authoritative DB-based cross-instance check.

Removing or weakening a usage limit is a rejection condition. Tutoring limits map to plan (free / standard / unlimited); the enforcement lives in the quota layer, not in feature code.

---

# Edge Function patterns

- **Deno runtime** — `Deno.serve()`, ES-module imports, no `node_modules`. Each function is a directory with `index.ts`.
- **Thin handler, fat pipeline** — keep the HTTP handler to glue (method check, CORS, admit, try/catch) and put stage sequencing in a dedicated module (`pipeline.ts`).
- **Never throws to the client** — wrap the pipeline in try/catch; on an internal throw, write an upstream-error trace and return a panic/abstain response, not a `500` stack.
- **CORS via the shared helper** — `_shared/security/cors.ts` (`securityCorsHeaders`, `securityJsonResponse`, `securityErrorResponse`) or `_shared/cors.ts` for the older routes.
- **Secrets are Edge secrets** — `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `OPENAI_API_KEY` are read via `Deno.env.get(...)` only. Never logged, never committed, never in a `NEXT_PUBLIC_*` var.

---

# Per-feature notes

**grounded-answer (Foxy tutor, active)** — the live RAG tutor. Full lifecycle, streaming-first, Haiku-primary with cross-provider fallback, grounding-check before the student. The legacy `foxy-tutor/` Edge Function is deprecated; do not reintroduce direct Claude calls outside `claude.ts` / the MoL adapter.

**ncert-solver** — step-by-step NCERT solver. Parses question type, retrieves NCERT context (`_shared/rag-retrieval.ts`), routes to a solver (deterministic → rule → LLM → hybrid), generates and verifies. Ships its **own circuit breaker** (trip after 5 consecutive failures, 60s reset, half-open probe). Removing it is a rejection condition.

**quiz-generator** — algorithmic adaptive selection. No model call. Difficulty 1-5, weak-topic targeting, optional IRT `ability_estimate` to bias toward the ZPD band. Candidate questions pass the deterministic quiz oracle (`_shared/quiz-oracle.ts`, `runDeterministicChecks`) before they can be served (P6).

**cme-engine** — algorithmic mastery math. No model call. BKT mastery update, IRT-style `pCorrect` (`1 / (1 + exp(-1.7 * (ability - difficulty)))`), retention half-life decay, and error classification (careless / conceptual / procedural). Assessment owns the *rules*; ai-engineer owns the *implementation*.

---

# Readiness checklist

- [ ] Request is validated, authenticated, authorized, and quota-reserved **before** any model call.
- [ ] Student scope (grade string, subject, chapter) resolved; retrieval filtered by grade/subject.
- [ ] Model IDs pinned + dated; an ordered fallback chain exists; per-call timeout capped.
- [ ] `{{INSUFFICIENT_CONTEXT}}` abstain path implemented for any student-facing factual feature.
- [ ] Grounding-check + post-processor sit between the model and the student; both fail closed.
- [ ] Cache key includes query + full scope; cache hit short-circuits before retrieval.
- [ ] Daily usage limit / quota enforced server-side; not bypassed.
- [ ] Audit row is metadata-only; no PII; IP hashed; secrets only via `Deno.env.get`.
- [ ] Circuit breaker present (route-level quota breaker and/or local breaker) with a fallback response.
- [ ] Prompt-template or RAG-filter change routed to assessment review.

---

# References

- Core: `06_API_ENGINEERING.md` (request lifecycle), `09_SECURITY_PROTOCOL.md` (secrets, data protection), `10_VERIFICATION_ENGINE.md` (verify before claiming done), `16_MCP_CONFIGURATION.md` (observable truth, secrets handling, read-before-write)
- Extensions: `extensions/anthropic.md` (the authoritative Claude binding — models, grounding, P12/P13 enforcement), `extensions/supabase.md` (Edge/runtime), `extensions/vercel.md` (host tier)
- Sibling playbooks: `prompt-engineering.md`, `ai-evaluation.md`
- Product constitution: invariants **P5** (grade format), **P6** (question quality), **P12** (AI safety), **P13** (data privacy) in `.claude/CLAUDE.md`
- Repo: `supabase/functions/grounded-answer/{index,pipeline,pipeline-stream,claude,abstain,grounding-check,cache,coverage,retrieval}.ts`, `ncert-solver/index.ts`, `quiz-generator/index.ts`, `cme-engine/index.ts`, `_shared/security/{quota,ai-admission,audit,circuit,cors}.ts`, `_shared/{rag-retrieval,reranking,retrieval,redact-pii,reliability,quiz-oracle}.ts`

---

# Final Directive

Treat every AI request as a governed pipeline, not a model call. Admit before you ground, ground before you call, validate before you stream, audit after you finish — and abstain before you invent. The lifecycle is the product: it is what makes Foxy a CBSE tutor a parent can trust rather than a chatbot a child can be misled by. Pin the models, gate the quota, fail the grounding-check closed, and never let an unfiltered token cross the boundary. P12 is the line that does not move.

**End of Document**
