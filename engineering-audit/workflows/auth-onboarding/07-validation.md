# 07 — Independent Validation: Auth & Onboarding (Cycle 1)

> Phase: INDEPENDENT VALIDATION. A fresh quality agent (did NOT implement) verifies.

- **Cycle:** cycle-1
- **Workflow:** auth-onboarding (P15)
- **Validator squad:** **quality** (independent of the builder squad)
- **Date:** 2026-06-28
- **Self-review reference:** `./06-self-review.md`

## Independence statement
The validating quality agent did **not** author any of the Cycle-1 changes (AO-4 backend, AO-8 frontend,
AO-1/AO-2 testing). It re-ran every gate from a clean state rather than trusting the builders' reported
results.

## Per-gap independent verdict

| Gap ID | Builder claim | Validator finding | Verdict |
|---|---|---|---|
| AO-4 | bootstrap returns 500 `BOOTSTRAP_FAILED` on RPC in-body `status:'error'` / missing `profile_id`; happy paths unchanged; P13 metadata-only audit | Re-ran the 7-test AO-4 vitest suite + the 44/44 bootstrap suite; confirmed 500 on both logical-failure branches, byte-for-byte happy-path response, audit carries no PII | **PASS** |
| AO-8 | tablist ARIA + roving-tabindex + tabpanel (gated to `mode!=='check-email'`) + form error association; onboarding label pairing; no logic/visual/copy change | Inspected markup; verified no dangling tabpanel ref in check-email mode, keyboard nav present, no copy/visual diff; P7 preserved | **PASS** |
| AO-1 | 10 Deno tests assert 200 on all 9 handler paths + source canary; placeholder replaced with real fs-guard | Ran Deno suite 10/10 PASS; confirmed `expect(true).toBe(true)` is gone, replaced by a real fs-guard | **PASS** |
| AO-2 | 3-role E2E with real assertions, honestly `test.fixme`-gated on absent staging creds, seeding docs in header | Confirmed real (non-conditional) assertions and honest `test.fixme` gating with documented seeding requirements; NOT fake-green | **PASS (honest-partial)** |

## Gate re-run (verified, not trusted)
- [x] **type-check** — PASS
- [x] **lint** — PASS (0 errors; 6 pre-existing warnings in unrelated files)
- [x] **test** — PASS **940/940** (AO-4 suite + 44/44 bootstrap + 896/896 broad auth/onboarding/identity run)
- [x] **build** — PASS, bundle within caps: **shared 279.7 / 284 kB**, **middleware 116.2 / 120 kB**, **0 pages over 260 kB**
- [x] **Deno** — PASS **10/10** (`send-auth-email/__tests__/always-200.test.ts`)

## Invariant audit (P1–P15)

| Invariant | Relevant? | Upheld? | Evidence |
|---|---|---|---|
| P15 Onboarding integrity | yes | yes — strengthened | AO-4 restores the layer-3 AuthContext fallback on real failure; AO-1 adds the first executable always-200 guard; `send-auth-email` still 200 on all paths |
| P13 Data privacy | yes | yes | AO-4 audit + `console.error` carry only role/UUID/static-token; pinned by the AO-4 regression test |
| P8 RLS / P9 RBAC | yes | yes (unchanged) | AO-4 flows through the existing server route; no new data path; AO-8 touches no data path |
| P7 Bilingual | yes | yes | AO-8 added no copy; reused `isHi` strings. Pre-existing English-only tablist `aria-label` flagged for a future P7 pass (not a regression) |
| P5 Grade format | yes (touched-adjacent) | yes (untouched by design) | AO-5 deliberately deferred under assessment/P5 ownership |
| P1/P2/P4/P11/P12 | no | n/a | No scoring/XP/payment/AI surface touched this cycle |

## Security audit
- [x] RLS boundary verified on touched tables (P8) — no new table/data path; existing route posture unchanged.
- [x] RBAC enforced server-side on touched routes (P9) — bootstrap route auth posture unchanged.
- [x] No PII in responses / logs / exports (P13) — confirmed on AO-4 audit + diagnostic log.

## UX / a11y audit
- [x] No broken/empty states; keyboard nav present (roving-tabindex + arrow keys); labels paired on onboarding selects; form error programmatically associated; focus moves with selection; no dangling tabpanel ref.

## Minor non-gating notes (recorded verbatim)
1. The role tablist `aria-label="Account type"` is **English-only**, but this is **PRE-EXISTING** (not
   introduced this cycle) — deferred to a future P7 pass.
2. AO-4 newly converts the pathological **NULL-`profile_id` `already_completed`** case from a 200 to a
   500 → client-fallback. This is **strictly safer** (a corrupted/never-occurring row now self-heals
   instead of reporting a false success).

## Verdict
**APPROVE** — all four in-scope gaps pass independent re-test; all gates green; no invariant regression;
the two notes are non-gating (one pre-existing, one strictly safer).

## Required fixes before COMPLETE (if REJECT)
None. (Workflow is not marked fully COMPLETE only because separately-gated follow-ups remain —
AO-3, AO-5, AO-2 CI seeding — none of which are validation failures; see `STATUS.md`.)
