# Auth & Onboarding — Gap Analysis

Audit scope: P15 (Onboarding Integrity) workflow. Evidence is `file:line` against the live tree.
Each gap follows: Title | Evidence | Business impact | Technical impact | Severity | Likelihood |
Recommendation | Est. effort.

This is an audit, not a fault-hunt. **Section A records what is already compliant.** The gaps in
Section B are mostly hardening + test-coverage items; none is an active production outage.

---

## A. What is already CORRECT / COMPLIANT (verified, not assumed)

- **P15.1 — send-auth-email returns 200 on ALL paths.** Verified: non-POST (`send-auth-email/index.ts:211`),
  missing secret (`:238`), bad signature (`:247`), invalid payload (`:254`), no Mailgun config (`:298`),
  send success/fail (`:343`), top-level throw (`:350`), OPTIONS (`:206`). The code is fully compliant.
  (Its TEST coverage is the gap — see AO-1.)
- **P15.3 — both PKCE and token_hash handled.** `/auth/callback` does `exchangeCodeForSession`
  (`callback:116`); `/auth/confirm` does `verifyOtp` for both `token_hash` (`confirm:123`) and legacy
  `token`+`email` (`confirm:242`). Both run identical signup-bootstrap + recovery logic.
- **P15.4 — RPC idempotent.** `step='completed'` early return (`20260610090100:140`), all profile
  inserts `ON CONFLICT ... DO UPDATE` (`:198,208,215`), `learner.signed_up` ON CONFLICT (`:313`),
  link RPC ON CONFLICT. Redis + in-memory dedup in front (`bootstrap:103-115`).
- **P15.6 — SITE_URL from env, never hardcoded.** `SITE_URL = Deno.env.get('SITE_URL') || 'https://alfanumrik.com'`
  (`send-auth-email/index.ts:38`); used for action URLs and footer links. Server routes build redirects
  from request `origin` / allow-listed Vercel host, not literals.
- **Open-redirect defense.** `validateRedirectTarget` (`constants.ts:175-187`) + Vercel host allow-list
  (`callback:287-298`); covered by unit + E2E tests.
- **Service-role isolation (P8).** `getSupabaseAdmin` only imported in server route handlers and
  `school-admin-bootstrap.ts` (which carries a SERVER-ONLY banner and is intentionally not re-exported
  from the identity barrel, `:11-13`). No `SUPABASE_SERVICE_ROLE_KEY` in any `NEXT_PUBLIC_*`.
- **RBAC on repair route.** `authorizeRequest(request,'user.manage')` before any work (`repair:21-22`),
  UUID + role validation (`:47-64`). P9 satisfied.
- **PII discipline (P13).** send-auth-email logs only redacted email (`:324,338`); bootstrap passes
  parent email straight to invite helper without logging (`bootstrap:386-387`).

---

## B. Gaps

### AO-1 — send-auth-email "always-200" invariant has NO executable test
- **Evidence:** E2E placeholder asserts `expect(true).toBe(true)` and points to a unit group
  "`send_auth_email_always_200` test group in `src/__tests__/auth-onboarding.test.ts`"
  (`e2e/auth-onboarding-p15.spec.ts:13,83-98`). That group **does not exist** — the only describe
  blocks in `auth-onboarding.test.ts` are identity-constant / bootstrap-validation / callback-integration
  (`auth-onboarding.test.ts:47,69,93,107,135,165,283,474,497,538,725,950`). No test imports or exercises
  `send-auth-email`.
- **Business impact:** P15 rule 1 is the single highest-leverage signup invariant — a regression that
  returns non-200 silently blocks ALL signups in Supabase Auth. There is no guard against that regression.
- **Technical impact:** A future edit to `send-auth-email` that throws before the `status:200` return, or
  changes a status code, ships undetected. The catalog claims coverage that does not exist (false green).
- **Severity:** High · **Likelihood:** Medium
- **Recommendation:** Add a Deno/unit test (or a Node harness that imports the handler logic) asserting
  200 on the six documented paths. Until Deno test infra lands, extract the response-shaping into a
  pure helper and unit-test it. Replace the `expect(true).toBe(true)` marker with a real assertion or a
  `test.fixme` carrying a tracking ID so the catalog stops over-reporting.
- **Est. effort:** 0.5 day (S)

### AO-2 — No real 3-role signup→profile→dashboard E2E (the known coverage gap)
- **Evidence:** `e2e/auth-onboarding-p15.spec.ts` mocks Supabase via `page.route` and gates every
  positive assertion behind `if (isOnOnboarding)` / `if (url.includes('/teacher'))` (`:157-165,229-231,298-300`).
  Without a real seeded session in CI the meaningful positive assertions never execute — only the
  negative guards ("never redirect to the wrong portal") run. There is no test that drives a real
  student/teacher/parent from signup through profile creation to their dashboard. `.claude/CLAUDE.md`
  P15 status confirms: "3-role E2E gap remains".
