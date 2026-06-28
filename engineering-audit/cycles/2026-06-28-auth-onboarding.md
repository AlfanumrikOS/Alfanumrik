# Cycle Log — 2026-06-28 — Auth & Onboarding (P15)

> Dated summary of Cycle 1, the first workflow of the engineering-audit program.
> Authoritative ledger lives under `workflows/auth-onboarding/` (01-map … 08-regression + STATUS.md).

## Workflow
- **Cycle:** 1
- **Workflow:** auth-onboarding
- **Primary invariants:** P15 (onboarding integrity), P8, P9, P13 (P7 touched-adjacent; P5 deferred)
- **Status:** **CYCLE 1 LANDED — partial; follow-ups tracked**

## Agents involved
- **architect** — workflow lead + review chain; (in flight) wiring the always-200 Deno suite into CI.
- **backend** — AO-4 (`src/app/api/auth/bootstrap/route.ts`).
- **frontend** — AO-8 (`src/components/auth/AuthScreen.tsx`, `src/app/onboarding/page.tsx`).
- **testing** — AO-1 / AO-2 (Deno always-200 suite, 3-role E2E, AO-4 regression test); (in flight) filing REG-177.
- **quality** — independent validation (did not implement); verdict APPROVE.
- **ops (this doc)** — ledger finalization.

## Gaps found (AO-1 … AO-9)
| ID | Title | Severity | Disposition |
|---|---|---|---|
| AO-1 | send-auth-email always-200 invariant had NO executable test | High | **LANDED** — 10 Deno tests + source canary; placeholder removed |
| AO-2 | No real 3-role signup→profile→dashboard E2E | High | **LANDED (honest-partial)** — real assertions, `test.fixme`-gated on CI seeding |
| AO-3 | institution_admin unsupported by failsafe layers 2 & 3 | Medium | **GATED** — needs USER APPROVAL + architect design; symptom closed by AO-4 |
| AO-4 | bootstrap route ignored RPC in-body `status:'error'` | Medium | **LANDED** — 500 `BOOTSTRAP_FAILED`; P15 layer-3 fallback engages |
| AO-5 | grade written "Grade 9" vs canonical "9" (P5 drift) | Low | **GATED** — needs assessment/P5 sign-off + reader grep |
| AO-6 | parent phone dropped at signup | Low | **BACKLOG** — future auth pass |
| AO-7 | `resolveIdentity` `.single()` log noise | Low | **BACKLOG** — future auth pass |
| AO-8 | auth-form a11y (labels + tab ARIA) | Low | **LANDED** — tablist ARIA + roving-tabindex + label pairing |
| AO-9 | `signup_complete` over-counts on masked failure | Low | **LANDED (transitive)** — resolved by AO-4 |

## What landed vs gated
- **Landed + APPROVED:** AO-4, AO-8, AO-1, AO-2 (honest-partial), AO-9 (transitive).
- **Gated (approval/sign-off required):** AO-3 (B2B provisioning policy — user approval), AO-5 (P5 — assessment).
- **Backlog:** AO-6, AO-7, AO-9-client-gate-hardening.

## Files touched (code/test — by builders, outside this doc-only finalization)
- `src/app/api/auth/bootstrap/route.ts` (AO-4)
- `src/components/auth/AuthScreen.tsx`, `src/app/onboarding/page.tsx` (AO-8)
- `supabase/functions/send-auth-email/__tests__/always-200.test.ts` (AO-1)
- `e2e/auth-onboarding-p15.spec.ts` (placeholder → real fs-guard), `e2e/auth-onboarding-3role.spec.ts` (AO-2)
- `src/__tests__/api/auth/bootstrap-rpc-logical-failure.test.ts` (AO-4 regression test)

## Gate results (independent validation, verified not trusted)
- type-check **PASS**; lint **PASS** (0 errors, 6 pre-existing unrelated warnings)
- test **940/940 PASS** (AO-4 suite + 44/44 bootstrap + 896/896 broad auth/onboarding/identity)
- build **PASS** — shared **279.7 / 284 kB**, middleware **116.2 / 120 kB**, 0 pages > 260 kB
- Deno **10/10 PASS**
- **Verdict: APPROVE**; regression sweep **GREEN** (no dependent-flow regression).

## Regression catalog
- **REG-177** (`send_auth_email_always_200`, P15) — being filed by a separate testing task; pins the
  always-200 invariant the new Deno suite enforces. (Authoritative: `.claude/regression-catalog.md`.)
- AO-4 vitest suite serves as an additional durable guard for the P15 layer-3-fallback restoration and
  the P13 metadata-only-audit shape.

## Open follow-ups carried to STATE.md
AO-3 (user approval), AO-5 (assessment sign-off), AO-2 CI seeding (ops), AO-1 CI-lane wiring (architect),
REG-177 filing (testing), AO-6/AO-7 backlog.

## Next workflow
**Payments & Subscriptions (P11)** — `PRIORITY-BACKLOG.md` rank 2.
