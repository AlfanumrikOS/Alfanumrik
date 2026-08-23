---
name: ai-integration
description: Claude/model provider integration, typed gateway contracts, Foxy pedagogy and learner-state governance, and NCERT RAG ingestion/retrieval architecture. Use for Edge Function AI work (ncert-solver, quiz-generator, cme-engine), the Foxy Next.js route, the provider gateway, RAG retrieval architecture, or AI evaluation design.
user-invocable: false
---

# Skill: AI Integration

Routing hub for three related but distinct responsibilities. Read only the reference you need -- do not read both references for a task that touches only one.

## Load the right reference

- Read `references/foxy-pedagogy-and-learner-state.md` for: Foxy tutor behavior, pedagogy decisions, adaptive learner state, tutor memory, structured model output, grounding/citations, or AI evaluation design.
- Read `references/ncert-rag-architecture.md` for: NCERT ingestion, provenance, chunking, figures, hybrid retrieval, reranking, corpus versioning, or RAG architecture work.
- For the **18-cell math/science coverage audit and retrieval-tuning gate procedure specifically**, this skill does not own that workflow -- go to `rag-math-science-tuning`.
- For **student-data consent, retention, deletion, or safeguarding-escalation policy**, this skill does not own that either -- go to `alfanumrik-student-safety`. This skill owns the AI *mechanics* of safety (what the model call pipeline enforces); that skill owns the *policy*.

## AI surfaces (current, verified -- re-verify before quoting elsewhere)

| Surface | Status | Notes |
|---|---|---|
| `apps/host/src/app/api/foxy/route.ts` | **Canonical** Foxy path | RAG-grounded (`grounded-answer` pipeline). Model routing is **OpenAI-primary with Claude as automatic fallback** (`gpt-4o-mini`->`gpt-4o` primary, `claude-haiku-4-5`->`claude-sonnet-4` fallback) -- a CEO-approved, cost-driven swap. Source of truth: `MODEL_FALLBACK_ORDER` in `supabase/functions/grounded-answer/config.ts` (mirrored from `packages/lib/src/ai/gateway/registry.ts`). Do not assume "Claude" is Foxy's current primary model -- verify against that constant, it has changed before and can change again. A rollback path to Claude-primary (`CLAUDE_PRIMARY_FALLBACK_ORDER`, same file) exists behind `ff_foxy_openai_primary_rollout_v1`, seeded at 0% rollout -- check the flag's live rollout percentage before assuming either order is in effect for a given request |
| Legacy AI Edge Functions | May still be deployed | Do not add new logic to a superseded AI Edge Function. Older installed mobile app builds may still call a legacy path -- verify what is actually deployed with `supabase functions list` before assuming a superseded function is gone, never from this doc |
| `supabase/functions/ncert-solver/` | Active | Step-by-step NCERT solutions. One file inside this directory is currently mid-edit (`index.ts`) and one path is untracked (`retrieval.ts`) -- treat this directory at the boundary level only; do not cite its current line-level behavior as permanent |
| `supabase/functions/quiz-generator/` | Active | Adaptive question selection (tombstoned duplicates are not live -- verify deployed state, don't assume from disk) |
| `supabase/functions/cme-engine/` | Active | BKT/IRT mastery computation |
| `supabase/functions/grounded-answer/` | Active | The answer-generation pipeline (retrieval, citations, confidence, abstention, tracing, model routing) -- see the RAG reference for retrieval and the Foxy reference for grounding/citations. One file inside (`prompts/inline.ts`) is currently mid-edit; reference this directory at the boundary level, not by exact current line content |

## Provider gateway (already provider-neutral -- do not rebuild this)

`packages/lib/src/ai/gateway/` is the real, already-implemented, provider-neutral typed contract layer: `gateway.ts`, `registry.ts` (mirrors the live `MODEL_FALLBACK_ORDER`/`CLAUDE_PRIMARY_FALLBACK_ORDER` routing tables), `router.ts`, `rollout.ts`, `telemetry.ts`, `types.ts`, `index.ts`, plus `adapters/{anthropic,openai,gemini}.ts`. A new model integration is a new adapter behind this gateway -- never a bespoke `fetch()` call to a provider API from application code. If a task needs a new provider or a new routing/rollout rule, extend this layer; do not fork a second gateway. When citing which provider is primary for a given surface, cite the live constant/flag rollout percentage, not a remembered vendor name -- this has already changed once (Claude-primary -> OpenAI-primary, 2026-08-02) and is flagged to change again.

## AI safety mechanics (P12)

- Responses are age-appropriate for grades 6-12, stay within CBSE scope, and respect per-plan daily usage limits.
- `packages/lib/src/ai/validation/{safeguarding-classify.ts,safeguarding-screen.ts}` classify/screen model output and input before it reaches a student; `apps/host/src/app/api/foxy/_lib/safeguarding-escalate.ts` is the escalation path. The *policy* for what happens after escalation (human review, no diagnosis claims, consent) is owned by `alfanumrik-student-safety` -- this skill just ensures the pipeline calls into it.
- No PII sent to a model provider, regardless of which provider is currently primary -- anonymize to session/request identifiers only.

## Circuit breaker (provider API failures)

Track provider-call failures in a rolling window; open the circuit past a threshold; serve a cached response or a clear fallback message while open; allow a single probe request after a cooldown to attempt recovery. This is a generic pattern applied per-adapter in the gateway above, not tied to any single surface or provider -- it must work identically regardless of which provider is currently primary.

## Currently missing -- required, not yet implemented

Do not describe any of the following as already working; they are gaps to close, not existing behavior:

- **Durable `prompt_version`/`model_version` stamping.** No column or constant exists anywhere in the schema or code today that stamps which prompt/model version produced a given stored result, beyond the routing tables above (which record which provider *order* is active, not which model actually answered a given stored artifact). Any new AI-writing surface should add this rather than assume it already happens elsewhere.
- **Corpus-level blue/green versioning.** Only chunk-level supersession exists (`rag_content_chunks.version` + `previous_chunk_id`) plus the model-routing rollout mechanism above (which is about LLM call routing, not the retrieval corpus). There is no mechanism to promote or roll back an entire corpus version. See `references/ncert-rag-architecture.md`.

## Key files

| File | Purpose |
|---|---|
| `packages/lib/src/ai/gateway/*` | Provider-neutral gateway, adapters, routing/rollout, telemetry |
| `apps/host/src/app/api/foxy/route.ts` | Canonical Foxy chat route |
| `supabase/functions/grounded-answer/*` | Answer generation pipeline (retrieval -> citations -> confidence -> abstain -> trace -> model routing) |
| `supabase/functions/grounded-answer/config.ts` | Live model-routing source of truth (`MODEL_FALLBACK_ORDER`, `CLAUDE_PRIMARY_FALLBACK_ORDER`) |
| `supabase/functions/{ncert-solver,quiz-generator,cme-engine}/` | Edge Function AI surfaces |
| `packages/lib/src/ai/validation/*` | Safeguarding classify/screen |
| `packages/lib/src/cognitive-engine.ts`, `packages/lib/src/feedback-engine.ts` | Client-side cognitive/feedback rules (assessment-owned) |

## Review chain

Making agent: ai-engineer. Required reviewers: assessment (correctness/curriculum scope), testing (AI regression tests), quality. Student-safety policy changes route through `alfanumrik-student-safety` as well. Model/provider routing changes are a P12/user-approval-relevant change (per CLAUDE.md's "AI model or provider changes" approval gate) -- do not flip a primary-provider order without confirming the change is already CEO-approved, per the live flag/constant.