- **Business impact:** The #1 acquisition funnel has no end-to-end positive verification. Bootstrap
  layer regressions (RPC arg drift, role-redirect drift) can pass CI.
- **Technical impact:** Conditional assertions create false confidence; mocked `page.route` cannot
  exercise the real RPC, RLS, triggers, or onboarding_state transitions.
- **Severity:** High · **Likelihood:** Medium
- **Recommendation:** Stand up seeded CI test accounts (one per role) against the ephemeral/staging
  Supabase project the migration baseline already targets, then convert the conditional E2E assertions
  to unconditional ones. Keep the mocked specs as fast smoke tests.
- **Est. effort:** 2–3 days (M) — mostly CI fixture/seed plumbing.

### AO-3 — `institution_admin` is unsupported by failsafe layers 2 & 3 (RPC rejects it)
- **Evidence:** `VALID_ROLES` includes `institution_admin` (`constants.ts:29`) and `isValidRole`
  accepts it (`:144-146`), so `/api/auth/bootstrap` passes validation and calls the RPC with
  `p_role='institution_admin'` (`bootstrap:157-166,326-349`). But `bootstrap_user_profile` only handles
  student/teacher/parent; `institution_admin` hits the ELSE → returns `{status:'error', error:'Invalid role'}`
  WITHOUT raising (`20260610090100:219-226`). The route checks only `rpcError` (the PG-level error),
  not `result.status` (see AO-4), so it returns `success:true` + `redirect:/school-admin` while NO
  profile was created. AuthContext layer 3 builds its payload only for student/teacher/parent and would
  hit the same dead end. School-admin profiles are created ONLY by `bootstrapSchoolAdminProfile` in the
  callback/confirm routes (`school-admin-bootstrap.ts:49-92`).
- **Business impact:** If a school-admin signup ever takes the no-email-verification path, or the
  callback school-admin branch fails and AuthContext retries, the B2B admin lands on `/school-admin`
  with no `schools`/`school_admins` rows and a broken portal — and the API reports success.
- **Technical impact:** The "3-layer failsafe" guarantee holds for 3 of 4 roles; the 4th relies on a
  single layer. Silent `status:error` masks it.
- **Severity:** Medium · **Likelihood:** Low (production uses email verification, so layer 1 usually wins)
- **Recommendation:** Either (a) route `institution_admin` in `/api/auth/bootstrap` and AuthContext
  to `bootstrapSchoolAdminProfile`, or (b) extend the RPC to handle institution_admin. Pair with AO-4.
  **Touches RBAC/role provisioning → requires architect + user awareness** (school provisioning policy).
- **Est. effort:** 1 day (M)

### AO-4 — `/api/auth/bootstrap` ignores RPC logical-failure status
- **Evidence:** Route branches only on `rpcError` (`bootstrap:351`). The RPC's EXCEPTION branch and
  invalid-role branch RETURN `{status:'error', ...}` with no PG error raised
  (`20260610090100:224,233`). So a DB-level insert failure (caught by `WHEN OTHERS`) yields HTTP 200
  `success:true` with `profile_id` undefined (`bootstrap:410-418`).
- **Business impact:** Caller (AuthContext / redirect) treats a failed bootstrap as success; the user
  is redirected without a profile. Self-heals on next load (layer 3 retry), but the success signal and
  analytics `signup_complete` (`AuthContext:520`) fire prematurely.
- **Technical impact:** Inflated signup-complete metrics; harder incident diagnosis; masks AO-3.
- **Severity:** Medium · **Likelihood:** Low
- **Recommendation:** After the RPC call, treat `result?.status === 'error'` (or missing `profile_id`)
  as a failure: audit + HTTP 500 + do NOT emit success. Auto-fix safe (no schema change).
- **Est. effort:** 0.25 day (S)

### AO-5 — Student grade written as "Grade 9" (P5 representation drift)
- **Evidence:** `/onboarding` submit writes `grade: \`Grade ${grade}\`` directly to `students`
  (`onboarding/page.tsx:110`), then reads it back by stripping the prefix (`:67`). The RPC and
  bootstrap path store bare `'9'` (`20260610090100:196`, `bootstrap:333` via `normalizeGrade`). The DB
  carries a `normalize_grade` SQL function that strips `"Grade "`, confirming two representations
  coexist.
- **Business impact:** Low directly, but P5 ("grades are bare strings '6'..'12'") is a hard invariant;
  mixed representation invites downstream off-by-prefix bugs in any code that reads `students.grade`
  without normalizing.
- **Technical impact:** Every consumer must remember to normalize. The client update also bypasses the
  server-authoritative path (writes directly via RLS-scoped client).
- **Severity:** Low · **Likelihood:** Medium (latent)
- **Recommendation:** Write the bare normalized grade (`grade` not `\`Grade ${grade}\``) and rely on
  `normalize_grade` for any legacy rows. Confirm no reader depends on the prefixed form. Coordinate with
  assessment (owns P5). Auto-fix safe after a grep audit of `students.grade` readers.
- **Est. effort:** 0.5 day (S)

