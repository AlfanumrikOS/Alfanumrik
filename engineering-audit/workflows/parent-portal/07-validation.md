# 07 — Independent Validation: Parent Portal (Cycle 7)

> Phase: INDEPENDENT VALIDATION. A fresh quality agent (did NOT implement) verifies.

- **Cycle:** cycle-7
- **Workflow:** parent-portal (dual auth + DPDP) — P8 (RLS boundary), P13 (data privacy), P15 (onboarding integrity); P9 cross-check
- **Validator squad:** **quality** (independent of the builder squad)
- **Date:** 2026-06-29
- **Self-review reference:** `./06-self-review.md`
- **Verdict:** **APPROVE**

## Independence statement

The validating quality agent did **not** author any Cycle-7 change (PP-2 shared validator + 3-site application; PP-1 rate-limit half; PP-4 authz gate; PP-5 deny pins). It re-ran every gate from a clean state rather than trusting the builders' reported results, and independently confirmed (a) the Next.js `src/lib/sanitize.ts` and Deno `supabase/functions/_shared/link-code.ts` validators are byte-identical and produce identical verdicts, (b) the validator runs BEFORE the `.or()` filter at all three interpolation sites, and (c) `profile.update_own` is already granted to the parent role (no new RBAC).

## What was verified (not trusted)

### PP-2 — link-code filter-injection (P8/P13)
- Confirmed `isValidLinkCode` (`^[A-Z0-9]{4,12}$`) is applied AFTER `.trim().toUpperCase()` and BEFORE the `.or('invite_code.eq.${code},link_code.eq.${code}')` lookup at all three sites: `request-otp/route.ts`, `accept-invite/route.ts`, and the Edge `parent-portal/index.ts` `handleParentLogin`.
- Confirmed the regex admits no PostgREST control character (`,` `.` `(` `)` `*` `:` quote/whitespace), so a crafted code (`A,deleted_at.is.null` etc.) can never reach the query; both legitimate formats (6-char `link_code`, 8-char `invite_code`) pass unchanged.
- Confirmed each site keeps its posture: request-otp → enumeration-safe `silentSuccess()`; accept-invite → generic `409`; Edge `parent_login` → 200 no-match. The link-code FORMAT is not changed.
- Confirmed the two validator copies are byte-identical (twin-parity test) with cross-reference comments requiring sync.

### PP-1 — per-IP rate limit on the legacy Edge path (P8/P13, auto-fix-safe HALF)
- Confirmed `handleParentLogin` now runs a per-IP `createRateLimiter` (5/hour) as its first statement, BEFORE any DB lookup; 6th attempt → `429` + `Retry-After`; PII-safe `console.warn` (limits/counts/`retry_after_ms` only — no IP / link code / name / email / phone).
- Confirmed the consent-posture change is NOT made (link-code-alone still yields an `active` link) and that a `TODO(PP-1, USER-GATED)` marks the deferred consent-model fix in code. This is correctly surfaced to the program RISK register.

### PP-4 — profile authz gate (P9)
- Confirmed `PATCH /api/parent/profile` now gates on `authorizeRequest('profile.update_own')`, independently re-derived that `profile.update_own` is already granted to the parent role (`20260612123200_rbac_matrix_conformance.sql:238`) — **no new permission code**, no RBAC change.
- Confirmed self-scope: the update target is resolved from the verified `auth.userId` (no body-supplied id) → **no IDOR**. `authorizeRequest` accepts both Bearer JWT and cookie session (superset — existing callers unaffected).

### PP-5 — unlinked-parent deny pins (P8/P13, test HALF)
- Confirmed `parent-child-data-deny.test.ts` asserts a 403 with **no child payload** for an unlinked parent across all 9 child-data routes, and pins the canonical guardian-link boundary (`status IN ('active','approved')`) for both `canAccessStudent` and `isGuardianLinkedToStudent`. The client-migration half (RLS-scoped reads) is correctly left to architect.

## Gate re-run (verified, not trusted) — quality gates, verbatim

- [x] **type-check** — **PASS**
- [x] **lint** — **PASS** (0 errors)
- [x] **test** — **PASS** — **104/104 target + 404/404 broad** parent/guardian tests (incl. the **5 new files / 71 new tests**)
- [x] **build** — **PASS**
- [x] **bundle** — within **P10** caps (4 changed runtime files are server routes + one Deno Edge Function + a tiny pure validator module; test files have no bundle footprint — no shared-chunk or page-budget impact)

