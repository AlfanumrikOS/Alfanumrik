## Consumer Minimalism — Wave D parent auth unification (2026-06-06) — REG-86

Source: parent auth unification ("D-authunify", Finding #5 / Exception E2 closure),
flag-gated by `ff_parent_unified_auth_v1` (default OFF —
`FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1] === false`). ONE
file changed: `src/app/parent/page.tsx`. The page's session-resolution effect
(`src/app/parent/page.tsx:991-1034`) gained a flag branch: when ON, the parent
session is resolved SOLELY from the Supabase guardian-JWT (`auth.guardian`) via a
`resolveGuardianFromJwt()` → `get_children` Edge-function call, and the HMAC
`loadParentSession()` sessionStorage fallback is NEVER consulted; when OFF
(default) the existing dual path is unchanged (byte-identical). `parent-session.ts`
(the HMAC store + brute-force-lockout helpers) is untouched and still used on the
flag-OFF path. The real auth boundary is already server-side (the `parent-portal`
Edge Function requires a Bearer JWT on every action; `/api/parent/report` uses
`authorizeRequest`), so the HMAC payload was only ever a client cache.

Two load-bearing safety properties hold this change together (same family as the
REG-78 / REG-79 / REG-83 / REG-84 / REG-85 flag-OFF safety tests):

1. **Flag-OFF parity (byte-identical current product).** With
   `ff_parent_unified_auth_v1` OFF (production truth), the existing dual path
   runs unchanged: `auth.guardian` present → seed the student from the HMAC
   `loadParentSession()`; `auth.guardian` absent → STILL fall back to
   `loadParentSession()` (the link-code session reachable today). A regression
   that defaulted the flag ON, or inverted the branch, would silently change
   how every guardian's session resolves.

2. **Flag-ON JWT-only resolution + no stale-cache revival (P15-adjacent auth
   integrity).** With the flag ON and `auth.guardian` present, the guardian-JWT
   is the SOLE source of truth — the student is seeded from `get_children`
   (Bearer-JWT-gated server-side) and `loadParentSession()` is never called. With
   the flag ON and NO `auth.guardian`, the page renders the unauthenticated
   LoginScreen and must NOT silently revive a stale HMAC sessionStorage cache.

**P15 boundary (NON-NEGOTIABLE):** D-authunify touches ONLY the parent portal's
client-side session-resolution branch. It does NOT touch any onboarding-funnel
file — `send-auth-email`, `auth/callback`, `auth/confirm`, `api/auth/bootstrap`,
`AuthContext`, `onboarding/page`, the `bootstrap_user_profile` RPC, or `SITE_URL`.
Verified by `git diff --name-only`: `src/app/parent/page.tsx` is the only changed
file. The signup→verify→profile→dashboard funnel for all three roles is unaffected
(the existing P15 suites — `auth-onboarding`, `auth-callback-role-redirect`,
`auth-bootstrap`, `identity-onboarding`, `onboarding-*` — stay green).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-86 | `parent_unified_auth_flag_off_parity_and_jwt_only_resolution` | Flag-gated parent session-resolution pin. A faithful replica of the page's resolution effect (`src/app/parent/page.tsx:991-1034`), wired to a mocked `useFeatureFlags()` (the same SWR hook the page reads) and a mocked `useAuth()`, with two spy seams — `loadParentSession` (HMAC sessionStorage) and `getChildren` (the page's `api('get_children', …)` Edge call). Asserts: **(a) Flag-OFF parity:** flag ABSENT (prod truth) or explicitly `false`, guardian present → student seeded from the HMAC `loadParentSession` (`getChildren` NOT called); flag OFF + NO guardian → the link-code HMAC session is reachable (revives guardian + student from sessionStorage). **(b) Flag-ON JWT-only:** flag `true` + `auth.guardian` present → student seeded from `getChildren(guardian.id)`, the HMAC `loadParentSession` is NEVER consulted (proven even with a stale HMAC cache present); JWT guardian with NO linked children → unauthenticated LoginScreen, still no HMAC read. **(c) Flag-ON no-guardian (no stale revival):** flag `true` + NO `auth.guardian` → renders the unauthenticated LoginScreen and NEVER calls `loadParentSession` even when a stale HMAC session exists (no silent revive); stays in the checking state while `auth.isLoading` (no resolution attempted). A standalone assertion pins `FLAG_DEFAULTS[PARENT_UNIFIED_AUTH_V1] === false` against a default-flip regression. | `src/__tests__/components/parent/parent-unified-auth.test.tsx` (8 tests: 1 default-flip + 3 flag-OFF dual-path + 2 flag-ON JWT-only + 2 flag-ON no-guardian) | E (unit — runs in CI, no fixture needed) |

### Pinned tests

- `src/__tests__/components/parent/parent-unified-auth.test.tsx::D-authunify — flag OFF: existing dual path (byte-identical)::guardian present + flag ABSENT → seeds student from the HMAC loadParentSession (dual path intact)`
- `src/__tests__/components/parent/parent-unified-auth.test.tsx::D-authunify — flag OFF: existing dual path (byte-identical)::NO guardian + flag OFF → the link-code HMAC session is reachable (revives from sessionStorage)`
- `src/__tests__/components/parent/parent-unified-auth.test.tsx::D-authunify — flag ON + auth.guardian: JWT-only resolution::seeds the student from the guardian-JWT get_children call — never consults the HMAC fallback`
- `src/__tests__/components/parent/parent-unified-auth.test.tsx::D-authunify — flag ON + no auth.guardian: no stale HMAC revival::renders the unauthenticated LoginScreen and never calls loadParentSession (no silent HMAC revive)`

### Invariants covered by this section

- Flag-OFF safety (same family as REG-78/REG-79/REG-83/REG-84/REG-85): the entire
  D-authunify change is inert with `ff_parent_unified_auth_v1` OFF — the existing
  dual HMAC/JWT path runs byte-identically.
- P15 boundary (onboarding integrity): the change touches NO onboarding-funnel
  file — the signup→verify→profile→dashboard path for all three roles is untouched.
  The HMAC store (`parent-session.ts`) and the server-side auth boundary
  (`parent-portal` Bearer-JWT gate, `/api/parent/report` `authorizeRequest`) are
  unchanged.

### Notes on test strategy

REG-86 follows the **flag-OFF safety pattern** (REG-78/REG-79/REG-83/REG-84/REG-85):
the enforcing test renders a faithful replica of the page's resolution effect wired
to the REAL flag-read hook (`useFeatureFlags`) and a mocked `useAuth`, and asserts
on WHICH seam each branch consults (`loadParentSession` HMAC vs `getChildren` JWT) —
never on page internals (cosmic theme / atlas / dynamic imports). A full page mount
was avoided for the same reason REG-84 used a dispatch replica: the page pulls in
the cosmic provider, atlas flag, and several `dynamic(ssr:false)` chunks that are
irrelevant to the resolution decision. The two seams (`loadParentSession`,
`getChildren`) are the only ones the branch differs on, so they are exactly what the
assertion targets. The suite needs no Supabase fixture and runs green in CI today.

