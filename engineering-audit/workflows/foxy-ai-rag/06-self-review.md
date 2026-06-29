# 06 — Self-Review: Foxy AI Tutor & RAG (Cycle 4)

> Phase: SELF-REVIEW. The implementation squad reviews its own work before independent validation.

- **Cycle:** cycle-4
- **Workflow:** foxy-ai-rag (P12 AI safety; P8 RLS on RAG reads; P13 no PII to LLM/traces)
- **Reviewer (authors):** ai-engineer (FOX-1, FOX-2, FOX-3 impl) + assessment (CBSE-scope / age-appropriateness correctness) + testing (FOX-6 + coverage)
- **Date:** 2026-06-29
- **Implementation reference:** `./05-implementation.md`

## Per-gap verification

| Gap ID | Owner | Fixed? | Evidence (file / test) | Notes |
|---|---|---|---|---|
| FOX-1 | ai-engineer | yes | `src/lib/ai/validation/output-screen.ts` + byte-identical Deno twin `supabase/functions/grounded-answer/output-screen.ts`; wired into non-streaming `route.ts`, streaming `_lib/streaming.ts`, Deno `pipeline-stream.ts` | Deterministic word-boundary `HARD_BLOCK_PATTERNS` that EXCLUDE curriculum collisions; `validateOutput` runs WARN-only; fail-safe → `safe:false`. → REG-182 |
| FOX-1 refinement | ai-engineer + assessment | yes | injection patterns tightened: bare `<system>`/`[inst]` CS markup PASSES; `<<SYS>>`/`<\|im_start\|>`/`<s>[INST]…[/INST]</s>` still BLOCK | Addresses the assessment CONDITION (grade 11-12 CS answers showing literal markup). Byte-identical in both twins (parity test holds, 22 literals ≥ 20 floor) |
| FOX-2 | ai-engineer | yes | `src/lib/ai/validation/input-guard.ts` `neutralizeInjectionAttempt`; wired in `route.ts` (original message persisted/shown, neutralized query sent to model) | Strips only assistant-directed overrides; fail-open; bare "ignore"/"system" preserved. → REG-183 |
| FOX-3 | ai-engineer + assessment | yes | `_lib/constants.ts` `VALID_MODES` widened (doubt/homework/explorer); doubt/homework→`doubt_v1` (dead branch restored), explorer→`teach_v1` | Assessment-approved; safety rails template-independent (no scope relaxed); no client-contract/type derives from the array |
| FOX-6 | testing | yes | prompt-assembly contract test — composed prompt + user message carries only scope + UUID, no studentName/email/phone | Pure test addition; pins the P13 watch item |
| FOX-5 | — | n/a (COMPLIANT) | retrieval is service-role inside the Deno Edge Fn, scope-keyed, no client vector read | Documented positive finding; no action |
| FOX-8 | — | n/a (COMPLIANT) | hard-abstain `response:''`, top-level catch bilingual 503, pipeline panic → structured abstain | Documented positive finding; no action |
| **FOX-4** | user (CEO) | **GATED** | OpenAI gpt-4o-mini/gpt-4o present in `grounded-answer` as a MoL SHADOW comparison (telemetry only; does NOT reach students) | Provider PRESENCE is user-gated per constitution; decision: govern or remove. NOT touched |
| **FOX-7 (new)** | ai-engineer | **FOLLOW-UP** | extend `screenStudentFacingText` to `_lib/legacy-flow.ts` persist path | Consistency upgrade (legacy path retains the OLDER substring `validateOutput`, not an unfiltered hole). NOT done |
| FOX-7 (gap-analysis) | — | informational | `applyFoxyWordCap` no-op | Cost/latency, not P12; intentional MoL-gated TODO. No action |

## Self-review checklist
- [x] Every gap in `02-gap-analysis.md` is addressed or explicitly deferred (FOX-1/2/3/6 landed; FOX-5/8 COMPLIANT; FOX-4 user-gated; FOX-7 new follow-up + gap-analysis word-cap informational).
- [x] **No model / provider / prompt-scope change** — Claude model id, `resolveModelOrder`, `FOXY_SAFETY_RAILS`, prompt templates, `selectFoxyPromptTemplate`, curriculum-scope behavior, temperature (0.3), quotas, kill switch, circuit breaker, REG-50 single-retrieval all UNCHANGED.
- [x] **P12 — no unfiltered LLM output** — every student-facing exit (non-streaming `response` + `structured` + persisted `content`; streaming deltas/`done`; streaming persisted record; OpenAI fallback text; quiz-me) now passes a deterministic backstop before render/persist; on failure the EXISTING safe-abstain envelope is served. Fail-safe (screen throw → abstain).
- [x] **Not over-blocking legitimate CBSE** — word-boundary HARD_BLOCK set excludes curriculum-colliding substrings (ass/hell/sex/alcohol/weapon/retard); biology/chemistry/history/civics + grade 11-12 CS literal-markup answers pass. Verified by the curriculum control set in the output-screen test.
- [x] **P13 — no PII in new logs/traces** — all new log/audit lines carry subject/grade/mode/categories/traceId only; the screens are pure and never log their input. No name/email/phone/message text. FOX-6 test pins the prompt-assembly boundary.
- [x] **P8 — RAG reads server-only** — unchanged; no client vector read introduced (FOX-5 COMPLIANT).
- [x] **Bilingual (P7)** — the served safe-abstain envelope and refusal copy are Hi/En via the existing abstain handling; no new user-facing string bypasses `AuthContext.isHi`.
- [x] **Existing validators reused** — `validateOutput` (WARN-only telemetry inside the screen), the existing hard-abstain envelope + `onAbstain` client handler + `abstain` SSE event, `refundQuota` / `REFUND_ABSTAIN_REASONS`. No new wire type / contract.
- [x] **Deno twin parity** — `HARD_BLOCK_PATTERNS` byte-identical in both `output-screen.ts` twins; parity test enforces (22 literals ≥ 20 floor).
- [x] No `any` in new code; no `console.log` introduced (Deno uses `console.warn`, allowed).
- [x] Ownership/scope — ai-engineer edits limited to the validation modules + their call sites; testing edits limited to new test files; no schema / RLS / migration / RPC / payment / onboarding surface touched.

## Known limitations carried forward (for the independent reviewer)
1. **FOX-4 is GATED, not fixed.** OpenAI is a MoL SHADOW comparison (telemetry only; not student-facing today), but provider PRESENCE is user-gated per the constitution. CEO to approve & govern, or remove. NOT touched.
2. **FOX-7 (new) is a follow-up.** The legacy `ff_grounded_ai_foxy`-OFF fallback persist path (`_lib/legacy-flow.ts`) still uses the OLDER substring `validateOutput` guard — not an unfiltered hole, a consistency upgrade. ai-engineer follow-up.
3. **Streaming residual.** The live browser may briefly show streamed deltas before the `abstain` frame clears them; the persisted record + every non-streamed consumer are always safe. Gated by `ff_foxy_streaming`. Frontend full-closure flagged.
4. **Hindi profanity-token coverage.** `HARD_BLOCK_PATTERNS` is English-oriented; bounded (acts on model OUTPUT, not student input). Tracked follow-up.

## Ready for independent validation?
**YES.** All Cycle-4 auto-fix-safe items (FOX-1/2/3 ai-engineer + FOX-6 testing) are implemented and locally green; FOX-4 (user-gated) and FOX-7-new / streaming-residual / Hindi-token follow-ups are explicitly recorded with owners and were not touched.
