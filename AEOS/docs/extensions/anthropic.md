# extensions/anthropic.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Extension Module (Platform Binding)
**Priority:** P0 (Critical — binds product invariant P12 "AI Safety" to the real Claude integration)
**Applies To:** Every code path that calls Anthropic Claude inside Alfanumrik — the AI Supabase Edge Functions, the shared model-orchestration layer (`_shared/mol/`), and the grounded-answer RAG pipeline.

---

# Purpose

Bind the platform-agnostic AEOS security and AI-governance standards to the **actual** way Alfanumrik uses Anthropic Claude. This module is the authoritative source of truth for: which models are called, from where, how prompts are versioned, how responses are grounded and post-processed, and how P12 (AI safety) and P13 (data privacy) are enforced on every Claude turn. No secret values are ever printed here; the API key lives only as the `ANTHROPIC_API_KEY` Edge Function secret.

---

# Scope

In scope: Claude (`claude-haiku-4-5`, `claude-sonnet-4-x`) usage from Deno Edge Functions, the multi-provider router that places Anthropic in fallback chains, RAG grounding, daily usage quotas, circuit-breaker/fallback posture, and token/cost discipline.

Out of scope: the non-AI Edge Functions, OpenAI-only mechanics (covered by the MoL router contract), Voyage reranking internals (see retrieval modules), and the Next.js web/host tier (see `extensions/vercel.md`).

---

# How AEOS core binds here

- **Core doc 09 (Security Protocol)** governs secret handling and data protection in full. Realized here: the Anthropic key is a server-only Edge secret, and no student PII is ever placed in a Claude request (P13).
- **Core doc 16 (MCP Configuration)** §"observable truth over inference" applies — confirm the key *exists* via configuration, never echo its value.
- **Core doc 06/14 (API/Backend Engineering)** govern the Edge Function request lifecycle (auth → quota → call → post-process → audit) that every AI route follows.
- **Product invariant P12** is the hard constraint this module operationalizes; where AEOS guidance and P12 disagree, **P12 wins** (per the AEOS authority hierarchy).

---

# Where Claude is called (factual to this repo)

The AI Edge Functions and shared layer that reach Anthropic:

- `supabase/functions/grounded-answer/` — the **active** RAG tutor pipeline (Foxy's brain). Caller in `grounded-answer/claude.ts`: Haiku-primary, Sonnet-fallback, with a `{{INSUFFICIENT_CONTEXT}}` abstain sentinel. Streaming variant in `pipeline-stream.ts`.
- `supabase/functions/ncert-solver/index.ts` — step-by-step NCERT solver. Calls `https://api.anthropic.com/v1/messages` directly with `claude-haiku-4-5-20251001`; ships its own circuit breaker (trip after 5 consecutive failures, 60s reset, half-open probe).
- `supabase/functions/_shared/mol/` — the model-orchestration layer (router + provider adapters). `mol/router.ts` defines per-task fallback chains (e.g. `explanation` → OpenAI `gpt-4o-mini` then Anthropic Haiku; `reasoning` → `gpt-4o` → Sonnet → Haiku). `mol/providers/anthropic.ts` is the single Anthropic adapter (`anthropic-version: 2023-06-01`, prompt-cache on long system blocks, vision support).
- `quiz-generator/` and `cme-engine/` are **algorithmic** (no Claude call) — quiz selection and BKT/IRT mastery math respectively. They are AI features but not LLM callers.

> Historical note: the legacy `foxy-tutor/` Edge Function is deprecated; live tutoring now flows through `grounded-answer/`. Do not reintroduce direct Claude calls outside the MoL adapter or the two callers above.

---

# Prompt & version discipline

- **Model IDs are pinned, dated constants** — never `latest`. Sources of truth: `mol/router.ts` (`HAIKU`/`SONNET`), `grounded-answer/claude.ts`, `ncert-solver/index.ts`, `_shared/security/quota.ts`. Changing a model ID is a **user-approval change** (P12 / agent system "AI model changes") and must be updated in *every* listed location to stay consistent.
- `anthropic-version` header is fixed at `2023-06-01`. Bump only with a deliberate review.
- System prompts encode persona (Foxy), CBSE grade+subject scope, and safety rails. Prompt-template edits trigger an **assessment** review (curriculum scope + age-appropriateness) before merge.
- Temperature discipline: low (≈0.3) for factual solving/explaining, higher only for motivational copy. Never set temperature > 0.7 on factual answers (hallucination risk).

---

# RAG grounding (the anti-hallucination spine)

1. Resolve student scope (grade as a **string** "6"–"12", subject_code, chapter) — see retrieval modules in `_shared/retrieval.ts`, `reranking.ts`, `rag/`.
2. Retrieve top NCERT chunks (embedding similarity + Voyage rerank), filtered by grade/subject so a student never sees out-of-grade content.
3. Inject chunks into the Claude system block; long system blocks get Anthropic `cache_control: ephemeral` to cut input cost.
4. If no supporting chunk exists, the prompt emits `{{INSUFFICIENT_CONTEXT}}` and the pipeline **abstains** rather than inventing an answer.
5. `grounded-answer/grounding-check.ts` verifies the response is supported before it streams to the student — no unfiltered LLM output reaches a child.

---

# AI safety & data privacy (P12 / P13)

- **Age-appropriate, CBSE-scoped:** every response is constrained by the system prompt to the student's grade/subject; off-curriculum and unsafe topics are refused.
- **No unfiltered output:** grounding-check + post-processing (`_shared/mol/post-processor.ts`) sit between Claude and the student on every turn.
- **Daily usage limits per plan:** enforced server-side via `_shared/security/quota.ts` (token estimate → `compute_estimated_cost`/quota RPC) before the Claude call. Do not bypass or remove the quota check.
- **No PII to Claude:** student requests are anonymized; `_shared/redact-pii.ts` is the redaction utility. Never send name/email/phone in a prompt. Audit rows (`_shared/edge-audit-log.ts`) carry metadata only — session/topic/mode/model, never message text or identity.
- **Admission control:** `_shared/security/ai-admission.ts` builds a static route profile (caller types, model, token floors) gating who may call which AI route.

---

# Fallback / circuit-breaker posture

- **Never call Claude without a fallback.** The MoL router always provides an ordered chain (cross-provider where it matters); a single provider/model failure falls through to the next target.
- `ncert-solver` additionally wraps Claude in a local circuit breaker (5 failures → open, 60s reset, half-open probe). Removing a circuit breaker is a rejection condition.
- `_shared/reliability.ts` provides `fetchWithTimeout` with classified provider errors, retry policy, and per-call timeouts; auth (401/403) errors fail fast (no retry), transient ones retry/fall through.
- Per-call timeouts are capped (e.g. grounded-answer caps at `min(budget * 0.6, 45s)`) so a slow Claude turn cannot exhaust the Edge Function budget.

---

# Cost & token awareness

- Cost is dominated by **input tokens** (RAG chunks + history); keep `match_count` and conversation turns bounded. Prompt caching on long system blocks is already enabled in the Anthropic adapter — preserve it.
- `max_tokens` is sized per mode (short for quiz/abstain, larger for explanations) — do not inflate defaults.
- Haiku is the default workhorse for latency-sensitive tutoring; Sonnet/`gpt-4o` are reserved for `reasoning`-tier tasks and fallback. Prefer the cheapest model that meets the task.
- Token estimates feed the quota/cost RPC so spend is observable per student/plan — keep estimates honest when you change prompts.

---

# Checklist

- [ ] Model IDs stay pinned/dated and consistent across router, callers, and quota; model change has user approval.
- [ ] System-prompt / RAG-filter edits routed to assessment review (scope + age-appropriateness).
- [ ] Daily usage quota check runs **before** the Claude call; not bypassed.
- [ ] No PII in any Claude request; audit rows are metadata-only.
- [ ] Every Claude call has a fallback (MoL chain) and/or circuit breaker; timeouts capped.
- [ ] Grounding-check + post-processor remain between Claude and the student.
- [ ] `ANTHROPIC_API_KEY` stays an Edge secret — never logged, committed, or in a `NEXT_PUBLIC_*` var.

---

# References

- Core: `09_SECURITY_PROTOCOL.md`, `16_MCP_CONFIGURATION.md`, `06_API_ENGINEERING.md`, `14_BACKEND_ENGINEERING.md`, `08_TESTING_PROTOCOL.md`
- Product constitution: invariants **P12** (AI safety) and **P13** (data privacy) in `.claude/CLAUDE.md`
- Extensions: `extensions/vercel.md` (host tier), Supabase/Edge runtime bindings
- Repo: `supabase/functions/grounded-answer/`, `ncert-solver/index.ts`, `_shared/mol/`, `_shared/security/{quota,ai-admission}.ts`, `_shared/{reliability,redact-pii,retrieval,reranking,edge-audit-log}.ts`

---

# Final Directive

Treat every Claude call as a child-facing, cost-bearing action: grounded in NCERT, scoped to the student's grade, quota-gated, PII-free, fallback-protected, and post-processed before a single token reaches a student. Pin the models, route the reviews, and never let unfiltered LLM output cross the boundary. P12 is the line that does not move.

**End of Document**
