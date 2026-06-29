# 06 — Self-Review: Cross-Cutting Invariants (Cycle 8, FINAL)

> Phase: SELF-REVIEW. The implementation squad reviews its own work before independent validation.

- **Cycle:** cycle-8 (the final cycle of the 8-cycle program)
- **Workflow:** cross-cutting — P7 (bilingual breadth), P8 (RLS breadth), P10 (bundle), mobile-web sync
- **Reviewer (authors):** backend (Track A — XC-1/XC-2 P7 server-notification Hindi in `daily-cron/index.ts`) + testing (Track B — XC-6/XC-5/XC-4a drift contracts + cap pin)
- **Date:** 2026-06-29
- **Implementation reference:** `./05-implementation.md`

## Per-gap verification

| Gap ID | Tag | Severity | Owner | Disposition | Evidence (file / test) |
|---|---|---|---|---|---|
| **XC-1** | P7 | Medium | backend | **LANDED** | `supabase/functions/daily-cron/index.ts` ~569-607 — `data.title_hi`+`data.body_hi` added to all 3 score-milestone producers (score-drop / above-80 / below-50), student-informal tone, all numeric interpolations preserved. English/triggers/thresholds unchanged. |
| **XC-2** | P7 | Low-Med | backend | **LANDED** | `daily-cron/index.ts` ~167/172 — parent-digest producers: the previously-DEAD top-level `body_hi` relocated into `data.body_hi` (the shape the client reads) + `data.title_hi` added; parent-formal tone. |
| **XC-6** | mobile | Med-High | testing | **LANDED** | `subscription-price-drift.test.ts` — web↔mobile price parity (REG-191); parity-only, no value pinned. |
| **XC-5** | mobile | Medium | testing | **LANDED** | `score-config-drift.test.ts` — 41 score-config constants web↔Flutter parity (REG-192). |
| **XC-4a** | P10 | Medium | testing | **LANDED** | `bundle-cap-pin.test.ts` — CAP_SHARED_KB=284 / CAP_PAGE_KB=260 / CAP_MIDDLEWARE_KB=120 pinned (REG-193). |
| **XC-3** | P8 | High | (initiative) | **LARGER-PROGRAM** | 316/362 routes (87%) use the RLS-bypassing admin client — boundary is app-layer not RLS. Dedicated multi-sprint RLS defense-in-depth program (subsumes Cycle-5 TSB-2 + Cycle-7 PP-5). NOT touched. |
| **XC-4b** | P10 | Medium | (initiative) | **LARGER-PROGRAM** | @supabase/* AuthContext first-paint split (~57 kB), then ratchet cap toward 160 kB (P15-touching). NOT touched. |
| **XC-7** | P7 | Low | (initiative) | **LARGER-PROGRAM** | Adopt a keyed-resolver i18n primitive (`today/copy.ts` pattern) + missing-string lint — the chokepoint that would mechanically prevent the XC-1/XC-2 class. NOT touched. |

## Self-review checklist

- [x] Every gap in `02-gap-analysis.md` is addressed or explicitly tracked (XC-1/2 backend P7 landed; XC-5/6 + XC-4a testing landed; XC-3/4b/7 = LARGER-PROGRAM tracked initiatives).
- [x] **P7 Track A matches the verified house shape** — top-level English (`title`/`message`/`body`) + Hindi twin in `data.title_hi`/`data.body_hi`. Verified against the prod baseline (`00000000000000_baseline_from_prod.sql:12503-12521` — no `*_hi` columns) and the client reader (`notifications/page.tsx:195-198` reads `data.*_hi` only). The parent-digest's pre-existing top-level `body_hi` was DEAD (no column / never read) — relocating it into `data.body_hi` makes its Hindi actually render.
- [x] **Pure-additive, no behavior change** — no producer's English copy, trigger condition, threshold, idempotency_key, or XP/score value changed. XP and "Performance Score" left untranslated per P7 (product/technical terms).
- [x] **P13 (Track A)** — no PII added; Hindi twins interpolate only the same non-PII values already in the English copy (subject string, integer scores, XP totals, quiz counts, streak days).
- [x] **Track B is parity-only / test-only** — XC-5/XC-6 pin web↔mobile EQUALITY (no absolute value), so they do NOT collide with the PAY-2 USER-gated pricing decision; XC-4a pins the cap declarations. No runtime/source change, no bundle footprint.
- [x] **P13 (Track B)** — drift tests read only numeric/string constants from source files on disk; no PII, no DB, no network.
- [x] **No invariant / pricing / RBAC / AI-model change** in this cycle.
- [x] **type-check** PASS; **lint** 0 errors; **11/11 cross-cutting tests** PASS. (Build deferred to the CI backstop — see `07-validation.md`.)
- [x] Ownership/scope — backend edits limited to `daily-cron/index.ts`; testing edits limited to the 3 new test files. school-operations + parent-portal English-only titles (same P7 class) noted as follow-ups, bounded out per the "daily-cron only" Track-A scope.

## Known limitations carried forward (for the independent reviewer)

1. **XC-3 (P8, HIGH, systemic) — LARGER-PROGRAM.** 87% of API routes use the admin client; defense-in-depth is absent at the dominant data path. A dedicated RLS initiative (inventory by sensitivity → scoped client / RLS backstop → CI rule on new admin-client imports on PII routes). Subsumes Cycle-5 TSB-2 and Cycle-7 PP-5. Multi-sprint.
2. **XC-4b (P10) — LARGER-PROGRAM.** Until the @supabase/* first-paint split lands, shared-JS headroom is razor-thin (279.7/284 kB) and the cap can only ratchet down after the split. The XC-4a pin buys friction in the interim.
3. **XC-7 (P7) — LARGER-PROGRAM.** No central i18n primitive; bilingual parity is held by author discipline, not mechanism. Adopting the keyed-resolver + a missing-string lint would mechanically prevent the XC-1/XC-2 class.
4. **P7 follow-ups (same class as XC-1/XC-2):** `src/app/api/cron/school-operations/route.ts` and the parent-portal insights/tips/glance (Cycle-7 PP-7) carry the same English-only-title gap. Bounded out of the daily-cron Track-A scope; tracked.
5. **Pre-existing Deno `never[]` errors** in `daily-cron/index.ts` on untyped `.update()`/`.upsert()` calls — present pre-change, unrelated to the `data` jsonb string additions; no NEW type error introduced.

## Ready for independent validation?

**YES.** All Cycle-8 auto-fix-safe items (XC-1/XC-2 backend P7; XC-5/XC-6/XC-4a testing) are implemented and locally green (type-check PASS, lint 0, 11/11 tests). XC-3/XC-4b/XC-7 are explicitly recorded as LARGER-PROGRAM initiatives with owners and were not touched.
