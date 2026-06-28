# Auth & Onboarding — Root-Cause Analysis

For each significant gap from `02-gap-analysis.md`, the TRUE root cause and the layer that
introduced it. The aim is to fix causes, not symptoms. Layer key:
architecture | frontend | backend | db | infra | process.

---

## AO-1 — send-auth-email always-200 invariant untested
- **Symptom:** No executable test asserts the 200-on-all-paths contract; an E2E placeholder
  (`expect(true).toBe(true)`) points to a unit group that was never written.
- **Root cause (layer: infra + process):** The Edge Function runs on **Deno**, and the test stack
  (Vitest/Node + Playwright/Next dev server) has **no Deno test harness and no HTTP surface** to reach
  the function. Faced with that infra gap, the team substituted a documentation placeholder and recorded
  it in the regression catalog AS IF it were coverage — a process failure (catalog records intent, not
  verified behavior). The function code is correct; only the verification path is missing.
- **Why not a symptom fix:** Re-asserting `true` or copying the comment elsewhere changes nothing. The
  durable fix is to (a) make the function's response-shaping logic testable from Node by extracting it
  into a pure module the unit layer can import, or (b) add a Deno test job to CI. Either removes the
  infra blocker that forced the placeholder.

## AO-2 — No real 3-role signup→dashboard E2E
- **Symptom:** E2E assertions are conditional and mock Supabase via `page.route`, so the real funnel is
  never exercised end-to-end in CI.
- **Root cause (layer: infra/process):** There is **no seeded, credentialed test account per role in
  CI** against a real Supabase project. Because Playwright cannot authenticate, every spec was written
  defensively with `if (sessionResolved) { assert }`. The missing test fixture is the cause; the
  conditional assertions are the adaptation to it. This is the same class as AO-1 — a test-environment
  provisioning gap, not an application bug.
- **Why not a symptom fix:** Removing the `if` guards without seeded accounts would make the suite flaky
  or always-skip. The cause to fix is CI fixture provisioning (the migration baseline already produces a
  reproducible schema for ephemeral projects — that substrate is the seam to seed against).

## AO-3 — institution_admin unsupported by failsafe layers 2 & 3
- **Symptom:** `/api/auth/bootstrap` + AuthContext can route an institution_admin into
  `bootstrap_user_profile`, which rejects the role, yet no profile is created.
- **Root cause (layer: architecture):** `institution_admin` was added to the role MODEL
  (`VALID_ROLES`, `ROLE_DESTINATIONS`, `isValidRole`) and given a **separate, parallel provisioning
  path** (`bootstrapSchoolAdminProfile`, which must create a `schools` row first) that lives ONLY in the
  callback/confirm routes. The shared RPC was never extended to know about it. So the role taxonomy and
  the bootstrap mechanism **diverged**: three roles flow through one idempotent RPC, the fourth flows
  through a route-local helper. The 3-layer P15 failsafe was designed around the RPC, so the fourth role
  inherently has only one layer. This is an architectural completeness gap introduced when the B2B
  school-admin role was bolted onto a B2C-shaped onboarding spine.
- **Why not a symptom fix:** Adding a special-case `if institution_admin` only in the bootstrap route
  patches one layer. The root fix is to make ONE provisioning authority cover all four roles — either
  fold school-admin creation into the RPC (with the schools-row creation inside the SECURITY DEFINER
  body) or have every failsafe layer delegate institution_admin to the shared helper. That restores the
  "all layers cover all roles" invariant the failsafe design assumes.

## AO-4 — Bootstrap route ignores RPC `status:error`
- **Symptom:** Route returns `success:true` even when the RPC's body returned a logical error.
- **Root cause (layer: backend, contract mismatch):** The RPC has a **dual error channel** — it can (a)
  raise (surfaced as `rpcError`) OR (b) return `{status:'error'}` from its `EXCEPTION WHEN OTHERS` /
  invalid-role branches WITHOUT raising. The route was written to the first channel only and never
  reconciled with the second. The cause is an **unspecified/under-enforced function contract**: the
  caller and the function disagree on how failure is signaled. This is the same divergence that makes
  AO-3 silent.
- **Why not a symptom fix:** Mapping just the 'Invalid role' string would be brittle. The durable fix is
  to treat the RPC's documented return shape as the contract — branch on `result.status` /
  `profile_id` presence — so ANY logical failure (present or future) is caught.

