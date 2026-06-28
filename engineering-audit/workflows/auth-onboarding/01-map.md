# Auth & Onboarding — Reverse-Engineered End-to-End Map

Workflow owner invariant: **P15 (Onboarding Integrity)**. This document maps the funnel
exactly as code executes it, for all four signup roles (student, teacher, parent,
institution_admin), plus the three P15 failsafe layers and the PKCE vs token_hash branches.

All citations are `file:line` against the live tree at audit time.

---

## 0. Component inventory

| Layer | File | Role |
|---|---|---|
| Signup/login UI | `src/components/auth/AuthScreen.tsx` (597 lines) | Single screen for all 4 roles + login/forgot/check-email modes |
| Login page wrapper | `src/app/login/page.tsx` | Mounts AuthScreen, handles `?role`/`?redirect`/`?error`/`?code` params + post-login redirect |
| Email link landing (PKCE) | `src/app/auth/callback/route.ts` (328 lines) | `exchangeCodeForSession` + profile bootstrap + session registration |
| Email link landing (OTP) | `src/app/auth/confirm/route.ts` (361 lines) | `verifyOtp` for `token_hash` AND legacy `token`+`email` flows |
| Profile bootstrap API | `src/app/api/auth/bootstrap/route.ts` (426 lines) | Server fallback (failsafe layer 2): validates + calls RPC via admin client |
| Onboarding status API | `src/app/api/auth/onboarding-status/route.ts` | Read-only identity resolution |
| Admin repair API | `src/app/api/auth/repair/route.ts` | RBAC-gated `admin_repair_user_onboarding` |
| Device session API | `src/app/api/auth/session/route.ts` | 2-device session register/list/revoke |
| Runtime auth state | `src/lib/AuthContext.tsx` (811 lines) | `fetchUser()` = failsafe layer 3 (client→server bootstrap) |
| Identity helpers | `src/lib/identity/constants.ts`, `onboarding.ts`, `bootstrap-profile.ts`, `school-admin-bootstrap.ts`, `guardian-invite.ts`, `audit.ts` | Pure derivation, role/route constants, school-admin + guardian-invite side effects |
| Email hook | `supabase/functions/send-auth-email/index.ts` (354 lines) | Supabase Send-Email hook → Mailgun branded templates |
| Link builder | `supabase/functions/_shared/auth-email-links.ts` | Routes both token shapes to `/auth/confirm` (token) or `/auth/callback` (PKCE) |
| Bootstrap RPC | `supabase/migrations/20260610090100_bootstrap_link_code.sql` (current def); baseline copy at `supabase/migrations/00000000000000_baseline_from_prod.sql:1457` | `bootstrap_user_profile()` SECURITY DEFINER, idempotent |
| Student grade/board step | `src/app/onboarding/page.tsx` | Post-signup student grade/board/goal capture |

---

## 1. SIGNUP — shared front-of-funnel (all roles)

Screen: `AuthScreen.tsx`, mode `'signup'`. Role chosen via tab (`roleTab`), default from
`?role=` (`login/page.tsx:25-29`).

1. User fills role-specific fields. Client-side validation in `handleSignup`
   (`AuthScreen.tsx:143-167`):
   - name non-empty (`:145`)
   - `validatePassword(password)` (`:146`, from `@/lib/sanitize`)
   - teacher: school name + ≥1 subject + ≥1 grade (`:149-153`)
   - institution_admin: school name + city + state (`:155-159`)
   - student minor (10–12): parent email valid + consent checkbox (`:161-165`)
   - DPDPA data-processing consent mandatory (`:167`)
2. Metadata assembled into `metaData` (`:171-205`):
   - common: `name`, `role`, `consent_data`, `consent_analytics`
   - student: `grade`, `board`; if minor → `is_minor`, `parent_consent_email`
   - teacher: `school_name`, `subjects_taught` (JSON.stringify), `grades_taught` (JSON.stringify)
   - institution_admin: `school_name`, `city`, `state`, `board`, optional `principal_name`, `phone`
   - parent: `link_code` only **if provided** (`:203-205`) — **note: `phone` is NOT persisted** (see GAP AO-6)
