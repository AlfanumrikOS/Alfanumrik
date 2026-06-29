# Cycle Log — 2026-06-29 — Foxy AI Tutor & RAG (P12, P8, P13)

> Dated summary of Cycle 4, the fourth workflow of the engineering-audit program.
> Authoritative ledger lives under `workflows/foxy-ai-rag/` (01-map … 08-regression + STATUS.md).

## Workflow
- **Cycle:** 4
- **Workflow:** foxy-ai-rag (Foxy chat turn + grounded-answer RAG pipeline + sibling AI Edge Functions)
- **Primary invariants:** P12 (AI safety), P8 (RLS on RAG/vector reads), P13 (no PII to LLM/traces)
- **Status:** **CYCLE 4 LANDED — P12 output backstop complete; FOX-4 gated, FOX-7 + streaming-residual + Hindi-tokens follow-ups**

## Live-topology reconciliation (recorded)
The constitution's note that `/api/foxy` is "the new RAG+sonnet route — not yet wired to UI" is **STALE**. `/api/foxy/route.ts` is the **LIVE production route** (2,411-line handler the student chat UI posts to); the legacy `foxy-tutor` Edge Function **no longer exists on disk**; `grounded-answer` (Deno) is the LLM pipeline `/api/foxy` calls via `callGroundedAnswer()`. To be corrected on the next constitution reconciliation. See `01-map.md` §0.

## Agents involved
- **ai-engineer** — workflow lead + maker: MAP → GAP → ROOT-CAUSE → DESIGN → IMPLEMENT (01-05); FOX-1 output backstop (+ byte-identical Deno twin), FOX-2 input guard, FOX-3 mode widening, FOX-1 injection-pattern refinement.
- **assessment** — CBSE-scope / age-appropriateness correctness reviewer: APPROVE WITH CONDITIONS (CS literal-markup over-block) → conditions addressed; signed off that no scope was relaxed and the screen does not over-block legitimate CBSE content.
- **testing** — FOX-6 prompt-assembly P13 contract test + output-screen / input-guard / route / streaming / Deno-parity coverage; regression sweep (305/305 vitest + 3/3 Deno GREEN); filed REG-182 / REG-183.
- **quality** — independent validation (did not implement); verdict APPROVE; confirmed FOX-4 OpenAI is not student-facing on the live path; recorded the 2 MINOR findings.
- **ops (this doc)** — ledger finalization.

## Gaps found (FOX-1 … FOX-8) and dispositions
| ID | Title | Severity | Owner | Disposition |
|---|---|---|---|---|
| FOX-1 | Live grounded path lacks a deterministic profanity/age output backstop (legacy guard left behind at cutover) | **High** | ai-engineer | **LANDED** — `screenStudentFacingText` + Deno twin wired into every student-facing exit; → REG-182 |
| FOX-2 | Student message not passed through prompt-injection neutralization | Medium | ai-engineer | **LANDED** — `neutralizeInjectionAttempt`, fail-open; → REG-183 |
| FOX-3 | Mode→template drift (`VALID_MODES` narrower than documented mode set; `doubt_v1` branch dead) | Low | ai-engineer + assessment | **LANDED** — `VALID_MODES` widened (doubt/homework/explorer); assessment-approved; no scope relaxed |
| FOX-4 | OpenAI gpt-4o-mini/gpt-4o present as cross-provider path | Medium | user (CEO) | **GATED — USER APPROVAL** — MoL SHADOW comparison (telemetry only; NOT student-facing today); provider PRESENCE is user-gated; govern or remove |
| FOX-5 | RAG / RLS server-only, scope-keyed | — | — | **COMPLIANT (P8)** — explicit positive finding; no action |
| FOX-6 | studentName in request scope (PII watch item) | Low (P13) | testing | **LANDED** — prompt-assembly contract test pins only-scope+UUID |
| FOX-7 (gap-analysis) | `applyFoxyWordCap` no-op | Low (cost) | — | **INFORMATIONAL** — intentional MoL-gated TODO; not P12 |
| FOX-7 (NEW) | `screenStudentFacingText` not on the legacy fallback persist path | Minor | ai-engineer | **FOLLOW-UP** — consistency upgrade (legacy retains OLDER substring `validateOutput`); not an unfiltered hole |
| FOX-8 | Abstain/error paths clean (`response:''`, bilingual 503) | — | — | **COMPLIANT (P12)** — explicit positive finding; no action |

