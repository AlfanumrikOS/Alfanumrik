# 07 — Independent Validation: Foxy AI Tutor & RAG (Cycle 4)

> Phase: INDEPENDENT VALIDATION. A fresh quality agent (did NOT implement) verifies.

- **Cycle:** cycle-4
- **Workflow:** foxy-ai-rag (P12 AI safety; P8 RLS on RAG reads; P13 no PII to LLM/traces)
- **Validator squad:** **quality** (independent of the builder squad)
- **Date:** 2026-06-29
- **Self-review reference:** `./06-self-review.md`

## Independence statement
The validating quality agent did **not** author any Cycle-4 change (FOX-1/2/3 ai-engineer; FOX-6 testing). It re-ran every gate from a clean state rather than trusting the builders' reported results, and independently traced each student-facing exit of the live grounded path to confirm a deterministic screen guards it before render/persist. It specifically re-derived the FOX-4 disposition (that the OpenAI generation does not reach students on the live path).

## Per-gap independent verdict

| Gap ID | Builder claim | Validator finding | Verdict |
|---|---|---|---|
| FOX-1 | deterministic output backstop wired into every student-facing exit; word-boundary HARD_BLOCK excludes curriculum collisions; fail-safe; Deno twin | Confirmed non-streaming `route.ts` screens both `assistantContent` AND raw `grounded.answer`; streaming `streaming.ts` persists a SAFE empty record + synthesized abstain + refund; Deno `pipeline-stream.ts` yields `abstain` not `done`; curriculum control set passes; throw → `safe:false` | **PASS** |
| FOX-1 refinement | CS-curriculum markup exemption (bare `<system>`/`[inst]` PASS; LLaMA-paired BLOCK) applied byte-identically in both twins | Confirmed the two over-broad patterns removed/replaced; real chat templates still BLOCK; parity test holds (22 literals ≥ 20 floor) | **PASS** |
| FOX-2 | `neutralizeInjectionAttempt` strips assistant-directed overrides only; original message persisted/shown, neutralized query to model; fail-open | Confirmed bare "ignore the negative root" / "what is a system?" preserved; only directed overrides stripped; turn never breaks on a miss | **PASS** |
| FOX-3 | `VALID_MODES` widened (doubt/homework/explorer); safety rails template-independent; no scope relaxed | Confirmed `FOXY_SAFETY_RAILS` inject on every path independent of template; the `doubt_v1` branch is no longer dead; no client type derives from the array | **PASS** (assessment-approved) |
| FOX-6 | prompt-assembly contract test — only scope + UUID, no PII | Confirmed the composed prompt + user message asserts absence of studentName/email/phone | **PASS** |

## Gate re-run (verified, not trusted) — quality APPROVE, verbatim
- [x] **type-check** — **PASS**
- [x] **lint** — **PASS** (0 errors)
- [x] **test** — **PASS** — **305/305 vitest + 3/3 Deno**
- [x] **build** — **PASS**
- [x] **bundle** — within **P10** caps (validation modules are small server/Deno code; the route already shipped in the /foxy bundle; no new shared chunk)

## Invariant audit (P1–P15)

| Invariant | Relevant? | Upheld? | Evidence |
|---|---|---|---|
| P12 AI safety | yes (primary) | yes — strengthened | Every student-facing exit now passes a deterministic content backstop before render/persist; fail-safe → safe-abstain envelope. No model/provider/prompt-scope change |
| P8 RLS boundary | yes | yes (unchanged) | RAG retrieval remains service-role, scope-keyed, server-only inside the Deno Edge Fn; no client vector read (FOX-5 COMPLIANT) |
| P13 Data privacy | yes | yes — strengthened | New logs/audits carry scope + category + traceId only; screens are pure and never log input; FOX-6 pins the prompt-assembly boundary (no PII to Claude) |
| P7 Bilingual | yes | yes (unchanged) | Served safe-abstain envelope + refusal copy Hi/En via existing abstain handling; no new string bypasses `AuthContext.isHi` |
| P5 Grade format | yes | yes (unchanged) | The Zod grade gate ({"6".."12"}) and grade-spoof HARD block are untouched |
| P9 RBAC | yes | yes (unchanged) | `authorizeRequest(request,'foxy.chat')` untouched; quota/kill-switch/circuit-breaker unchanged |
| P10 Bundle | yes | yes | Within caps (above) |
| P1/P2/P3/P4/P6/P11/P15 | no (this cycle) | n/a | No scoring/XP/anti-cheat/atomic/question-quality/payment/onboarding surface touched |

## Minor non-blocking findings (recorded verbatim)
1. **Streaming live-view residual (MINOR).** On the streaming path the live browser may briefly display upstream text deltas before the completion screen runs and the `abstain` frame clears them. The persisted record, the final frame, and every non-streamed consumer (session-resume GET, parent portal, analytics) are guaranteed safe. Likelihood very low (CBSE-scoped, grounded, temp ≤ 0.3). Gated by `ff_foxy_streaming`. Full closure (frontend `onAbstain` also clears `structured`, or a buffered-frame transform) is a flagged frontend follow-up that would touch the REG-50-pinned verbatim-passthrough transform. **Not a validation failure.**
2. **Hindi profanity-token coverage (MINOR).** `HARD_BLOCK_PATTERNS` is English-token-oriented; a Hindi/Devanagari profanity pass is tracked. Bounded — the screen acts on model OUTPUT (CBSE-scoped, grounded), not student input. **Not a validation failure.**

## FOX-4 disposition (independent confirmation)
Confirmed: on the live student-facing path the OpenAI gpt-4o-mini/gpt-4o usage is a **MoL SHADOW comparison (telemetry only)** — the student-facing answer is always the screened Claude output; the OpenAI generation does **not** reach students. The FOX-1 screens would cover OpenAI output regardless. The **presence** of a second provider is user-gated per the constitution → **CEO decision** (govern or remove); not a code defect this cycle.

## Verdict
**APPROVE** — all four in-scope auto-fix-safe items (FOX-1/2/3 + FOX-6) pass independent re-test; all gates green (type-check PASS, lint 0 errors, 305/305 vitest + 3/3 Deno PASS, build PASS, bundle within P10 caps); no invariant regression; the assessment CONDITION (CS-markup over-block) was addressed; the two MINOR findings (streaming residual, Hindi tokens) are documented non-blocking follow-ups.

## Gate 5 (P14 review-chain) confirmation
The mandatory AI-tutor-behavior chain is **COMPLETE**: ai-engineer (impl) → assessment (CBSE-scope / age-appropriateness correctness review: **APPROVE WITH CONDITIONS**, conditions addressed) + testing (coverage GREEN) + quality (independent **APPROVE**). See `08-regression.md`.

## Required fixes before COMPLETE (if REJECT)
None for the auto-fix-safe set. The workflow is not marked fully COMPLETE only because **FOX-4** is user-gated (provider governance) and **FOX-7 (new)** / the streaming residual / Hindi tokens are tracked follow-ups — none of which are validation failures; see `STATUS.md`.