3. `supabase.auth.signUp({ email, password, options:{ data: metaData, emailRedirectTo: \`${origin}/auth/callback?type=signup\` } })` (`:207-214`).
4. Branch on whether Supabase returned a session (`:222`):
   - **session present** (email confirmation disabled): fire-and-forget welcome email to
     `send-welcome-email` with Bearer token (`:229-235`), then `onSuccess()` → AuthContext
     failsafe layer 3 creates the profile.
   - **no session** (email confirmation required — production default): persist
     `alfanumrik_pending_email` to sessionStorage (`:241`), switch to `check-email` mode (`:243-247`).

Supabase fires its **Send Email hook** → `send-auth-email`:
- Always returns HTTP 200 on every code path (`send-auth-email/index.ts:206,211,238,247,254,298,343,350`) — P15 rule 1 satisfied.
- Webhook signature verified via `standardwebhooks` before send (`:243-244`); fail-open-to-200-but-no-send on missing/invalid secret.
- Link target built by `buildAuthActionUrl` using `SITE_URL` env (`:38,263,268`) — never hardcoded (P15 rule 6 satisfied). `token_hash` → `/auth/confirm`; legacy `token` → `/auth/confirm?token&email`; PKCE handled by Supabase redirect to `emailRedirectTo` (`/auth/callback`).

`check-email` mode UI (`:414-426`): branded copy + "Resend Email" button. Resend recovers the
target email from React state OR sessionStorage if state was lost on refresh (`:269-276`) — P15 resilience.

---

## 2. EMAIL VERIFICATION — two branches

Supabase email links land on ONE of two routes depending on flow type.

### 2a. PKCE branch — `/auth/callback?code=...&type=signup`
`auth/callback/route.ts:GET` (`:102`):
1. Read `code`, `next` (default `/dashboard`), `type` (`:104-112`).
2. No code → redirect `/login` (`:327`).
3. `exchangeCodeForSession(code)` (`:116`). On error → `/login?error=auth_callback_failed` (`:322-323`).
4. `type==='recovery'` → push session tokens into URL hash → redirect `/auth/reset#...` so the
   browser client (localStorage) picks up the session (`:120-135`).
5. `type==='signup'` (`:137`):
   - `getUser()` (`:147`), derive params via `profileParamsFromMetadata(user)` (`:155`, canonical, P5-normalized).
   - Probe all 4 profile tables (`students/teachers/guardians/school_admins`) (`:161-164`).
   - If no profile:
     - `institution_admin` → `bootstrapSchoolAdminProfile(...)` (`:174-186`) — creates `schools` + `school_admins` rows; `sync_school_admin_role` trigger assigns RBAC role.
     - else → admin-client `rpc('bootstrap_user_profile', {...all params...})` (`:192-204`); re-query teacher/guardian to confirm `redirectRole` (`:211-214`).
     - bootstrap error is caught, logged, non-fatal (`:216-219`) — funnel never 500s.
   - If profile exists → detect role from existing rows (`:222-226`).
   - Fire-and-forget welcome email (`:229-245`).
   - Redirect to `getRoleDestination(redirectRole)` + register device session (`:252-256`).
6. Default (non-signup/non-recovery) → validated `next` with allow-listed Vercel host, register session (`:270-318`).

### 2b. OTP/token_hash branch — `/auth/confirm`
`auth/confirm/route.ts:GET` (`:97`). Handles THREE shapes:
- `token_hash` + `type` (`:121`) → `verifyOtp({token_hash, type})` (`:123`)
- legacy `token` + `email` + `type` (`:240`) → `verifyOtp({token, email, type})` (`:242`)
- neither → redirect `/login` (`:360`)

`next` normalized: absolute URLs reduced to path (`:106-114`), then `validateRedirectTarget`
(`:119`). For both verified branches the `recovery` / `signup` / default handling is identical to
the callback route (recovery→hash→`/auth/reset`; signup→same bootstrap incl. school-admin branch
`:167-206` and `:286-325`; default→register session). Verification failure →
`/login?error=verification_failed` (`:237,356`).

P15 rule 3 satisfied: BOTH PKCE and token_hash (and legacy token) flows are handled, and both
run identical profile-bootstrap logic.

---

## 3. PROFILE BOOTSTRAP — the 3-layer P15 failsafe

The same `bootstrap_user_profile` RPC is the convergence point of all three layers.

### Layer 1 — server-side at email confirmation
The callback/confirm routes (Section 2) call the RPC (or `bootstrapSchoolAdminProfile`)
directly with the admin client. This is the primary path for the production
email-verification flow.

