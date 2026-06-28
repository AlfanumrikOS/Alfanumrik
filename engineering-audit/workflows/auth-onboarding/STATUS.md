# STATUS: Auth & Onboarding (Cycle 1)

> One per workflow cycle. The workflow is **COMPLETE** only when every box below is checked.

- **Cycle:** cycle-1
- **Workflow:** auth-onboarding (P15)
- **Primary invariants:** P15, P8, P9, P13 (P7 touched-adjacent; P5 deferred)
- **Owner squad:** architect (lead) + backend + frontend + testing
- **Started:** 2026-06-28
- **Status:** **CYCLE 1 LANDED — partial; follow-ups tracked** (not fully COMPLETE — gated items remain)

## Phase progress
| Phase | Artifact | Done |
|---|---|---|
| MAP | `01-map.md` | [x] |
| IDENTIFY GAPS | `02-gap-analysis.md` | [x] |
| ROOT CAUSE | `03-root-cause.md` | [x] |
| DESIGN | `04-solution-design.md` | [x] |
| IMPLEMENT | `05-implementation.md` | [x] |
| SELF-REVIEW | `06-self-review.md` | [x] |
| INDEPENDENT VALIDATION | `07-validation.md` | [x] |
| REGRESSION | `08-regression.md` | [x] |

## Completion gate
Status of each gate item for the Cycle-1 *landed* set:

- [x] **Business goal met** for the in-scope set — bootstrap failure-handling (AO-4), auth-form a11y (AO-8), always-200 executable guard (AO-1) landed and approved. *(NOT fully met: AO-2 positive 3-role E2E not yet CI-executed; AO-3 institution_admin provisioning unification deferred.)*
- [x] **No broken/empty states** on touched paths.
- [x] **Accessibility** — keyboard nav, labels, focus on touched UI (AO-8).
- [x] **Security — RLS (P8)** — no new data path; existing posture unchanged.
- [x] **Security — RBAC (P9)** — bootstrap route auth posture unchanged.
- [x] **Privacy (P13)** — no PII in AO-4 logs/audit; pinned by regression test.
- [x] **Invariants P1–P15** upheld; P15 strengthened, no regression. *(P5 deliberately deferred as AO-5.)*
- [x] **type-check** green.
- [x] **lint** green (0 errors; 6 pre-existing warnings unrelated).
- [x] **test** green (940/940 + Deno 10/10).
- [x] **build** green within budgets (shared 279.7/284 kB, middleware 116.2/120 kB, 0 pages > 260 kB).
- [x] **Quality verdict = APPROVE** (`07-validation.md`, independent).
- [ ] **P14 review chain complete** — architect-led chain ran (backend/frontend/testing); CI-lane wiring of the always-200 Deno suite is a separate in-flight architect task → **not yet closed**.
- [ ] **Regression sweep green + catalog filed** — sweep GREEN (`08-regression.md`); **REG-177 filing is in flight** via a separate testing task → not yet confirmed in `.claude/regression-catalog.md`.

## Cycle-1 follow-ups LANDED (2026-06-29) — AO-5 / AO-7 / AO-9
The three remaining auto-fix-safe follow-ups are now done (type-check PASS, lint 0 errors). See
`05-implementation.md` → "Cycle 1 follow-ups (AO-5/7/9)" and
`cycles/2026-06-29-auth-onboarding-followups.md`.
- **AO-5 (assessment, FIXED):** `src/app/onboarding/page.tsx` now stores the bare canonical grade
  string ("9") not "Grade 9" — conforms to **P5**. Reader-safety proof rigorous (8+ `parseInt` sites
  return NaN on "Grade 9"; StreamGate exact-match; SQL readers form-invariant via `normalize_grade()`).
  Assessment verdict **APPROVE**.
- **AO-7 (backend, FIXED):** `src/lib/identity/onboarding.ts` `resolveIdentity()` — four `.single()` →
  `.maybeSingle()` (students/teachers/guardians/onboarding_state). Behavior-preserving; removes
  PGRST116 log noise on the normal no-row path.
- **AO-9 (frontend, FIXED):** `src/lib/AuthContext.tsx` — `signup_complete` analytics emission wrapped
  in a durable per-user once-guard (localStorage key by auth UUID); fires exactly once per signup even
  across sessions. No PII (**P13**); degrades safely if localStorage unavailable (**P15**).

## Why NOT fully COMPLETE — open follow-ups (resume here next session)
1. **AO-3 (Medium, GATED):** institution_admin provisioning unification — **requires USER APPROVAL** (B2B role-provisioning policy) + architect-led design. AO-4 already closed the silent-success symptom.
2. **AO-2 CI un-gating:** ops to seed 3 per-role staging fixtures + secrets (documented in `e2e/auth-onboarding-3role.spec.ts` header) so the `test.fixme` can be lifted to a gating positive E2E.
3. **AO-1 CI enforcement:** architect task to wire `send-auth-email/__tests__/always-200.test.ts` into the `ci.yml` `edge-function-tests` Deno lane.
4. **REG-177:** separate testing task to file `send_auth_email_always_200` (P15) into `.claude/regression-catalog.md`.
5. **AO-10 (NEW — grade-coercion / legacy backfill, co-owned assessment + architect):** `src/lib/AuthContext.tsx` (~lines 423-424) sets the `student` object from the raw DB row **without grade coercion**, so any legacy "Grade N" rows already in the DB still leak the prefixed form to TS readers until backfilled. The `normalize_grade` SQL helper is **misnamed** vs the TS canonical (it ADDS the "Grade " prefix). Broader convergence/backfill item: needs (a) a one-time data backfill of legacy `students.grade` rows to the bare canonical form, and (b) either renaming/repurposing `normalize_grade` or a read-time coercion in AuthContext. Discovered by assessment during AO-5.
6. **AO-6 (Low, backlog):** parent phone dropped at signup. Future auth pass.

> AO-5 / AO-7 / AO-9 removed from the open list above — LANDED 2026-06-29 (see the LANDED section).

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder | backend + frontend + testing | 2026-06-28 | DONE (in-scope set) |
| Quality (independent) | quality | 2026-06-28 | **APPROVE** |
| Testing | testing | 2026-06-28 | **GREEN** (sweep) |
| Orchestrator (mark COMPLETE) | — | — | NOT YET — partial; follow-ups above |
