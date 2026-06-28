# Auth & Onboarding — Cycle 1 Solution Design (auto-fix-safe set)

Scope: the auto-fix-safe gaps from `02-gap-analysis.md` (root causes in `03-root-cause.md`)
that Cycle 1 ships without a user-approval gate. Each item below states the chosen approach,
the alternatives rejected, residual risk, and rollback. Gated/deferred items are listed
explicitly with the reason they are NOT in this cycle.

Guiding constraint for every item: **P15 (Onboarding Integrity) — never make the funnel worse.**
The signup→verification→profile→dashboard path is the #1 acquisition route; every change must
preserve graceful degradation and the 3-layer profile failsafe.

---

## In-scope (Cycle 1 auto-fix-safe)

### AO-4 — `/api/auth/bootstrap` ignores RPC logical-failure status (BACKEND — DONE this cycle)

**Problem.** `bootstrap_user_profile` signals failure on TWO channels: (a) it RAISES (surfaced to
the route as `rpcError`), or (b) it RETURNS `{ status: 'error', error: <message>, link_status: ... }`
WITHOUT raising — from its invalid-role `ELSE` branch and its `EXCEPTION WHEN OTHERS` insert-failure
branch. The route branched only on `rpcError`, so channel (b) produced HTTP 200 `success:true` with
`profile_id` undefined. Downstream, the client redirected the user to a portal with no profile and
fired `signup_complete` analytics prematurely; the P15 layer-3 (AuthContext runtime) fallback never
engaged because the API reported success.

**Chosen approach — branch on the RPC's documented return shape, delegate recovery to the client.**
After the existing `rpcError` guard, inspect the in-body payload: if `result.status === 'error'` OR
`profile_id` is missing, emit a best-effort metadata-only audit (`bootstrap_failure`) and return a
non-200 (`500`, `code: 'BOOTSTRAP_FAILED'`) WITHOUT reporting success. This hands control back to the
client's next failsafe layer (AuthContext re-resolves identity and rebuilds the profile), which is the
established P15 recovery mechanism. Happy paths (`status:'success'` and the idempotent
`status:'already_completed'`, both of which carry a non-null `profile_id`) are unchanged byte-for-byte.

**Why branch on the contract, not the error string.** Mapping the literal `'Invalid role'` text (or any
single SQLERRM) would be brittle and would miss future logical-error paths. Treating `status` /
`profile_id` presence as the contract catches ANY logical failure, present or future. This is the
durable fix called out in the root-cause analysis (contract reconciliation, not symptom matching).

**Alternatives rejected:**
- *Retry the RPC in-route.* Rejected. The RPC is idempotent, so an immediate re-call reproduces the
  same logical failure (an invalid role stays invalid; a deterministic insert error recurs). It adds
  latency and DB load on the hot signup path with no recovery benefit. The client fallback, which can
  re-resolve identity and rebuild the payload, is the correct retry surface.
- *Map only the `'Invalid role'` string to a failure.* Rejected as brittle (see above); leaves the
  `EXCEPTION WHEN OTHERS` insert-failure branch still reported as success.
- *Return 200 with `success:false` in the body.* Rejected. Several client failsafe checks key on
  `res.ok`; a 200 would let `signup_complete` and redirect logic continue to treat the call as a win.
  A non-200 is the unambiguous signal the existing client fallback already understands (it mirrors the
  pre-existing `rpcError` branch, which also returns 500).
- *Throw / let it bubble.* Rejected — would violate P15 graceful degradation; the route must return a
  structured response, never an unhandled throw.

**P13 (no PII in logs).** The audit metadata carries only `role`, a static `error` token
(`rpc_logical_error` / `missing_profile_id`), and `rpc_status`. The raw `SQLERRM` (which can embed a
conflicting column value) is deliberately NOT logged. The `console.error` carries `user.id` (a UUID,
consistent with existing diagnostics in this file), `role`, and `rpcStatus` — no name/email/grade.

**Idempotency preserved.** The in-memory + Redis dedup guard and the RPC's `ON CONFLICT` idempotency
are untouched; the new branch sits after the RPC call and only changes how an already-returned logical
error is reported. On a 500, the Redis lock for the user is released by the existing `catch` path only
when `handleBootstrap` throws — here it returns normally, so the 30s lock TTL governs retry spacing,
exactly as it did for the pre-existing `rpcError` 500. No change to retry semantics.

**Risk.** Low. The only behavior change is: previously-masked logical failures now return 500 instead
of a false 200. The one theoretical edge — an `already_completed` row with a NULL `profile_id` — cannot
arise in normal operation (the RPC sets `step='completed'` and `profile_id` in the same UPDATE, with
`profile_id` non-null after a successful `RETURNING`); a corrupted row would now (correctly) trigger the
self-heal retry instead of a false success.