### Layer 2 — `POST /api/auth/bootstrap`
`api/auth/bootstrap/route.ts`:
1. `resolveAuthUser(request)` — cookie session first, then `Authorization: Bearer` fallback
   (`:63-87`). Bearer fallback (M3) is essential: `signInWithPassword` stores the session in
   localStorage, not cookies, so the cookie-only path 401'd the majority login path.
2. Dedup: in-memory map (`:103-106`) + distributed Redis idempotency lock 30s TTL (`:111-115`).
3. `handleBootstrap` (`:137`): parse body, validate role/name/grade/board/subjects against the
   active `subjects` master table (`:157-321`).
4. `admin.rpc('bootstrap_user_profile', {...})` (`:326-349`); `normalizeGrade` for students
   (P5) (`:333).
5. On `rpcError` → audit `bootstrap_failure`, HTTP 500 (`:351-369`).
6. Minor parental-consent auto-invite: if `is_minor` + `parent_consent_email`, fire-and-forget
   `enqueueGuardianInvite` (`:388-405`) — never blocks signup.
7. Return `{ success, data:{ status, profile_id, role, redirect } }` (`:410-418`).

### Layer 3 — AuthContext runtime fallback
`AuthContext.tsx:fetchUser` (`:252`):
1. Resolve session via `getSession()` raced against 4s timeout (`:282-285`); whole fn under a
   12s hard timeout that fails open to logged-out (`:256-271`).
2. `get_user_role` RPC with 5s abort (`:307-317`); on success load student/teacher/guardian
   profiles (`:344-374`).
3. Fallback if RPC unresolved: parallel probe of all 4 profile tables (`:391-421`).
4. If **no profile** and bootstrap not yet attempted (`:447`): POST `/api/auth/bootstrap` with
   metadata-derived payload + Bearer token (`:454-509`); on success re-run `fetchUser` once
   (`:525-526`); on failure set role from metadata so UI shows something (`:534-541`).
5. `isLoggedIn` = `roles.length > 0` (`:795`) — a profile-less auth user is NOT "logged in",
   which forces protected routes back to login (B7).

P15 rule 2 satisfied: all three layers present and converge on the idempotent RPC.

### The RPC — `bootstrap_user_profile` (`20260610090100_bootstrap_link_code.sql:106`)
- `SECURITY DEFINER`, `SET search_path = public, auth, pg_catalog`, justified in header (`:94-98`).
- Idempotent: early-return on `onboarding_state.step='completed'` (`:140-179`); every profile
  INSERT uses `ON CONFLICT ON CONSTRAINT ..._auth_user_id_unique DO UPDATE` (`:198,208,215`).
- Inner `BEGIN ... EXCEPTION WHEN OTHERS` wraps profile insert; on error sets onboarding
  `step='failed'` and **returns** `{status:'error', error: SQLERRM}` without raising (`:228-235`).
- Handles `student | teacher | parent`. **`institution_admin` falls into the ELSE → returns
  `{status:'error', error:'Invalid role'}`** (`:219-226`) — see GAP AO-3.
- Parent `link_code` wiring (M5): resolves student + calls `link_guardian_via_invite_code`,
  fail-soft, DPDP `view`-downgrade for newly created links (`:241-277`). P15 rule 4 (idempotent
  ON CONFLICT) satisfied.
- Publishes `learner.signed_up` state event for students, ON CONFLICT idempotent (`:290-314`).
- Returns additive `link_status` key on all paths (`:177,224,233,316`).

---

## 4. POST-PROFILE ROUTING per role

`getRoleDestination` (`constants.ts:64`) → `ROLE_DESTINATIONS` (`:47-52`):
`student→/dashboard`, `teacher→/teacher`, `parent→/parent`, `institution_admin→/school-admin`.

### Student
Lands on `/dashboard`. The student-specific `/onboarding` page (`onboarding/page.tsx`) is shown
when `student.onboarding_completed` is false (`:60-65`):
- Pre-fills grade (strips `"Grade "` prefix) + board (`:67-71`).
- Non-student roles short-circuit to `/teacher` or `/parent` (`:51-58,78-97`).
- Submit: direct client `update` of `students` row with `grade: \`Grade ${grade}\``, board,
  academic_goal, `onboarding_completed=true` (`:109-117`) — **stores "Grade 9" not "9"** (GAP AO-5).
- Grades 6–10 → `/diagnostic?ref=onboarding`; 11–12 → `/dashboard` (`:142-147`).

### Teacher
Lands on `/teacher`. Subjects/grades persisted through metadata → RPC (`profileParamsFromMetadata`
parses the JSON-stringified arrays, `bootstrap-profile.ts:97-119,143-155`). Teacher profile
completion happens in-portal.

### Parent
Lands on `/parent`. If a `link_code` was supplied at signup, the RPC links the guardian to the
student (Section 3 RPC). School invite-code (B2B) redemption handled separately by AuthContext
`redeemPendingInvite` once roles resolve (`AuthContext.tsx:625-654`).

### Institution admin
Lands on `/school-admin`. Profile created ONLY via `bootstrapSchoolAdminProfile` in the
callback/confirm routes (`school-admin-bootstrap.ts:49-92`). NOT creatable via the RPC (GAP AO-3).

---

## 5. LOGIN (returning user)

`AuthScreen.handleLogin` (`:121-141`):
1. Defensive local `signOut({scope:'local'})` to purge stale tokens (`:133-135`).
2. `signInWithPassword({email, password})` (`:137`); on error surface message (`:138`).
3. `onSuccess()` → `login/page.tsx:handleSuccess` (`:56-66`): `router.refresh()` then
   role-aware redirect with open-redirect guard `validateRedirectTarget` (`:61-65`).
4. AuthContext `onAuthStateChange('SIGNED_IN')` (`:731`): set loading, reset bootstrap guard,
   POST `/api/auth/session` with Bearer, re-run `fetchUser` (`:757-771`).

Already-logged-in users hitting `/login` are redirected by effect (`login/page.tsx:37-52`) unless
`?switch=true`.

---

## 6. PASSWORD RESET

1. `handleForgot` (`AuthScreen.tsx:253-265`): `resetPasswordForEmail(email, {redirectTo:
   \`${origin}/auth/callback?type=recovery\`})`.
2. `send-auth-email` recovery template (`:150-165,282-283`).
3. Email link → callback or confirm `type=recovery` → session tokens pushed via URL hash →
   `/auth/reset#access_token=...` (`callback:120-135`, `confirm:126-141,245-260`).
4. `/auth/reset` page (client) consumes the hash session and sets the new password.

---

## 7. SESSION MANAGEMENT (2-device)

`api/auth/session/route.ts`: POST registers a session, revoking oldest beyond `MAX_SESSIONS=2`
(`:120-151`); returns **200 `no_session_yet`** rather than 401 when no user resolves (`:86-91`)
to avoid console noise (P15-adjacent UX). Callback/confirm routes also register sessions on the
redirect response, fail-open (`callback:48-100`, `confirm:43-95`). DELETE always returns 200
(`:217-248`).

---

## 8. Loading / empty / error states

| State | Where | Behavior |
|---|---|---|
| Auth resolving | `AuthContext` `isLoading` until `fetchUser` completes | `/onboarding` shows `<LoadingFoxy/>` (`onboarding/page.tsx:75,99,101`) |
| Auth hard-stall | `fetchUser` 12s timeout (`:256-271`) | Fails open to logged-out → protected route → `/login` |
| Login error | `AuthScreen` `error` state, `role="alert"` (`:402-406`) | Inline bilingual message |
| Callback error | `?error=auth_callback_failed` | `login/page.tsx:74-89` bilingual banner |
| Confirm error | `?error=verification_failed` | same banner |
| Bootstrap fail (layer 2) | HTTP 500 (`bootstrap:361-369`) | AuthContext sets metadata role, retries next load |
| No-code/no-token | callback `:327`, confirm `:360` | redirect `/login` |

---

## 9. Known edge cases handled in code

- Stale localStorage tokens on login → defensive local signout (`AuthScreen:133-135`).
- Lost pending-email on refresh → sessionStorage recovery (`AuthScreen:269-276`).
- Password-login users without auth cookies → Bearer fallback in bootstrap + session routes
  (`bootstrap:63-87`, `session:48-70`).
- Teacher subjects/grades dropped on confirm route (R2 fix) → canonical
  `profileParamsFromMetadata` (`bootstrap-profile.ts`).
- School-admin token_hash confirmations landing without profile (R2 fix) → shared
  `bootstrapSchoolAdminProfile` now in both routes.
- Parent link_code never wired (M5 fix) → RPC now links guardian↔student.
- Open-redirect via `next` → `validateRedirectTarget` + Vercel host allow-list.
- Role-spoofing via localStorage → server-verified roles gate `setActiveRole` (`AuthContext:238-250,326-339`).
