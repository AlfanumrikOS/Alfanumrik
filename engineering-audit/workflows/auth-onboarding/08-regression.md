# 08 — Regression: Auth & Onboarding (Cycle 1)

> Phase: REGRESSION. Dependent-workflow regression sweep.

- **Cycle:** cycle-1
- **Workflow:** auth-onboarding (P15)
- **Verification squad:** **testing**
- **Date:** 2026-06-28
- **Validation reference:** `./07-validation.md`

## Regression sweep
- [x] Targeted suite green — **940/940 PASS** (AO-4 suite + 44/44 bootstrap + **896/896 broad
  auth/onboarding/identity run**).
- [x] Relevant Deno edge-function tests green — **10/10** (`send-auth-email/__tests__/always-200.test.ts`).
- [x] No previously-passing test now skipped or weakened — the only `expect(true).toBe(true)` placeholder
  was *replaced* with a real fs-guard (strengthened, not weakened). The new `e2e/auth-onboarding-3role.spec.ts`
  `test.fixme` is an *honest new* gate on absent fixtures, not a downgrade of an existing passing test.
- [x] Build green within bundle caps (shared 279.7/284 kB, middleware 116.2/120 kB, 0 pages > 260 kB).

## Dependent-workflow regression result
The auth spine is shared by several downstream flows. The **896/896 broad auth/onboarding/identity run**
exercises the common spine and shows **no regressions** in the dependent flows that ride it:

| Dependent flow | Shared dependency on auth spine | Regression? |
|---|---|---|
| Dashboard landing (post-signup redirect) | consumes bootstrap success/redirect signal | none — AO-4 only changes the *failure* branch; success redirect byte-for-byte unchanged |
| Parent → child link | parent role flows through the same bootstrap RPC + AuthContext fallback | none — parent happy path unchanged; AO-6 (phone) intentionally untouched |
| Teacher setup / onboarding | teacher role shares the bootstrap + onboarding-page surface | none — AO-8 onboarding label changes are markup-only |
| `signup_complete` analytics | gated on bootstrap `res.ok` | improved — no longer fires on a masked failure (AO-9 transitive) |

## New regression catalog entries

| Proposed REG-ID | Invariant | What it pins | Test file | Filed in catalog? |
|---|---|---|---|---|
| REG-177 | P15 | `send-auth-email` returns 200 on all 9 handler paths (always-200 invariant) | `supabase/functions/send-auth-email/__tests__/always-200.test.ts` | filed by separate testing task (in flight) |

> `.claude/regression-catalog.md` is authoritative. REG-177 (`send_auth_email_always_200`, P15) is being
> added by a separate testing task; CI lane wiring of the Deno suite into `ci.yml` is a separate architect
> task. The AO-4 vitest suite (`bootstrap-rpc-logical-failure.test.ts`) is an additional durable guard for
> the P15 layer-3-fallback restoration and the P13 metadata-only-audit shape.

## Coverage delta

| Metric | Before | After |
|---|---|---|
| New test assertions (this cycle) | — | **+27** (10 Deno always-200 + 7 AO-4 vitest + 3-role E2E (fixme-gated) + fs-guard) |
| Regression catalog entries | 142 (latest REG-175) | 144 with REG-177 (P15 always-200) once filed |
| Targeted auth/onboarding/identity run | (no executable always-200 guard) | 940/940 PASS + Deno 10/10 |

> Snapshotted into `metrics/coverage-trend.md` (2026-06-28 row).

## Residual risk
1. **AO-2 positive path is not yet CI-executed** — the 3-role E2E is `test.fixme`-gated until ops seeds
   per-role staging fixtures + secrets. The #1-funnel positive end-to-end verification remains a tracked
   gap (reduced, not closed).
2. **AO-1 CI enforcement pending** — the always-200 Deno suite passes locally but is not gating on PRs
   until the architect task wires it into the `ci.yml` `edge-function-tests` lane and REG-177 is filed.
3. **AO-3 / AO-5 open by design** — institution_admin provisioning unification (architect + user approval)
   and "Grade 9"→"9" P5 normalization (assessment sign-off) remain. AO-4 closes AO-3's silent-success
   symptom; the provisioning gap itself is unaddressed.
4. **AO-6 / AO-7** low-severity convergence items deferred to a future auth pass.

## Sweep verdict
**GREEN** — all executed suites pass, no dependent-flow regression, the new guards strengthen the P15
surface; the residual items above are tracked follow-ups, not sweep failures.