**Migration/rollback.** Pure application code in a single file
(`src/app/api/auth/bootstrap/route.ts`). No schema change, no migration. Rollback = `git revert` of the
commit. AO-9 (`signup_complete` over-count) folds in automatically: with AO-4 the bootstrap 2xx signal
is trustworthy, so the client's `res.ok`-gated analytics event no longer fires on a masked failure.
(The dedicated analytics gate hardening lives in `AuthContext.tsx`, frontend-owned, and is tracked but
not required for AO-4's correctness.)

---

### AO-1 — send-auth-email "always-200" invariant has NO executable test (TESTING — this cycle)

**Problem.** P15 rule 1 (the function returns 200 on all paths, or Supabase blocks signup) has no
real test; the E2E placeholder asserts `expect(true).toBe(true)` and references a unit group that was
never written. The function CODE is compliant (verified in §A of the gap analysis); only verification
is missing.

**Chosen approach (testing agent).** Make the response-shaping logic reachable from the Node/Vitest
layer — either extract the status/headers shaping into a pure helper the unit suite can import, or add
a Deno test job — and assert HTTP 200 on the six documented paths (non-POST, missing secret, bad
signature, invalid payload, no Mailgun config, send success/fail, top-level throw, OPTIONS). Replace
the `expect(true).toBe(true)` marker with a real assertion or a `test.fixme` carrying a tracking ID so
the regression catalog stops over-reporting coverage.

**Rationale / alternatives.** The root cause is infra (no Deno harness, no HTTP surface). Re-asserting
`true` changes nothing; extracting a pure module removes the infra blocker at lowest cost. Risk: none
(test-only). Rollback: revert test files.

---

### AO-2 — No real 3-role signup→profile→dashboard E2E (TESTING — this cycle, infra-permitting)

**Chosen approach (testing agent).** Stand up seeded, credentialed CI test accounts (one per role:
student / teacher / parent) against the ephemeral/staging Supabase project the migration baseline
already produces, then convert the conditional `if (isOnOnboarding)` E2E assertions to unconditional
ones that drive each role from signup through profile creation to its dashboard. Keep the mocked
`page.route` specs as fast smoke tests.

**Rationale / alternatives.** Removing the `if` guards without seeded accounts would make the suite
flaky/always-skip (symptom fix). The cause is CI fixture provisioning. Risk: CI-only. Rollback: revert
fixtures/specs. Effort is the largest in the cycle (M, ~2–3 days) and may slip to a follow-up if CI
seed plumbing is not ready — it does not block AO-4/AO-1/AO-8.

---

### AO-8 — Auth form a11y: placeholder-as-label inputs + incomplete tab ARIA (FRONTEND — this cycle)

**Chosen approach (frontend agent).** Add a visible or `sr-only` `<label htmlFor>` per email / password
/ name input on `AuthScreen.tsx`; add `aria-controls` + roving-tabindex arrow-key navigation to the
role `tablist` (or downgrade the tabs to a labelled `radiogroup`). Preserve the existing correct ARIA
(`role="alert"`/`role="status"` messages, `aria-pressed` chips, password show/hide `aria-label`).

**Rationale / alternatives.** Adding one `aria-label` at a time chases instances; applying an a11y
checklist (labels, keyboard tab nav, focus management) fixes the pattern structurally. Risk: low,
visual/markup only on the acquisition screen — frontend + quality (UX audit) confirm no layout
regression and bilingual labels (P7). Rollback: revert component edits.

---

## Deferred / GATED (NOT in Cycle 1)

### AO-3 — `institution_admin` unsupported by failsafe layers 2 & 3 — GATED
**Why deferred.** The durable fix unifies B2B school-admin provisioning into the shared bootstrap
authority (either fold school-row creation into the SECURITY DEFINER RPC, or route
`institution_admin` through `bootstrapSchoolAdminProfile` in every failsafe layer). That is an
**RBAC / B2B role-provisioning policy change requiring user approval and architect ownership**
(school-provisioning policy, `schools`/`school_admins` creation semantics). It is NOT auto-fix safe.
**Partial mitigation already shipped by AO-4:** an `institution_admin` that reaches
`bootstrap_user_profile` hits the invalid-role `ELSE` → `status:'error'`, which AO-4 now correctly
surfaces as a 500 instead of a false success — so the silent-success symptom is closed even though the
provisioning gap itself remains for the gated cycle.

### AO-5 — Student grade written as "Grade 9" vs canonical "9" (P5 drift) — GATED
**Why deferred.** The fix writes the bare normalized grade from `/onboarding`, but `students.grade`
representation is a **P5 invariant under assessment ownership**; changing the written form requires an
assessment/P5 sign-off plus a grep audit of every `students.grade` reader to confirm none depends on
the prefixed form. Touches a product invariant → not auto-fix safe this cycle.

### AO-6 / AO-7 / AO-9 — low-severity convergence items
AO-6 (parent phone dropped) and AO-7 (`.single()` log noise) are frontend/backend one-liners that may
ride a later cycle; they are auto-fix safe but out of Cycle 1's chosen scope. AO-9 (signup_complete
over-count) is resolved transitively by AO-4 at the API boundary; the dedicated client-side analytics
gate is a frontend follow-up.

---

## Cycle 1 migration / rollback summary

| Item | Layer | Artifact | Rollback |
|---|---|---|---|
| AO-4 | backend | `src/app/api/auth/bootstrap/route.ts` (app code only) | `git revert` |
| AO-1 | testing | new unit/Deno test + catalog entry | revert test files |
| AO-2 | testing | CI seed fixtures + E2E assertions | revert fixtures/specs |
| AO-8 | frontend | `AuthScreen.tsx` markup/ARIA | revert component edits |

No schema migration is introduced in Cycle 1. Every change is pure app/test code, reversible by git.