### Catalog total

Consumer Minimalism Wave D (auth unification) adds REG-86 (parent unified-auth
flag-OFF parity + JWT-only resolution + P15 boundary).

**Total: 54 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Auth-module security & onboarding fixes (2026-06-10) - REG-108..REG-111

Source: 2026-06-10 auth-module audit. Five fixes landed together: H1
(get_user_role PII enumeration), M1 (open redirect on /login), M3
(bootstrap Bearer fallback, server + client), M5 (bootstrap_user_profile
link_code accepted but never used), R2 (canonical metadata→bootstrap-params
derivation — teacher subjects/grades_taught were dropped as null by both
server confirmation routes, and the grade default had drifted per-site).
These entries pin the four security/funnel-critical contracts; R2's pure
derivation module is covered inside REG-110's location set.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-108 | `get_user_role_self_binding_guard` | Static canary on `supabase/migrations/20260610090000_secure_get_user_role.sql` (REG-47-style contract pin): (1) `CREATE OR REPLACE FUNCTION public.get_user_role(p_auth_user_id uuid)` + `SECURITY DEFINER` + pinned `search_path`. (2) Service-role bypass check `coalesce(auth.role(), '') <> 'service_role'` present. (3) Self-identity binding `p_auth_user_id IS DISTINCT FROM auth.uid()` present, with `RAISE EXCEPTION` on cross-user lookup. (4) The guard appears BEFORE the first role-table read (`FROM students`) so no PII is touched pre-guard. (5) anon EXECUTE revoke re-asserted (20260515000002 parity). Any later `CREATE OR REPLACE` of get_user_role that copies an older body forward and drops the guard fails this canary. | `src/__tests__/contract/auth-module-migration-canaries.test.ts` (H1 describe block) | E |
| REG-109 | `login_open_redirect_guard` | Both redirect call sites in `src/app/login/page.tsx` (already-logged-in useEffect + handleSuccess) route `?redirect=` through the REAL `validateRedirectTarget` with the role destination as fallback. Asserted by RENDERING the real page (next/navigation + AuthContext + AuthScreen mocked; `@/lib/identity` NOT mocked): (1) `?redirect=//evil.com` → role destination, never evil.com — for student AND teacher (fallback is role-aware, not hardcoded /dashboard). (2) `?redirect=/foxy` preserved on both call sites. (3) `javascript:` and backslash vectors blocked. (4) handleSuccess still calls router.refresh() and redirects immediately (the #892 stuck-button contract). Underlying validator vectors (`//`, `%2f`, `javascript:`, `data:`, backslash) are separately pinned in `src/__tests__/identity-constants.test.ts`. | `src/__tests__/login-redirect-guard.test.tsx` | E |
| REG-110 | `bootstrap_bearer_fallback_p15_layer2` | P15 layer-2 restoration (M3, server + client). Server (`src/app/api/auth/bootstrap/route.ts` resolveAuthUser): (1) no cookie + valid `Authorization: Bearer <jwt>` → user resolved via `getSupabaseAdmin().auth.getUser(token)`, bootstrap RPC runs for the Bearer identity; (2) no cookie + invalid Bearer → exact existing `401 {success:false, error:'Authentication required', code:'AUTH_REQUIRED'}` envelope, RPC never called; (3) cookie + Bearer both present → cookie wins and admin.auth.getUser is never called; (4) empty Bearer token → 401 without an admin call; (5) cookie client throwing falls through to Bearer. Client (`src/lib/AuthContext.tsx` bootstrap-fallback fetch, real AuthProvider mounted): attaches `Authorization: Bearer <access_token>` when getSession yields a token; omits the header (pre-M3 request shape) when the session has no token or the 3s-raced re-read throws; payload grade defaults to '9' as a STRING via normalizeGrade (R2 — was a hand-rolled `\|\| '6'`). R2's pure derivation (roleFromMetadata guardian→parent alias + garbage→student, teacher subjects/grades_taught surviving JSON-string AND array forms, P5 grade filtering, link_code trim-or-null) is pinned in the identity-bootstrap-profile suite. | `src/__tests__/auth-bootstrap.test.ts` (Bearer-token fallback describe) + `src/__tests__/auth-context-bootstrap-bearer.test.tsx` + `src/__tests__/identity-bootstrap-profile.test.ts` | E |
| REG-111 | `bootstrap_link_status_fail_soft` | P15 rule-5 contract on `supabase/migrations/20260610090100_bootstrap_link_code.sql` (static canary): (1) bootstrap_user_profile keeps the unchanged 11-param signature incl. `p_link_code` and calls the existing `public.link_guardian_via_invite_code` RPC (not an inlined copy). (2) Link attempted only for `p_role IN ('parent','guardian')` with a non-empty trimmed code, at BOTH attempt sites (main path + already_completed retry-heal, so the 3-layer failsafe converges to linked on re-invocation). (3) Every link attempt wrapped in `EXCEPTION WHEN OTHERS → v_link_status := 'invalid_code'` — an invalid/expired code can NEVER abort profile creation. (4) ADDITIVE `link_status` key ('linked'\|'invalid_code'\|'not_attempted') present on EVERY `RETURN jsonb_build_object` path and in the bootstrap_success audit metadata. (5) All ON CONFLICT idempotency markers preserved (onboarding_state, students/teachers/guardians auth_user_id constraints, state_events idempotency_key — P15 rule 4). (6) anon EXECUTE revoke re-asserted. | `src/__tests__/contract/auth-module-migration-canaries.test.ts` (M5 describe block) | E |

### Invariants covered by this section

- P13 (data privacy - REG-108) - get_user_role returned role/name/grade/
  school_id for ANY uuid to ANY authenticated caller; the self-binding guard
  closes the enumeration vector while the service_role bypass keeps
  middleware/admin/export-report callers working.
- P15 (onboarding integrity - REG-110, REG-111) - layer-2 of the 3-layer
  profile-creation failsafe 401'd for password-login users (localStorage
  session, no sb-* cookies); the Bearer fallback restores it. The link_code
  wiring is fail-soft: a bad code degrades to link_status='invalid_code',
  never a failed signup.
- P5 (grade format - REG-110) - bootstrap payload grade is always a bare
  string '6'..'12' with canonical default '9' via normalizeGrade, unified
  across AuthContext, callback/confirm, and the bootstrap route.
- Open-redirect prevention (REG-109, security-adjacent) - /login can no
  longer be used as a phishing trampoline via `?redirect=//evil.com`.

### Catalog total

Pre-auth-module-fixes: 75 entries. Adds REG-108..REG-111.

**Total: 79 entries.**

## Per-student aggregate cache — no cross-user leak / no auth bypass (Phase 5 perf) — REG-115