## The 3 follow-ups (documented, not validation failures)

1. **PP-1 consent posture (HIGH, USER-GATED).** `parent_login` creates an ACTIVE guardian link from a link code ALONE — no approval. The rate limit closes brute-force; the consent-model fix (require approval / deprecate `parent_login`) is DPDP-relevant and requires CEO approval. On the RISK register.
2. **PP-3 (MED, USER-GATED).** Four parallel link-creation paths + two terminal statuses; consolidating onto one consent-respecting choke-point changes the link model. Retiring `parent_login` collapses PP-1 + PP-3.
3. **PP-5 client migration (architect), PP-6 (LOW, behavior-preserving helper convergence), PP-7 (MED, P7 bilingual — Cycle 8 candidate), and the PP-1 durable limiter (Upstash/DB-backed, architect)** — tracked follow-ups.

## Invariant audit (P1–P15)

| Invariant | Relevant? | Upheld? | Evidence |
|---|---|---|---|
| P8 RLS boundary | yes (primary) | yes — strengthened | PP-2 validator can only NARROW what the `.or()` query matches (never broadens access); PP-5 pins the unlinked-parent deny across all 9 child-data routes. No RLS posture change. |
| P13 Data privacy | yes (primary) | yes — strengthened | PP-1 429 carries no child/guardian payload; new warn logs limits/counts only; PP-5 deny paths return no child payload. No PII added to any log. |
| P15 Onboarding integrity | yes | yes (unchanged) | The parent link funnel (A1 approve-link / A2 OTP / A3 accept-invite) is unchanged; PP-2 only rejects out-of-format codes; REG-110/111/117 still green. |
| P9 RBAC enforcement | yes (cross-check) | yes — strengthened | PP-4 brings `PATCH /api/parent/profile` onto the house `authorizeRequest` pattern using an already-granted permission; no role/permission added or altered. |
| P10 Bundle budget | yes | yes (unchanged) | Server routes + Edge Function + tiny pure module + test-only files; no shared-chunk or page-budget impact. |
| P1–P7, P11, P12 | no (this cycle) | n/a | No scoring/XP/anti-cheat/atomic/grade-format/question-quality/payment/AI surface touched. (P7 bilingual is the PP-7 deferred follow-up.) |

## Gated dispositions (independent confirmation)

- **PP-1 consent posture (USER-GATED).** Confirmed not touched; correctly surfaced to the program RISK register for CEO decision (parent-link consent model).
- **PP-3 (USER-GATED).** Confirmed not touched; link-model consolidation requires CEO approval.

## Verdict

**APPROVE** — the in-scope auto-fix-safe set (PP-2 backend, PP-1 rate-limit half backend, PP-4 backend, PP-5 deny pins testing) passes independent re-test; all gates green (type-check PASS, lint 0 errors, 104/104 target + 404/404 broad PASS, build PASS, bundle within P10); the validator-twin-parity, gate-before-filter, and already-granted-permission claims independently confirmed; no invariant regression. PP-1 consent posture + PP-3 (USER-gated) and the PP-5 client-migration / PP-6 / PP-7 / durable-limiter follow-ups are documented gated/follow-ups, not validation failures.

## Gate 5 (P14 review-chain) confirmation

The mandatory chain for this change is **COMPLETE**: backend (impl PP-2 + PP-1 rate-limit half + PP-4) + testing (PP-5 deny pins + the 5-file/71-test suite, coverage GREEN) + quality (independent **APPROVE**). architect is noted for the gated/RLS follow-ups (PP-5 client migration + PP-1 durable limiter); the PP-1-consent / PP-3 link-model decisions are USER-gated. See `08-regression.md`.

## Required fixes before COMPLETE (if REJECT)

None outstanding for the auto-fix-safe set. The workflow is not marked fully COMPLETE only because **PP-1 (consent posture)** and **PP-3** are USER-gated (parent-link consent model — CEO decision) and the PP-5 client-migration / PP-6 / PP-7 / durable-limiter items are tracked follow-ups; see `STATUS.md`.