## AO-5 — Student grade stored as "Grade 9" (P5 drift)
- **Symptom:** Two representations of grade coexist; `/onboarding` writes the prefixed form.
- **Root cause (layer: frontend + process):** The student `/onboarding` page performs a **direct
  client-side `update` to `students`** (`onboarding/page.tsx:109-117`) instead of going through the
  server-authoritative identity path that uses `normalizeGrade`. That direct write predates the P5
  normalization consolidation (the `normalize_grade` SQL function exists precisely to paper over it).
  The cause is a legacy write path that never adopted the canonical grade contract — a consistency-debt
  item, with the DB function masking it well enough that it was never forced to converge.
- **Why not a symptom fix:** Adding more `.replace('Grade ', '')` readers spreads the workaround. The
  fix is to write the canonical bare string at the source so the masking function becomes unnecessary
  for new rows.

## AO-6 — Parent phone dropped at signup
- **Symptom:** Phone collected in UI, never persisted.
- **Root cause (layer: frontend):** A **plain wiring omission** in `handleSignup`'s parent branch —
  only `link_code` was added to metadata; `phone` was never threaded through, even though the
  downstream RPC parameter (`p_phone`) and institution_admin precedent both exist. No deeper design
  issue; a field added to the form was not connected to the metadata payload.
- **Why not a symptom fix:** There is no symptom-vs-cause distinction here — the one-line wiring IS the
  cause and the fix.

## AO-7 — resolveIdentity `.single()` log noise
- **Symptom:** Expected "no row" cases emit PGRST116 errors.
- **Root cause (layer: backend):** `.single()` was chosen for a query whose **absence-of-row is a
  normal, expected outcome** (a user has at most one of student/teacher/guardian). The correct primitive
  for "0 or 1 row" is `.maybeSingle()`, which AuthContext already uses. Inconsistent primitive choice
  across two code paths that answer the same question.
- **Why not a symptom fix:** Suppressing the logs would hide real errors too. Using the right primitive
  removes the false errors at the source.

## AO-8 — Auth form accessibility gaps
- **Symptom:** Placeholder-as-label inputs; tablist without full ARIA tab semantics/keyboard nav.
- **Root cause (layer: frontend/process):** The screen was built design-first (compact, placeholder-led
  visual style) and `aria-label`s were added reactively, but **no a11y acceptance criterion** was applied
  to the auth surface specifically. Visible labels and roving-tabindex were never in the component's
  definition of done. A process gap (no a11y gate on the critical acquisition screen) rather than a
  knowledge gap — the rest of the file shows the team knows ARIA (`role="alert"`, `aria-pressed`).
- **Why not a symptom fix:** Adding one `aria-label` at a time chases instances. The cause-level fix is
  to apply an a11y checklist to the auth screen (labels, keyboard tab nav, focus management) so the
  pattern is correct structurally.

## AO-9 — signup_complete over-counts
- **Symptom:** Activation metric fires on bootstrap 2xx, which can be a false success.
- **Root cause (layer: backend, transitive):** Directly downstream of AO-4 — the analytics event trusts
  HTTP status as a proxy for "profile created", but that proxy is unreliable because of the RPC
  dual-error-channel contract gap. Not an independent cause; it inherits AO-4's root.
- **Why not a symptom fix:** Fixing AO-4 (branch on real RPC outcome) makes the 2xx signal trustworthy,
  which fixes AO-9 for free. Patching the analytics gate alone would leave the underlying success/failure
  ambiguity in place for every other caller.

---

## Cross-cutting themes

1. **Test-environment provisioning is the dominant root cause of the High-severity gaps (AO-1, AO-2).**
   Neither is an application defect — both stem from missing Deno test infra and missing seeded CI
   accounts. The application code for the funnel is, on inspection, robustly defensive (multi-layer
   timeouts, fail-open, Bearer fallbacks, fail-soft side effects). The risk is regression-detection, not
   current correctness.

2. **A B2C-shaped onboarding spine absorbed a B2B role without unifying provisioning (AO-3, AO-4, AO-9).**
   institution_admin's separate creation path and the RPC's dual error channel are the same underlying
   issue: a single authoritative, uniformly-signaled bootstrap contract was never re-established after
   the role set grew. Fixing the contract (one provisioning authority, one failure signal) collapses
   three gaps.

3. **Legacy direct-write + reactive-ARIA debt (AO-5, AO-6, AO-7, AO-8)** are low-severity consistency
   items where a canonical path exists elsewhere in the same codebase but one site never adopted it.
   These are safe, mechanical convergence fixes.