Source: Phase 5 perf finding #6 — six read-only per-student GET routes wrap their
expensive Supabase read in `cacheFetchAsync` (`src/lib/cache.ts`, `CACHE_TTL.USER`
= 30s) keyed by the AUTHENTICATED `student_id`/`userId`:
`src/app/api/v2/student/progress/route.ts`, `src/app/api/dashboard/reviews-due/route.ts`,
`src/app/api/rhythm/today/route.ts`, `src/app/api/dive/state/route.ts`,
`src/app/api/learner/weak-topics/route.ts`, `src/app/api/learner/scheduled/route.ts`.

The cache store is a module-level in-memory `Map` that survives across requests.
The load-bearing safety property (P13): a server-side cache that is NOT keyed by
the authenticated id, or that is read BEFORE auth, would serve one student's
mastery/XP/review-state to another. Four invariants are pinned:

  - **No cross-user leak.** Two different authenticated students hitting the same
    route inside the same 30s window each get THEIR OWN payload — the key embeds
    their id, so student B never receives A's cached body. A `JSON.stringify`
    negative match proves A's distinctive values never appear in B's response.
  - **No auth bypass.** The `cacheFetchAsync` read is reached only AFTER
    `authorizeRequest` (or `supabase.auth.getUser`) resolves the id; a denied
    request short-circuits at auth and returns the auth error — it can never reach
    the cache and is asserted to carry none of a prior authorized student's data.
  - **TTL coalesces.** A repeat call for the SAME student within the window is
    served from cache and does NOT re-hit the Supabase read (read spy stays at 1).
  - **Errors not pinned.** A transient DB error / no-profile branch throws inside
    (or short-circuits before) the fetcher so nothing is cached; a subsequent
    success returns fresh data.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-115 | `per_student_aggregate_cache_no_cross_user_leak` | For the heaviest route (`/api/v2/student/progress`) AND one more (`/api/dashboard/reviews-due`): (a) student A primes the cache, then student B — same 30s window — gets their OWN distinct DB rows, with a `JSON.stringify` negative match proving A's values never leak into B (key embeds the authenticated id — P13); (b) a denied (`authorized:false`) request returns the auth error (`403`/code), NOT a prior student's cached body — the cache read is keyed off the id derived AFTER `authorizeRequest`; (c) a repeat same-student call within the TTL is served from cache (read spy count stays 1 — the 30s window collapses to a single DB fetch); (d) a transient DB error / no-profile branch is NOT cached — a later success returns fresh data. | `src/__tests__/api/dashboard-cache-isolation.test.ts` | E |

### Invariants covered by this section

- P13 (data privacy) — per-student data is never shared across students; the
  server cache is keyed by the authenticated id and read only after auth, so a
  denied caller cannot retrieve another student's cached payload. Extends
  REG-46/REG-49/REG-68.

### Catalog total

Pre-Phase-5-cache: 82 entries. Adds REG-115 (per-student aggregate cache —
no cross-user leak / no auth bypass — P13).

**Total: 83 entries.**

## Parent↔child link boundary + auth-callback funnel resilience (Phase 4 route-coverage) — REG-117

Source: Phase 4 route-coverage — the OAuth / parent-link cluster. Two launch-critical
boundaries get a behavioral GET/POST-handler pin (prior coverage was structural
source-text only or absent):

1. **Parent↔child boundary (P8/P13).** `POST /api/parent/approve-link` lets a
   SIGNED-IN STUDENT approve/reject a PENDING parent-link request addressed to them.
   The ownership check — `link.studentId !== resolvedStudent.id → 404` — is the only
   thing stopping a student from approving (and thereby granting a stranger guardian
   access to) a DIFFERENT student's link by passing that link's id. A removed/relaxed
   check would let an attacker self-approve a guardian link onto another child.

2. **Auth-callback funnel resilience (P15 rule 3 + no-500).** `/auth/callback` (PKCE
   `code`) and `/auth/confirm` (`token_hash` + `type`) are the email-verification
   funnel. They MUST handle BOTH flows and MUST NEVER throw/500 — every branch
   (success, exchange/verify failure, missing param, thrown getUser on the signup
   branch) returns a 3xx redirect. Existing tests were structural (`export GET`
   present) + helper-unit; these are the first to INVOKE the handlers.

Other routes in the cluster (`/api/v2/parent/{children,glance,encourage}`,
`/api/parent/report`, `/api/parent/children/[id]/export`, `/api/parent/link-code/redeem`)
already have route-level boundary tests (cross-guardian isolation → 403, link-code+OTP
gate). No BLOCKER found in the audit: every parent data-access path scopes to the
JWT-resolved guardian/student id, never to an arbitrary id from the request; link
establishment requires a valid link code + emailed OTP.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-117 | `parent_link_boundary_and_auth_callback_resilience` | **(a) Cross-student link boundary (P8/P13):** `POST /api/parent/approve-link` — 401 with no session (no DB touched); 400 on non-UUID linkId / invalid action / malformed JSON (no write); 403 when the session has no student profile (findLinkById never called); when a pending link belongs to ANOTHER student → 404 with a GENERIC message (does not confirm the link exists for someone else) AND the `guardian_student_links` status UPDATE is NEVER issued (zero writes across the boundary); 404 when the link is null/not-pending; happy path — a student acting on THEIR OWN pending link flips status to approved/rejected via exactly one admin write keyed by that link id. The real handler runs; only the cookie session, students lookup, and `findLinkById` are mocked. **(b) Auth-callback funnel resilience (P15 rule 3 + no-500):** `/auth/callback` exchanges a valid PKCE `code` (calls `exchangeCodeForSession`) and redirects 3xx; a failed exchange redirects to `/login?error=…` (not 500); a MISSING code redirects to `/login` without calling exchange; a thrown `getUser` on the `type=signup` branch still redirects 3xx (try/catch funnel guard). `/auth/confirm` verifies `token_hash`+`type` (calls `verifyOtp`) and redirects 3xx; a failed verify redirects to `/login?error=verification_failed`; a missing `type` (guard false) redirects to `/login` without calling verifyOtp; a confirmed teacher signup routes to the `/teacher` role destination. Every branch asserts 300≤status<400 — the funnel never 500s. | `src/__tests__/api/parent/approve-link/route.test.ts`, `src/__tests__/auth-callback-resilience.test.ts` | E |

### Invariants covered by this section

- P8/P13 (parent↔child boundary) — a student cannot approve a link addressed to a
  different student; the cross-student status write is proven to never fire.
- P15 (onboarding integrity, rule 3 + no-funnel-break) — both PKCE and token_hash
  email-verification flows are handled and neither handler can 500 the funnel;
  promotes the previously tested-only P15 callback coverage to a behavioral pin.

### Catalog total

Pre-Phase-4-oauth-cluster: 84 entries. Adds REG-117 (parent↔child link boundary +
auth-callback funnel resilience — P8/P13/P15).

**Total: 85 entries.**