## What landed vs gated
- **Landed + APPROVED (auto-fix-safe, P12 AI-safety hardening; no model/provider/prompt-scope change):** FOX-1 (+ Deno twin + injection-pattern refinement), FOX-2, FOX-3, FOX-6.
- **Gated (USER APPROVAL required):** FOX-4 (OpenAI provider governance — MoL shadow, not student-facing today; govern or remove).
- **Follow-up (ai-engineer):** FOX-7-new (extend the screen to the legacy fallback persist path).
- **Documented MINOR:** streaming live-view residual (gated by `ff_foxy_streaming`), Hindi profanity-token coverage.
- **Compliant / informational:** FOX-5 (P8), FOX-8 (P12), FOX-7-gap-analysis word-cap no-op.

## Files touched (code/test — by builders, outside this doc-only finalization)
- `src/lib/ai/validation/output-screen.ts` (NEW — FOX-1 TS screen)
- `supabase/functions/grounded-answer/output-screen.ts` (NEW — FOX-1 byte-identical Deno twin)
- `src/lib/ai/validation/input-guard.ts` (NEW — FOX-2 `neutralizeInjectionAttempt`)
- `src/app/api/foxy/route.ts` (FOX-1 non-streaming guard + FOX-2 input wiring)
- `src/app/api/foxy/_lib/streaming.ts` (FOX-1 streaming Next-boundary guard)
- `supabase/functions/grounded-answer/pipeline-stream.ts` (FOX-1 Deno source guard)
- `src/app/api/foxy/_lib/constants.ts` (FOX-3 `VALID_MODES` widening)
- test files: output-screen / input-guard / route / streaming / Deno-parity + FOX-6 prompt-assembly contract (testing)

## Gate results (independent validation, verified not trusted)
- type-check **PASS**; lint **0 errors**
- test **305/305 vitest + 3/3 Deno PASS**
- build **PASS**; bundle within **P10** caps
- quality verdict **APPROVE**; regression sweep **GREEN**

## P14 review chain (AI tutor behavior) — COMPLETE
ai-engineer (impl) → assessment (CBSE-scope / age-appropriateness: **APPROVE WITH CONDITIONS**, conditions addressed) + testing (coverage GREEN) + quality (independent **APPROVE**).

## Regression catalog
- **REG-182** (P12) — live grounded-path output content backstop: every student-facing exit screened before render/persist; streaming persists a SAFE empty record; Deno emits `abstain` not `done`; fail-safe; Deno twin `HARD_BLOCK_PATTERNS` parity.
- **REG-183** (P12) — student-message injection neutralization: assistant-directed overrides stripped from the model-bound query; original message persisted/shown; fail-open.
- Catalog 148 → **150**. Existing P12 entries **REG-37 / REG-39 / REG-50 / REG-54 / REG-66 / REG-67 remain green**.
  (Authoritative: `.claude/regression-catalog.md`.)

## Open follow-ups carried to STATE.md
FOX-4 (USER APPROVAL — OpenAI provider governance: govern or remove the MoL shadow), FOX-7-new (ai-engineer — extend the screen to the legacy fallback persist path), streaming live-view residual (frontend full-closure; `ff_foxy_streaming`), Hindi profanity-token coverage (tracked).

## Next workflow
**Teacher / School-Admin B2B** — `PRIORITY-BACKLOG.md` rank 5 (invariants P8, P9, P13): class/roster/grade-book/RBAC across institutions; cross-tenant isolation. Owner squad: backend (lead) + architect + frontend.
