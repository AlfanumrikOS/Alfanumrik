# 06 — Self-Review: Auth & Onboarding (Cycle 1)

> Phase: SELF-REVIEW. The implementation squad reviews its own work before independent validation.

- **Cycle:** cycle-1
- **Workflow:** auth-onboarding (P15)
- **Reviewer (authors):** backend (AO-4) + frontend (AO-8) + testing (AO-1/AO-2)
- **Date:** 2026-06-28
- **Implementation reference:** `./05-implementation.md`

## Per-gap verification

| Gap ID | Fixed? | Evidence (test / manual) | Notes |
|---|---|---|---|
| AO-1 | yes | `supabase/functions/send-auth-email/__tests__/always-200.test.ts` (10 Deno tests, all 9 handler paths + source canary); placeholder `expect(true).toBe(true)` replaced with real fs-guard in `e2e/auth-onboarding-p15.spec.ts` | Infra blocker (no Deno harness) removed. CI lane wiring + REG-177 filing are separate tracked tasks. |
| AO-2 | partial (honest) | `e2e/auth-onboarding-3role.spec.ts` (3-role signup→profile→dashboard, real assertions, `test.fixme`-gated on absent per-role staging creds; seeding docs in spec header) | NOT fake-green. Un-gating needs ops-seeded fixtures + secrets. |
| AO-3 | deferred (GATED) | — | B2B role-provisioning policy → USER APPROVAL + architect design. Silent-success symptom already closed by AO-4. |
| AO-4 | yes | `src/app/api/auth/bootstrap/route.ts` branches on RPC in-body `status:'error'` / missing `profile_id` → 500 `BOOTSTRAP_FAILED`; pinned by `src/__tests__/api/auth/bootstrap-rpc-logical-failure.test.ts` (7 vitest) | Happy/idempotent paths byte-for-byte unchanged. P13 metadata-only audit. |
| AO-5 | deferred (GATED) | — | "Grade 9" vs "9" touches P5; needs assessment sign-off + grep of `students.grade` readers. |
| AO-6 | deferred (backlog) | — | Parent phone dropped at signup; auto-fix safe, future auth pass. |
| AO-7 | deferred (backlog) | — | `.single()` → `.maybeSingle()` log-noise; auto-fix safe, future pass. |
| AO-8 | yes | `src/components/auth/AuthScreen.tsx` (tablist ARIA + roving-tabindex + tabpanel + form error association) and `src/app/onboarding/page.tsx` (label/input pairing, goal `role=group`) | No logic/visual/copy change. P7 preserved. |
| AO-9 | yes (transitive) | resolved by AO-4 — bootstrap 2xx signal is now trustworthy, so `res.ok`-gated `signup_complete` no longer fires on a masked failure | Dedicated client-side analytics gate hardening remains an optional frontend follow-up. |

## Self-review checklist
- [x] Every gap in `02-gap-analysis.md` is addressed or explicitly deferred (AO-1/4/8/9 landed; AO-2 honest-partial; AO-3/5/6/7 deferred with reasons).
- [x] No broken links / dead buttons / empty-placeholder states remain on touched paths.
- [x] Loading, empty, and error states handled for touched UI — AO-8 error region now programmatically associated (`role="alert"` + `aria-describedby`); no new state introduced.
- [x] Bilingual (P7) strings preserved for touched UI — AO-8 added no copy; reused existing `isHi` strings. (Pre-existing English-only tablist `aria-label` noted for a future P7 pass — not introduced this cycle.)
- [x] RLS (P8) + `authorizeRequest` (P9) on touched data paths — AO-4 reads/writes through the existing server route; no new data path. AO-8 touches no data path.
- [x] No PII in logs / Sentry / analytics (P13) — AO-4 audit carries `role` + static error token + `rpc_status` only; raw `SQLERRM` deliberately omitted; `console.error` carries UUID only.
- [x] Invariants P1–P15 re-checked for regressions — P15 made MORE complete (layer-3 fallback now engages on real failure), not weakened. P5 deliberately untouched (gated as AO-5). No P1/P2/P11/P12 surfaces touched.
- [x] No `any` in new code; no `console.log` (AO-4 uses `console.error`); no weakened assertions — placeholder marker replaced with a real fs-guard.
- [x] Migrations idempotent; RLS in same file — N/A (no migration in this cycle; pure app/test code).
- [x] Feature-flag changes audited — N/A (no flag added or toggled this cycle).

## Known limitations carried forward (for the independent reviewer)
1. **AO-2 is honestly partial.** The 3-role E2E exists with real assertions but is `test.fixme`-gated; the positive path does not yet execute in CI until ops seeds per-role staging fixtures + secrets. The funnel's positive end-to-end verification gap is reduced (the spec is written and reviewable) but not closed.
2. **AO-3 / AO-5 remain open by design** — both require an approval/sign-off gate (B2B provisioning policy / P5 ownership) and were intentionally NOT touched. AO-4 closes AO-3's *silent-success* symptom but the institution_admin provisioning-unification gap itself remains.
3. **AO-6 / AO-7 / AO-9-hardening** are low-severity convergence items left for a future auth pass.
4. **CI enforcement of AO-1** depends on the separate architect task wiring `always-200.test.ts` into the `ci.yml` Deno lane; until merged, the Deno suite passes locally but is not yet gating on PRs.
5. **REG-177** is filed by a separate testing task; this self-review assumes it lands as the durable guard for the restored P15-rule-1 surface.

## Ready for independent validation?
**YES.** All Cycle-1 in-scope items (AO-4, AO-8, AO-1, AO-2-honest-partial) are implemented and locally green; deferred items are explicitly listed with their gating reason.