## daily-cron static-source contract canary — fail-closed auth gate + step/helper integrity + per-step error isolation + flag-gated revenue-adjacent steps — REG-118

Source: daily-cron contract-coverage. The `daily-cron` Edge Function is the single
nightly orchestrator behind several revenue-adjacent and operational-integrity
flows — the school-contract lifecycle (`ff_school_contracts_v1`), the monthly-synthesis
trigger (`ff_pedagogy_v2_monthly_synthesis`), and the principal-AI transcript purge.
A silent regression here (a deleted step, a flipped auth check, a swallowed 5xx that
masks partial failure) does not surface in any UI and would only be caught in
production. A static-source canary pins the function's load-bearing invariants so
that deleting or renaming any of them turns the build red.

The canary asserts four classes of invariant:

1. **Fail-closed CRON_SECRET auth gate.** The handler performs a constant-time
   `x-cron-secret` compare BEFORE any work begins; a missing/wrong secret short-circuits
   (no step runs). Removing or moving the gate after the first step turns it red.

2. **Step-name → helper integrity (17 critical pairs — amended 2026-07-03, Wave 0
   Task 0.2).** Each load-bearing step name is wired to its implementing helper;
   deleting or renaming either half breaks the pin. This is the guard against a step
   silently vanishing from the nightly run. The Wave 0 amendment adds the
   `coverage_audit_triggered`/`triggerCoverageAudit` and
   `question_bank_verify_triggered`/`triggerVerifyQuestionBank` pairs — these thin
   Edge-to-Edge fetch-outs are the ONLY nightly scheduling for the coverage-audit and
   verify-question-bank Edge Functions, and their fail-soft catch makes a dropped
   auth header a SILENT loss, so contract 4d additionally pins each trigger's target
   path, dual auth (`x-cron-secret` + service-role bearer for the platform gateway),
   thin/ungated posture (no DB reads, no flag gate in Deno), and fail-soft
   never-throw (`catch` + `return 0`).

3. **`Promise.allSettled` per-step error isolation.** Steps run under `allSettled`, so
   a single step's rejection is isolated (partial failure → HTTP 207, never a 5xx
   collapse that aborts every other step). A switch to `Promise.all` or a thrown-not-caught
   path turns it red.

4. **Flag-gating of revenue-adjacent steps.** The monthly-synthesis step is gated on
   `ff_pedagogy_v2_monthly_synthesis` and the school-contract step on
   `ff_school_contracts_v1`; the canary pins that both gates are present so neither
   step can run unflagged.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-118 | `daily_cron_contract_canary` | Static-source canary (27 Deno tests — amended 2026-07-03, Wave 0 Task 0.2) pinning daily-cron's load-bearing invariants: fail-closed CRON_SECRET auth gate (constant-time `x-cron-secret` compare) before any work; 17 critical step-name→helper pairs present (deleting/renaming any turns it red — incl. the Wave 0 `coverage_audit_triggered`/`question_bank_verify_triggered` pairs, the sole nightly scheduling for those two Edge Functions); `Promise.allSettled` per-step error isolation (partial failure → 207, never a 5xx collapse); flag-gating of the monthly-synthesis (`ff_pedagogy_v2_monthly_synthesis`) and school-contract (`ff_school_contracts_v1`) steps; and contract 4d pinning the two Wave 0 fetch-out triggers as thin, dual-authenticated (`x-cron-secret` + service-role bearer), ungated, and fail-soft (a dropped header would otherwise 401 silently every night). Runs in the CI `edge-function-tests` Deno job. | `supabase/functions/daily-cron/__tests__/contract.test.ts` | E |

### Invariants covered by this section

- P11-adjacent — the school-contract lifecycle and monthly-synthesis trigger are
  revenue-adjacent flows; the canary proves they stay behind their feature flags and
  cannot run unflagged or be silently dropped from the nightly run.
- Operational-integrity — fail-closed auth on the cron entrypoint, step/helper
  integrity, and per-step `allSettled` isolation (partial failure → 207, never a 5xx
  collapse) keep the nightly orchestrator's load-bearing steps from regressing silently.

### Catalog total

Pre-daily-cron-contract-canary: 85 entries. Adds REG-118 (daily-cron static-source
contract canary — P11-adjacent + operational-integrity).

**Total: 86 entries.**

## Engineering-Audit Cycle 1 — Auth & Onboarding (P15) — 2026-06-28

Source: engineering-audit program, Cycle 1 (Auth & Onboarding). The
`send-auth-email` Edge Function is a Supabase Send-Email hook: Supabase blocks
signup whenever the hook returns any non-200 status (P15 rule 1). This cycle
gave that invariant executable, handler-level coverage.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-177 | `send_auth_email_always_200` | The `send-auth-email` Edge Function returns HTTP 200 on ALL handler code paths — non-POST request, OPTIONS preflight, missing hook secret, invalid webhook signature, invalid payload, **relay send failure, relay send success, no-relay-config (`no_relay_config`)**, and top-level throw (`internal_error`) — plus a source canary asserting no non-200 status literal exists in the handler. A non-200 from a Supabase Send-Email hook blocks ALL signups (P15 rule 1). Provider-agnostic after the Mailgun→Resend migration (Phase 1, commit `828b5253`): the handler dispatches through the shared `_shared/relay-mailer.ts` seam (`sendEmail`), and the send-path tests inject a stub `EmailTransport` via `setDefaultEmailTransport()` so NO socket is ever opened — the whole 13-test suite runs fully offline (`--allow-read --allow-env`; `--allow-net` only warms the one esm.sh `standardwebhooks` import on a cold cache). Also pins the token-varying idempotency property (`authEmailTokenDimension` + `createEmailIdempotencyKey`): distinct auth tokens → distinct Resend `Idempotency-Key` so a re-requested confirmation/reset actually sends within Resend's 24h key TTL, while the SAME token → SAME key so a genuine transport retry still dedupes (no double-send). | `supabase/functions/send-auth-email/__tests__/always-200.test.ts` (behavioral `Deno.serve` handler-capture + injected stub transport, offline/socket-free; 13 tests); guarded against deletion by `e2e/auth-onboarding-p15.spec.ts` | E |

### Invariants covered by this section

- P15 (onboarding integrity — rule 1: `send-auth-email` MUST return HTTP 200 on
  every code path so Supabase never blocks signup)

### Catalog total

Pre-REG-177: 143 entries (142 catalogued through REG-175 + REG-176 Foxy
prompt-template routing). Engineering-Audit Cycle 1 adds REG-177:
`send-auth-email`-always-200 P15 hook coverage.
**Total catalog: 144 entries (target: 35 — TARGET EXCEEDED).**