### AO-6 — Parent phone collected at signup is silently dropped
- **Evidence:** Parent form collects `phone` (`AuthScreen.tsx:511`) but `handleSignup` persists only
  `link_code` into metadata for the parent role (`:203-205`); `phone` is never added to `metaData`,
  never in `welcomePayload` (`:226`), and the RPC's `p_phone` therefore arrives null on the
  email-verification path. (institution_admin phone IS persisted at `:194` — the inconsistency is
  parent-only.)
- **Business impact:** Parent contact number — useful for WhatsApp notifications / support — is lost at
  signup; parents must re-enter it later (many won't). Quiet data loss in a B2C contact field.
- **Technical impact:** Field present in UI + RPC signature but unwired end-to-end.
- **Severity:** Low · **Likelihood:** High (every parent signup with a phone)
- **Recommendation:** Add `if (phone.trim()) metaData.phone = phone.trim();` in the parent branch.
  Auto-fix safe.
- **Est. effort:** 0.1 day (S)

### AO-7 — `resolveIdentity` uses `.single()` (noisy errors) instead of `.maybeSingle()`
- **Evidence:** All four profile/onboarding lookups use `.single()` (`onboarding.ts:78,83,88,95`),
  which returns a PGRST116 error for the common "no row" case. AuthContext's own fallback correctly
  uses `.maybeSingle()` (`AuthContext.tsx:401,406,411,420`).
- **Business impact:** None functionally (errors are swallowed via `.data` null checks), but it pollutes
  server logs / Sentry breadcrumbs with expected "no rows" errors, raising noise on the critical path.
- **Technical impact:** Harder signal-to-noise during onboarding incidents.
- **Severity:** Low · **Likelihood:** High
- **Recommendation:** Switch to `.maybeSingle()` in `resolveIdentity`. Auto-fix safe.
- **Est. effort:** 0.1 day (S)

### AO-8 — Auth form inputs use placeholder-as-label; role tabs lack full ARIA tab semantics
- **Evidence:** Email/password/name inputs rely on `placeholder` + `aria-label` with no visible
  `<label>` (`AuthScreen.tsx:430,434,439`). The `aria-label`s ARE present (so screen-reader name is
  covered), but there is no visible persistent label, and placeholders disappear on input. Role tabs are
  `<button role="tab">` inside `role="tablist"` (`:372-392`) without `aria-controls`/`tabpanel`
  association or roving-tabindex arrow-key navigation. Positive: `role="alert"`/`role="status"` on
  messages (`:403,408`), `aria-pressed` on chips (`:489,499`), password show/hide `aria-label` (`:440`).
- **Business impact:** Reduced accessibility for low-vision / screen-magnifier / keyboard users on the
  primary acquisition screen; minor WCAG 2.1 (1.3.1 / 4.1.2) gaps. India market includes many
  low-end-device / assistive-tech users.
- **Technical impact:** None functional.
- **Severity:** Low · **Likelihood:** Medium
- **Recommendation:** Add visible/`sr-only` `<label htmlFor>` per input; add `aria-controls` + arrow-key
  roving tabindex to the role tablist (or downgrade tabs to a labeled `radiogroup`). Auto-fix safe;
  coordinate with frontend + quality (UX audit).
- **Est. effort:** 0.5 day (S)

### AO-9 — `signup_complete` analytics fires on bootstrap 2xx regardless of true outcome
- **Evidence:** AuthContext emits `track('signup_complete', ...)` whenever `res.ok` (`AuthContext.tsx:510-521`).
  Because of AO-4, `res.ok` can be true even when the RPC logically failed. Compounding: this is the
  same metric the CEO dashboard reads for activation.
- **Business impact:** Over-counts completed signups; misleads activation/funnel decisions.
- **Technical impact:** Coupled to AO-4; fixing AO-4 largely resolves this.
- **Severity:** Low · **Likelihood:** Low
- **Recommendation:** Gate the event on a verified profile (`result.status==='success' && profile_id`),
  resolved automatically once AO-4 lands. Auto-fix safe.
- **Est. effort:** included in AO-4

---

## C. Severity roll-up

| ID | Title | Severity | Auto-fix safe? |
|---|---|---|---|
| AO-1 | send-auth-email always-200 untested | High | Yes (test-only) |
| AO-2 | No real 3-role signup E2E | High | Yes (test/CI-only) |
| AO-3 | institution_admin unsupported in failsafe layers 2/3 | Medium | **No — architect + user (school provisioning)** |
| AO-4 | bootstrap ignores RPC status:error | Medium | Yes |
| AO-5 | "Grade 9" P5 representation drift | Low | Yes (after reader grep; assessment owns P5) |
| AO-6 | Parent phone dropped at signup | Low | Yes |
| AO-7 | resolveIdentity .single() noise | Low | Yes |
| AO-8 | Auth form a11y (labels + tab ARIA) | Low | Yes |
| AO-9 | signup_complete over-counts | Low | Yes (folds into AO-4) |
