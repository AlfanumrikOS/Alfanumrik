# 08 — Regression: Foxy AI Tutor & RAG (Cycle 4)

> Phase: REGRESSION. Dependent-workflow regression sweep.

- **Cycle:** cycle-4
- **Workflow:** foxy-ai-rag (P12 AI safety; P8 RLS on RAG reads; P13 no PII to LLM/traces)
- **Verification squad:** **testing**
- **Date:** 2026-06-29
- **Validation reference:** `./07-validation.md`

## Regression sweep
- [x] Foxy / RAG / validation suites green — **305/305 vitest + 3/3 Deno** PASS.
- [x] No previously-passing test now skipped or weakened — the new tests are **additive** pins on previously-unguarded surfaces (live grounded-path output backstop; student-message injection neutralization; P13 prompt-assembly boundary). The FOX-3 mode widening updated the two `output-screen.test.ts` cases that pinned the OLD injection-token intent to the NEW CS-exemption intent (bare `<system>`/`[inst]` PASS; LLaMA-paired BLOCK) — an intent correction, not a weakened assertion.
- [x] type-check green; lint 0 errors; build green; bundle within P10 caps.

## P14 review-chain completeness (AI tutor behavior) — COMPLETE
Per `.claude/skills/review-chains/SKILL.md`, an AI-tutor-behavior change requires ai-engineer (maker) → assessment (correctness) + testing (coverage). All present, plus quality independent validation:

| Role | Agent | Scope | Result |
|---|---|---|---|
| Maker (impl) | **ai-engineer** | FOX-1 output backstop (+ Deno twin) + FOX-2 input guard + FOX-3 mode widening | DONE |
| Correctness (CBSE scope / age-appropriateness) | **assessment** | reviewed that the screen does not over-block legitimate CBSE content + no scope relaxed | **APPROVE WITH CONDITIONS** (CS-markup over-block) — **conditions addressed** (FOX-1 refinement) |
| Coverage | **testing** | output-screen / input-guard / route / streaming / Deno parity + FOX-6 prompt-assembly contract | **GREEN** (305/305 + 3/3 Deno) |
| Independent validation | **quality** | re-ran all gates; traced every student-facing exit; confirmed FOX-4 not student-facing | **APPROVE** |

**Chain: COMPLETE** for the auto-fix-safe set. (FOX-4 opens its own user-governance gate; FOX-7-new opens an ai-engineer follow-up.)

## Dependent-workflow regression result
The Foxy turn shares surfaces with quota/usage, sessions/persistence, cognitive-context/learner-state, and the quiz-me oracle. No regressions in the dependent flows:

| Dependent flow | Shared dependency | Regression? |
|---|---|---|
| Quota / daily limits | screens run AFTER quota; on block, quota is REFUNDED via existing `refundQuota` / `REFUND_ABSTAIN_REASONS` | none — a blocked turn does not consume quota; refund path reused, no new contract |
| Session / persistence | streaming `persistOnDone` persists a SAFE empty record on block | none — non-streamed consumers (session-resume GET, parent portal, analytics) are guaranteed safe; safe answers persist byte-identically |
| Cognitive-context / learner-state | blocked streaming turn does not derive pending-expectation anchors from blocked text | none — struggle telemetry unchanged (IDs/enums only); cannot move mastery |
| Quiz-me oracle (REG-54) | quiz-me already oracle-gated; also passes through the output screen (denormalized) | none — oracle gate unchanged; the screen is additive defense-in-depth |
| Single-retrieval (REG-50) | exactly one grounded hop per turn | none — the screens run on the FINAL text; no extra retrieval introduced |

## Existing P12 regressions — still green
| REG-ID | Pins | Status after Cycle 4 |
|---|---|---|
| REG-37 | Voyage fallback (null embedding proceeds keyword-only) | **green** — untouched; embed path unchanged |
| REG-39 | Kill switch (`ai_usage_global` / `ff_grounded_ai_enabled`) + circuit breaker + cache | **green** — untouched; screens run downstream of all three |
| REG-50 | Single-retrieval contract (≤1 grounded hop/turn; cache short-circuits before retrieval) | **green** — screens act on final text; no extra hop |
| REG-54 | Quiz-me oracle gate (deterministic P6 + LLM grader, fails CLOSED) | **green** — unchanged; output screen is additive |
| REG-66 | AlfaBot scope-lock (4 hard-refusal categories) | **green** — separate surface; untouched |
| REG-67 | AlfaBot model provenance | **green** — separate surface; untouched |

## New regression catalog entries

| Proposed REG-ID | Invariant | What it pins | Filed in catalog? |
|---|---|---|---|
| **REG-182** | P12 | Live grounded-path output content backstop — every student-facing exit (non-streaming `response` + `structured` + persisted `content`; streaming deltas/`done`; streaming persisted record; OpenAI fallback text; quiz-me) is screened before render/persist; streaming persists a SAFE empty record; Deno emits `abstain` not `done`; fail-safe → safe-abstain; Deno twin `HARD_BLOCK_PATTERNS` parity | filed → catalog 150 |
| **REG-183** | P12 | Student-message injection neutralization — assistant-directed override phrases stripped from the model-bound query; original message persisted/shown; fail-open; bare "ignore"/"system" preserved | filed → catalog 150 |

> `.claude/regression-catalog.md` is authoritative. FOX-6 (prompt-assembly P13 contract test) is an additive pin enforced by the suite; it rides the existing P13 catalog lines rather than minting a new top-level REG id this cycle.

## Coverage delta

| Metric | Before | After |
|---|---|---|
| Foxy/RAG safety assertions | live grounded-path output backstop ABSENT; student-message injection unguarded; prompt-assembly PII boundary unpinned | **305/305 vitest + 3/3 Deno** PASS — output backstop + input guard + P13 prompt-assembly all pinned |
| Regression catalog entries | 148 (REG-180/181, Cycle 3) | **150** with REG-182 (P12 output backstop) + REG-183 (P12 injection neutralization) |

> Snapshotted into `metrics/coverage-trend.md` (2026-06-29 Cycle-4 row).

## Residual risk
1. **FOX-4 — GATED (USER, MED).** OpenAI gpt-4o-mini/gpt-4o is a MoL SHADOW comparison (telemetry only; not student-facing today), but provider PRESENCE is user-gated. CEO to approve & govern, or remove. Not touched.
2. **FOX-7 (new) — FOLLOW-UP (ai-engineer, MINOR).** Extend `screenStudentFacingText` to the legacy fallback persist path (`_lib/legacy-flow.ts`); that path retains the OLDER substring `validateOutput` guard — consistency upgrade, not an unfiltered hole.
3. **Streaming residual — MINOR.** Live browser may briefly show streamed deltas before the `abstain` frame clears them; persisted + non-streamed surfaces always safe; gated by `ff_foxy_streaming`. Frontend full-closure flagged.
4. **Hindi profanity-token coverage — MINOR.** `HARD_BLOCK_PATTERNS` English-oriented; bounded (acts on model OUTPUT). Tracked follow-up.

## Sweep verdict
**GREEN** — 305/305 vitest + 3/3 Deno PASS, P14 chain complete for the auto-fix-safe set, no dependent-flow regression, REG-37/39/50/54/66/67 still green, the two new guards (REG-182/183) close the P12 "no unfiltered LLM output" backstop gap on the live grounded path; the residual FOX-4 (user-gated) + FOX-7-new + streaming-residual + Hindi-token items are tracked gated/follow-up, not sweep failures.