> REG-177 refreshed 2026-07-15 for the Phase 1 Mailgun→Resend migration (commit
> `828b5253`): provider-agnostic relay path names, the `no_relay_config`
> fail-soft warning, the injected-stub-transport (`setDefaultEmailTransport`)
> offline/socket-free posture, and the newly-added token-varying idempotency
> property. NO new REG id was allocated — it is the same invariant, same test
> file, same P15 concern (a re-requested confirmation/reset MUST still deliver),
> and the same e2e deletion-guard. The idempotency-key tests live in the same
> `always-200.test.ts` suite, so folding them into REG-177 keeps one pin per
> enforcement locus rather than fragmenting one file across two catalog ids.
> Count unchanged at 144.

---

## Remediation — Tier-2 PR C: Durable Parent-Login Rate Limiter (P15/abuse) — 2026-06-30

The legacy `parent_login` per-IP bound rode the per-instance in-memory limiter
(`_shared/rate-limiter.ts::createRateLimiter`), which resets on every Edge cold
start — a brute-forcer who lands on a fresh instance gets a fresh budget. Tier-2
PR C introduces `_shared/durable-rate-limiter.ts::createDurableRateLimiter`, a
cross-instance Upstash `Ratelimit.fixedWindow(5, "3600 s")` limiter with a
TRANSPARENT in-memory fallback (the same `createRateLimiter` 5/1h primitive)
used when the Upstash Edge secrets are absent OR Redis errors. The limiter must
never return unlimited (no unconditional `allowed: true`), never throw on the
request path (the only `await redisLimiter.limit(...)` is inside a try/catch
that falls through to the in-memory `memCheck`), and the check must stay BEFORE
any DB lookup in `handleParentLogin` (fail-closed-before-DB). The esm.sh imports
are pinned by package path (version-tolerant). `parent-login-rate-limit.test.ts`
line 86 was updated in lockstep: the call-site pin moved from `createRateLimiter`
to `createDurableRateLimiter(..., 'rl:parent_login')`.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-204 | `durable_parent_login_rate_limiter_failsafe` | P15/abuse-hardening: parent_login uses a cross-instance Upstash `fixedWindow(5, 1h)` limiter that, when the Upstash Edge secrets are absent OR Redis errors, transparently falls back to the in-memory limiter (same 5/1h bound) — never returns unlimited, never throws on the request path, and the check stays BEFORE any DB lookup (fail-closed). Closes the per-instance cold-start reset gap of the prior in-memory-only limiter | `src/__tests__/edge-functions/durable-login-limiter.test.ts` | E | P15 |

### Invariants covered by this section

- P15 (onboarding/abuse path) — REG-204 pins that the parent-login per-IP bound
  is now durable across Edge cold starts (Upstash `fixedWindow(5, 1h)`), that the
  fallback to the in-memory limiter preserves the SAME 5/1h bound when secrets are
  absent OR Redis errors (never fails open, never throws on the request path), and
  that the limiter check stays strictly before `getServiceClient()`/the students
  `.or()` lookup in `handleParentLogin` (fail-closed-before-DB). esm.sh import
  specifiers are pinned by package path, tolerant of an architect `@version` pin.

### Catalog total

Pre-Tier-2-PR-C: 170 entries (through Tier-2 PR D's REG-203 grade read-coercion).
Tier-2 PR C adds REG-204 (durable parent-login rate limiter fail-safe — durable
Upstash `fixedWindow(5,1h)` with transparent same-bound in-memory fallback,
never-fail-open / never-throw on the request path, fail-closed-before-DB ordering).
**Total catalog: 171 entries (target: 35 — TARGET EXCEEDED).**

## Pedagogy v2 Wave 3 critical-bug fix (synthesis surrogate-id) + Dive/Synthesis/OAuth route-contract pins — 2026-07-02 — REG-223..REG-225

Source: today's engineering work. `GET /api/synthesis/state` resolved the
caller's `students` row via `.eq('id', authUid)` instead of
`.eq('auth_user_id', authUid)`. `students.id` is a surrogate uuid distinct
from the Supabase auth uid, so the old form never matched any real row —
every student hit `no_student_profile` and Pedagogy v2 Wave 3 (monthly
Curiosity Synthesis) was completely dead in production for every student,
despite the builder Edge Function correctly writing rows. The fix aligns
`/api/synthesis/state` with the same `auth_user_id` → `students.id`
resolution pattern already used by `/api/dive/state`, `/api/dive/history`,
and `/api/dive/artifact`. This pass also closes the test-coverage gap on the
rest of the Pedagogy v2 Wave 2/3 dive+synthesis route surface and adds
first-time coverage for the OAuth partner-integration surface
(`/api/oauth/authorize`, `/api/oauth/token`).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-223 | `synthesis_state_surrogate_id_resolution` | `GET /api/synthesis/state` MUST resolve the caller's surrogate `students.id` via `.eq('auth_user_id', authUid)` BEFORE querying `monthly_synthesis_runs.student_id` — never `.eq('id', authUid)`, which always misses (the CRITICAL bug fixed today, universally 404-ing `no_student_profile` for every student). Enforced via an argument-sensitive mock: a row resolves ONLY when the query column is `auth_user_id`; any other column (including `id`) returns `{data: null}`, so a regression fails loudly (`no_student_profile` 404 on what should be a 200) instead of silently matching the wrong row. A dedicated test asserts every `students` `.eq()` call used `auth_user_id` (never `id`) and every downstream `monthly_synthesis_runs` `.eq()` call used the resolved surrogate `student_id` (never the raw auth uid). Also pins: bilingual `summaryTextEn`/`summaryTextHi` on the `state:'ready'` row including the Claude lazy-fill path (P7), the lazy-fill persisting via `supabaseAdmin` exactly once, graceful `''` fallback (200, not 500) when the Claude lazy-fill call throws, and a P13 no-PII pin on the `no_student_profile` 404 body. Writer-side key consistency (both writers key `monthly_synthesis_runs.student_id` by the surrogate id, never the auth uid) cross-checked against `supabase/functions/daily-cron/` (`triggerMonthlySynthesis` step) and `supabase/functions/monthly-synthesis-builder/`. | `src/__tests__/api/synthesis/synthesis-routes.test.ts` | E |
| REG-224 | `pedagogy_v2_dive_synthesis_route_contracts` | The full Pedagogy v2 weekly Curiosity Dive route surface — `POST /api/dive/start`, `POST /api/dive/artifact`, `GET /api/dive/state`, `GET /api/dive/history` — and `POST /api/synthesis/parent-share` are pinned end-to-end: 401 when unauthenticated, 404 when `ff_pedagogy_v2_weekly_dive`/`ff_pedagogy_v2_monthly_synthesis` is off, 400 with a specific `error` code per invalid-body branch (missing/blank picker fields, malformed JSON, invalid `pickerOption`), 404 `student_profile_not_found`/graceful empty-array degradation depending on route, and 409 `already_saved_this_week` on a PG `23505` duplicate-artifact insert (not a generic 500). `GET /api/dive/history`'s `?limit` handling is pinned precisely: defaults to 20 when absent, passes an explicit `?limit=5` straight through, and — critically — FALLS BACK to the default 20 (does NOT clamp to a max of 60) when `?limit=100` exceeds the max, guarding against a "fix" that silently changes this to clamp-to-max behavior. `POST /api/synthesis/parent-share` additionally pins the cross-student ownership boundary: a synthesis row whose linked `students.auth_user_id` does not match the caller returns 403 `forbidden` before any WhatsApp send or status write (P8), and every denial body (401/403/404) carries no PII keys (P13). | `src/__tests__/api/dive/dive-routes.test.ts` (35 tests), `src/__tests__/api/synthesis/synthesis-routes.test.ts` (shared file, parent-share block) | E |
| REG-225 | `oauth_partner_surface_contracts` | `GET /api/oauth/authorize` and `POST /api/oauth/token` (the OAuth2 partner-integration surface, service-role `getSupabaseAdmin()` — never the RLS-scoped server client) are pinned: missing required param → 400 `invalid_request`; unknown/inactive/pending-review `client_id` → 400 `invalid_client`/`app_not_approved`; a `redirect_uri` outside the app's registered allowlist → 400 `invalid_redirect_uri` (never silently accepted); unknown/inactive requested scope → 400 `invalid_scope`; a valid request echoes `state` and PKCE `code_challenge`/`code_challenge_method` verbatim and returns the scope's `display_name_hi` Hindi field in the consent payload (P7 — the consent screen must never fall back to English-only). On the token endpoint: missing/unsupported `grant_type` → 400; wrong client credentials → 401 `invalid_client` (via `secureEqual` constant-time comparison, not `===`); a valid `refresh_token` grant returns fresh `access_token`/`refresh_token`/`token_type: 'Bearer'`/`expires_in: 3600` and the response ALWAYS carries `Cache-Control: no-store` (on both success and every error branch) so tokens are never cached; a refresh token that is expired, revoked, or bound to a different `app_id` is rejected with `invalid_grant`, never silently honored; form-urlencoded request bodies are accepted identically to JSON. Every `invalid_client` denial body carries no PII keys (P13). | `src/__tests__/api/oauth/oauth-routes.test.ts` (26 tests) | E |

### Invariants covered by this section

- P1-class data-integrity (the reader/writer surrogate-id contract) — REG-223
  closes a universal-outage-class bug where a reader used the wrong join key
  against a writer that was always correct; the regression guard makes any
  future `id` vs `auth_user_id` drift in `/api/synthesis/state` fail loudly.
- P7 (bilingual UI) — REG-223 pins `summaryTextEn`/`summaryTextHi` on every
  synthesis-state response path (cached and lazy-filled); REG-225 pins
  `display_name_hi` in the OAuth consent-scope payload.
- P8 (RLS boundary / cross-tenant ownership) — REG-224 pins the parent-share
  cross-student ownership check (a synthesis row cannot be shared by anyone
  other than its owning student).
- P13 (data privacy) — REG-223, REG-224, and REG-225 each pin that their
  respective denial response bodies (401/403/404) contain no PII keys
  (no `email`, `phone`, or `name`).

### Catalog total

Pre-REG-223: 189 entries (through XC-3 Phase 4 first drain, REG-222).
Today's Pedagogy v2 Wave 3 critical-bug fix + route-contract hardening adds
REG-223 (synthesis-state surrogate-id resolution — the CRITICAL fix),
REG-224 (dive + synthesis parent-share route contracts, 35+ tests), and
REG-225 (OAuth partner-surface contracts, 26 tests).
**Total catalog: 192 entries (target: 35 — TARGET EXCEEDED).**

---

## Email-Onboarding Phase 3b — institution_admin as a first-class onboarding role — 2026-07-15

Source: Phase 3b of the Supabase-native email-onboarding work. `institution_admin`
(school admin) becomes a first-class citizen of the signup→profile→dashboard
funnel. Three app-code changes land the behaviour:
`packages/lib/src/identity/school-admin-bootstrap.ts` (the single
`ensureSchoolAdminOnboarding` helper — RPC-first via `bootstrap_user_profile`
+ city/state/principal_name patch + idempotent admin-client fallback, canonical
`school_admins.role='principal'`, `onboarding_state` written);
`packages/lib/src/identity/onboarding.ts` (`resolveIdentity` /
`validateIdentityCompleteness` now query `school_admins`, so onboarding-status
and repair SEE a school admin); and `packages/lib/src/identity/complete-signup.ts`
(the shared bootstrap+session helper both `/auth/callback` and `/auth/confirm`
delegate to). The invariant this pins: a school-admin signup must create
school + admin(role=principal) + onboarding_state, be visible to
identity-resolution/repair, and NEVER break the funnel — every write is
fail-soft and the auth routes stay 3xx-only (P15).

### Notes on ID assignment

REG-248 is the next free id: after the origin/main merge the catalog's max id is
REG-247 (Foxy Perception) and this project appends rather than backfilling
intentional gaps (REG-170 remains a documented skip). REG-248 is confirmed absent
before use. (This entry was authored as REG-242 on the email-onboarding branch and
renumbered to REG-248 on merge to avoid a collision with the origin/main Foxy
REG-241..247 block.)

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-248 | `institution_admin_first_class_onboarding` | (a) **Identity resolution sees school admins**: `resolveIdentity()` with a `school_admins` row returns `hasProfile=true`, `detectedRole='institution_admin'`, `profile.type='school_admin'` (full row spread, `role='principal'`), and `institution_admin` wins at highest precedence when student/teacher/guardian/school_admin rows all co-exist; a school admin with a completed `onboarding_state` is `isOnboarded=true`. (b) **Completeness is role-generic**: `validateIdentityCompleteness()` treats a school admin (school_admins row + completed onboarding) as complete (`[]`), and attributes a missing profile row to the `institution_admin` role when absent. (c) **Bootstrap shape — RPC-first**: `ensureSchoolAdminOnboarding()` calls `bootstrap_user_profile` with `p_role='institution_admin'` + normalized `p_school_name`/`p_board`, then PATCHES `city`/`state`/`principal_name` onto the RPC-created school (no direct-insert fallback fires), and upserts `onboarding_state` (`intended_role='institution_admin'`, `step='completed'`, `profile_id`=RPC id); returns `{ok:true, schoolId, schoolAdminId, onboardingStateWritten:true}`. (d) **Bootstrap shape — admin-client fallback (P15)**: when the RPC is unavailable (error) OR its transport throws, the helper creates `schools` + `school_admins` directly with the CANONICAL `role='principal'`, writes `city`/`state`, upserts `onboarding_state`, and idempotently REUSES the earliest existing membership instead of duplicating. (e) **Fail-soft (P15)**: a failed `onboarding_state` write does NOT throw/block signup — returns `ok:true` with `onboardingStateWritten:false`; when no `school_admins` row can be established at all, returns the structured not-ok result (never throws). (f) **Both auth routes stay 3xx-only**: `/auth/callback` (PKCE) and `/auth/confirm` (token_hash + legacy token) drive the real GET handlers through the shared `completeSignupBootstrap` and every branch (success / exchange-fail / missing-param / getUser-throws) returns a redirect, never a 500. NOTE (documented gap): no live E2E exercises institution_admin end-to-end — the P15 E2E specs (`e2e/auth-onboarding-p15.spec.ts`, `e2e/auth-onboarding-3role.spec.ts`) still cover only student/teacher/guardian. Extending them to a 4th (institution_admin) role is an open follow-up. | `apps/host/src/__tests__/identity-onboarding.test.ts` (resolveIdentity school-admin detection + precedence + onboarded; validateIdentityCompleteness school-admin complete + missing-row), `apps/host/src/__tests__/school-admin-bootstrap.test.ts` (6 tests: RPC-first + city/state patch, admin-client fallback role=principal, idempotent reuse, RPC-throws fallback, fail-soft onboarding_state, not-ok backstop), `apps/host/src/__tests__/auth-callback-resilience.test.ts` (both routes 3xx-only through the shared helper) | E | P15, P9 |

### Invariants covered by this section

- P15 (onboarding integrity) — the school-admin signup funnel is fully fail-soft:
  a failed onboarding_state write, a failed RPC, or an unestablishable admin row
  never throws into the auth flow, and both `/auth/callback` + `/auth/confirm`
  stay 3xx-only.
- P9 (RBAC enforcement) — the funnel establishes the institution_admin role via
  the canonical `school_admins.role='principal'` (the DB `sync_school_admin_role`
  trigger assigns the RBAC role on insert), consistently on both the RPC-first
  and admin-client fallback paths.

### Catalog total

Pre-REG-248: 214 entries (through REG-247, Foxy Perception observability-only
event-data-layer). Adds REG-248 (institution_admin first-class onboarding:
RPC-first + fail-soft admin-client fallback creating
school+admin(role=principal)+onboarding_state, identity-resolution/repair
visibility, both signup paths 3xx-only through the shared completeSignupBootstrap).
**Total catalog: 215 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-250 — self-serve school onboarding assigns a unique subdomain slug (server-derived, idempotent, fail-soft) so new schools are reachable at <slug>.alfanumrik.com (Phase 6 white-label, P15) (2026-07-15)

The self-serve email onboarding path (`ensureSchoolAdminOnboarding`,
`packages/lib/src/identity/school-admin-bootstrap.ts`) previously left
`schools.slug` NULL. A NULL slug matches NO subdomain, so a freshly-signed-up
school was unreachable at `<slug>.alfanumrik.com`. Phase 6 wires
`resolveUniqueSchoolSlug()` + `patchSchoolDetails()` so the helper now derives a
UNIQUE slug from the server-normalized school name (via the extracted leaf
normaliser `packages/lib/src/normalize-slug.ts`) and folds it into the SAME
`schools` UPDATE as city/state/principal_name — a single round-trip, on the same
fail-soft best-effort path as the rest of the helper (P15: a slug failure can
never block school signup).

This complements the trial/bulk-provisioning path, which ALREADY had its own
slug+code generation in `provisionTrialSchool`
(`packages/lib/src/school-provisioning.ts`, its own `MAX_SLUG_ATTEMPTS`
collision loop writing `code`=`slug`=finalSlug), exercised by
`apps/host/src/__tests__/school-admin/provision-trial-school-admin-link.test.ts`
plus the pure `apps/host/src/__tests__/lib/normalize-slug.test.ts`. REG-250 closes
the equivalent gap on the SELF-SERVE path.

### Notes on ID assignment

REG-250 is the next free id: after the origin/main merge (and the renumbered
REG-248/REG-249 entries ahead of it) the catalog's max id is REG-249 and this
project appends rather than backfilling intentional gaps (REG-170 remains a
documented skip). REG-250 was confirmed absent before use. (This entry was
authored as REG-244 on the email-onboarding branch and renumbered to REG-250 on
merge to avoid a collision with the origin/main Foxy REG-241..247 block.) SCOPE
HONESTY: the originating task referred to the trial path as "REG-135", but in THIS
catalog REG-135 is the MOL deterministic-priority router
(`mol_deterministic_openai_priority`) — the trial-path slug generation has no
dedicated REG id here, so REG-250 references the actual trial-path test files above
rather than citing a mismatched number.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-250 | `self_serve_school_slug_unique_idempotent_failsoft` | Exercises the REAL `ensureSchoolAdminOnboarding` (RPC-success branch) with only the Supabase admin client mocked at the `getSupabaseAdmin` seam; the fire-and-forget Phase-4 tenant-claim dispatch is stubbed. (a) **NEW school (slug NULL)** → the idempotency read returns NULL, exactly ONE free candidate (`delhi-public-school`) is probed, and that slug is written into the SAME `schools` UPDATE as `city`/`state` (single round-trip); the slug is server-normalized (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, lowercase hyphen-delimited). A name that normalizes to empty (`'###'`) falls back to the base `'school'`. (b) **IDEMPOTENT (never overwrites)** → when `schools.slug` is already non-null (`my-school-original`, operator-set / prior P15 re-run), the current-slug read short-circuits: NO collision probe runs, and the `schools` UPDATE carries NO `slug` key while still patching the other columns (`city`/`state`) — a pre-existing slug is left untouched. (c) **COLLISION suffixing** → a taken base is suffixed: `{base}` taken → probe `{base}-1` (free) → write `{base}-1`; `{base}`,`-1`,`-2` all taken → deterministically resolves the first free `-3`. (d) **FAIL-SOFT (P15)** → a slug UPDATE unique-violation (`23505 … "schools_slug_key"`) is swallowed (helper returns `ok:true`, `schoolAdminId` intact — signup NOT blocked); and a slug RESOLUTION failure (the current-slug read THROWS) is caught → returns a null slug, still patches `city`/`state` with NO `slug` key, and onboarding completes `ok:true`. SCOPE NOTE: unit-level — asserts the resolve→normalize→probe→patch BEHAVIOR + branching. Does NOT assert the live-DB `schools_slug_key` UNIQUE constraint, actual wildcard-subdomain TLS/routing, or the RPC-fallback (direct-insert) branch's slug path (RPC-success branch only); those are deploy/integration-time. | `packages/lib/src/identity/school-admin-slug.test.ts` (7 tests: 2 new-school + 1 idempotent + 2 collision + 2 fail-soft), mirrored into the apps/host vitest lane via the `apps/host/src/lib/identity/school-admin-slug.test.ts` re-export stub (same mechanism as REG-249). Code under test: `packages/lib/src/identity/school-admin-bootstrap.ts` (`resolveUniqueSchoolSlug` + `patchSchoolDetails` + `ensureSchoolAdminOnboarding`); normaliser `packages/lib/src/normalize-slug.ts`. | E | P15 |

### Invariants covered by this section

- P15 (onboarding integrity) — slug derivation is on the helper's best-effort
  fail-soft path: neither a slug write unique-violation nor a slug resolution
  throw can block or fail school signup, and an idempotent re-run never clobbers
  a previously-captured slug. The self-serve school becomes reachable at its
  themed subdomain without adding a failure mode to the #1 acquisition funnel.

### Catalog total

Pre-REG-250: 216 entries (through REG-249, school_id JWT claim staff-only).
Adds REG-250 (self-serve school onboarding assigns a unique, server-derived,
idempotent, fail-soft subdomain slug; complements the trial path's own slug
generation in `provisionTrialSchool`). **Total catalog: 217 entries (target: 35 —
TARGET EXCEEDED).**

---

## B2C funnel completion — email_verified + client→server hash stitch + role segmentation (P13/P15/P5) — 2026-07-18 — REG-271

Source: B2C analytics Wave 2 on branch `feat/analytics-wave2-funnel-completion`
(architect `6d9f5d69` — server `email_verified` emit + `hashDistinctId` + role
allowlist + `QuizGradedPayload` subject/grade type; frontend `45d1c3cf` — role
person-prop on the live identify; ai-engineer `4e2288fa` — `quiz_graded` hashes
`authUserId` + emits subject/grade). Wave 2 completes the acquisition→activation
funnel: the browser step and the server step must stitch to ONE PostHog person.

**Area:** Analytics / PostHog — P13 Data Privacy, P15 Onboarding Integrity, P5 Grade Format
**Risk:** HIGH — a silent, invisible failure mode. If the client (Web-Crypto) and
server (Node-crypto) distinct-id derivations ever diverge, every client→server
funnel reads a FALSE 0% with nothing red in CI. A `quiz_graded` keyed by
`students.id` instead of the hashed `auth.uid` stitches activation to a PHANTOM
person (same false-0%). A first-time `email_verified` payload leaking a
name/email/phone/UUID would ship minors' identifiers to a third-party backend.

**What it pins:**
- **(a) Client↔server hash parity — THE anti-0%-funnel pin.** The server
  `hashDistinctId(uuid)` (`packages/lib/src/posthog/server.ts`, Node-crypto)
  byte-equals the client `hashUserIdForAnalytics(uuid)`
  (`packages/lib/src/posthog-client.ts`, Web-Crypto) for every fixture: SHA-256
  over the utf-8 UUID → first 8 bytes → 16 lowercase hex, UNSALTED, across the
  runtime boundary. A hardcoded digest anchor catches an identical-drift on BOTH
  sides; an independent bare-`createHash` recompute catches a salt.
- **(b) `email_verified` — first-time-only + fail-soft + PII boundary.** Fires
  EXACTLY ONCE on first verification (`!hasProfile`) from the shared
  `completeSignupBootstrap` (covers both `/auth/callback` PKCE and `/auth/confirm`
  token_hash), NEVER on a repeat. Payload is EXACTLY `{ role, method:'email' }` —
  no name/email/phone/raw UUID (P13). Role is normalized to the signup_complete
  vocabulary (teacher→'teacher', parent→'guardian', student→'student',
  institution_admin→SKIPPED, no emit — B2B). distinctId is the 16-hex hash of the
  auth uid, never raw. idempotencyKey is timestamp-free (`email_verified:<hash>`)
  → forever-dedup on a re-clicked link. The emit is fail-soft (P15): a throw in
  `after()`/capture never breaks `completeSignupBootstrap`'s return/redirect.
- **(c) `quiz_graded` auth.uid stitch + subject/grade facets.** distinctId is
  `hashDistinctId(authUserId)` — asserted to equal the hash of the AUTH uid and
  to be NEITHER `input.studentId` NOR its hash (the phantom-person guard).
  `subject` and `grade` are present; `grade` is a STRING (P5). `$insert_id` stays
  session-keyed. No scoring/XP value is recomputed — the payload re-broadcasts the
  RPC's authoritative score/xp/correct/total verbatim (measurement-only).
- **(d) Role person-prop on the live identify path.** The real `identify()` in
  `packages/lib/src/posthog/client.ts` (the function AuthContext calls) stamps a
  resolved funnel role (student|teacher|guardian) on the person; the allowlist
  filter DROPS `role: undefined` (the institution_admin outcome AuthContext maps
  to undefined) and every non-allowlisted PII key (email/full_name/phone/raw id);
  the distinctId reaching `posthog.identify` is the hash, never the raw uid. `role`
  is confirmed present in `PERSON_PROPERTY_ALLOWLIST`.

**Tests:**
- `src/__tests__/analytics/wave2-hash-parity.test.ts` (10 tests — per-fixture parity, digest anchor, unsalted recompute, determinism/collision-distinctness)
- `src/__tests__/lib/identity/complete-signup-email-verified.test.ts` (10 tests — once/never, exact `{role,method}` payload, hashed distinctId, role vocabulary incl. institution_admin skip, fail-soft on after()/capture throw)
- `src/__tests__/lib/quiz/submit-side-effects-quiz-graded-stitch.test.ts` (7 tests — auth.uid stitch + not-studentId, subject/grade string, session-keyed insert_id, no recompute, replay short-circuit)
- `src/__tests__/analytics/wave2-role-person-prop.test.ts` (7 tests — allowlist has role, funnel role stamped, undefined dropped, PII keys dropped, hashed distinctId)

**Regression note (2026-07-18, testing verification gate):** the ai-engineer
commit `4e2288fa` added `hashDistinctId(authUserId)` to `emitPostHogEvents` but
did NOT run the suite — every existing test whose `@alfanumrik/lib/posthog/server`
mock exported only `capture` threw `No "hashDistinctId" export is defined on the
mock` on the fresh-grade path (5 files: `submit-side-effects-offline`,
`api/v2/quiz-submit`, `api/quiz-submit-idempotency`, `api/quiz-submit-authz`,
`api/quiz-active-student-gate`). Additionally `api/v2/quiz-submit.test.ts`
asserted the OLD phantom-person value (`quiz_graded` distinctId === `students.id`).
All were repaired here (partial-mock via `importOriginal` to keep the real
`hashDistinctId`; the stale distinctId assertion updated to the hashed auth uid) —
no production code changed.

### Invariants covered by this section

- P13 (data privacy — hashed distinct ids only; `email_verified`/`quiz_graded` payloads carry no PII; role is a coarse enum, not PII)
- P15 (onboarding integrity — the `email_verified` emit is fail-soft and never breaks the verify→profile→dashboard funnel)
- P5 (grade format — `quiz_graded.grade` stays a string)

### Catalog total

Pre-REG-271: 237 entries (through the EU PostHog analytics turn-on, REG-270).
B2C funnel completion adds REG-271: client↔server hash parity + `email_verified`
first-time/fail-soft/PII boundary + `quiz_graded` auth.uid stitch + role person-prop.
**Total catalog: 238 entries (target: 35 — TARGET EXCEEDED).**
