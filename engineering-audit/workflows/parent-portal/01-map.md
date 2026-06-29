# Parent Portal — Workflow Map (DISCOVER → MAP)

Engineering Audit Cycle 7 · Backend agent · ANALYSIS ONLY (no code changed)
Repo: `D:\Alfa_local\Alfanumrik` · Date: 2026-06-29

Scope: the parent journeys from signup/link → dashboard → child drill-down →
comms. Each step maps page/route → auth gate → parent↔child link-boundary →
data returned, with `file:line` evidence and a note on whether the boundary is
RLS-backed or app-only.

---

## 0. The data model (link substrate)

`guardian_student_links` (baseline `00000000000000_baseline_from_prod.sql`):
- Table def: line 11411; unique `(guardian_id, student_id)`: 15411-15412.
- FKs: `guardian_id → guardians(id)` (19088), `student_id → students(id)` (19092), both ON DELETE CASCADE.
- Partial unique index for the minor-invite placeholder: `idx_gsl_unique_pending_student` — one NULL-guardian pending row per student (17162).
- Status column is plain `TEXT` (coerced defensively in code — `relationship.ts:61-75`).
- **Active link statuses** = `['active','approved']` (`ACTIVE_GUARDIAN_LINK_STATUSES`, consumed everywhere).

RLS on `guardian_student_links` (baseline 19837-19859):
- `Guardians can view own links` — SELECT, `guardian_id IN (own guardians)`.
- `Guardians can insert own links` — INSERT, same predicate.
- `Guardians can update own links` — UPDATE, same predicate.
- `Service role full access guardian_student_links` — service_role USING/CHECK true (19958).

Boundary helper at the DB layer: `public.is_guardian_of(student_id) → bool`
(SECURITY DEFINER) — true only when a link exists with `status IN
('active','approved')`. Used by RLS read policies on child-data tables
(`concept_mastery`, `topic_mastery`, `student_learning_profiles`,
`spaced_repetition_cards`, `student_simulation_progress`, and — added
2026-06-20 — `foxy_chat_messages` + `foxy_sessions`; see migration
`20260620000200_..._guardian_read_foxy_chat.sql:106-147`).

The single APP-layer cross-role boundary:
`canAccessStudent(authUserId, studentId)` — `src/lib/rbac.ts:243-298`.
For a parent it resolves `guardians` by `auth_user_id` (284-288) then checks a
`guardian_student_links` row with `status IN ('active','approved')` for that
student (291-298). **It runs on the service client (`getServiceClient()`,
rbac.ts:244) and therefore bypasses RLS** — it IS the boundary, not a consumer
of one.

Companion narrow helper: `isGuardianLinkedToStudent(guardianId, studentId)`
(`src/lib/domains/relationship.ts:316-342`) — same `status IN active/approved`
check, but takes a resolved `guardian.id` rather than the auth user. Some
routes use this instead of `canAccessStudent` (see §3).

> Note: two different boundary helpers are in use across parent routes
> (`canAccessStudent` vs `getGuardianByAuthUserId`+`isGuardianLinkedToStudent`).
> Both enforce the identical `status IN ('active','approved')` rule, so they
> are equivalent in effect, but the duplication is a maintainability risk
> (see 02-gap-analysis PP-6).

---

## 1. Journey A — Signup / Link (request → approve → linked)

There are **four distinct link-creation paths** with different security
postures. This is itself a finding (PP-1/PP-3); mapped here for completeness.

### A1. Guardian-initiated request → student approves (the consent flow)
- Guardian inserts a `pending` link row (RLS `Guardians can insert own links`, baseline 19837).
- Student approves/rejects: `POST /api/parent/approve-link` — `src/app/api/parent/approve-link/route.ts`.
  - Auth gate: cookie session via `createSupabaseServerClient().auth.getUser()` (36-43) — **student** session, not parent.
  - Ownership: resolves the student row by `auth_user_id` (73-77), fetches the pending link via `findLinkById(linkId,'pending')` (91), and verifies `link.studentId === student.id` (108-112) — else generic 404 (no info leak).
  - Mutation: status → `approved`/`rejected` via `supabaseAdmin` (117-120, deliberately bypasses RLS because the student is not the link's guardian).
  - Boundary: **app-only** (student-ownership check in route; the write uses service role).
  - Pinned by REG-117 (parent↔child approve-link boundary P8/P13).

### A2. Link-code + email OTP (2FA, strongest path)
- `POST /api/parent/link-code/request-otp` — `src/app/api/parent/link-code/request-otp/route.ts`.
  - Per-IP rate limit 5/hr BEFORE any DB touch (95-112).
  - Auth: signed-in guardian cookie session (118-125).
  - Resolves link code → student (150-155), emails a 6-digit OTP to the guardian's **session email** (266-276).
  - **Silent success on no-match** (166-174) and resend cooldown (180-202) — prevents code enumeration. Dev-only `otp_dev` escape hatch never active in prod (291).
- `POST /api/parent/link-code/redeem` — `src/app/api/parent/link-code/redeem/route.ts`.
  - Per-IP rate limit 10/hr (82-99); auth (102-109).
  - Per-challenge attempt cap (5) with `locked_until` → 423 (167-186, 209-263); **constant-time** OTP compare via `verifyOtp` (207).
  - On success calls RPC `link_guardian_to_student_via_code` (294-297) and burns the challenge (334).
  - Full audit trail to `auth_audit_log` on every branch (success / wrong / locked / no-challenge / rate-limited).
  - Boundary established by the RPC; this route owns the 2FA gate.

### A3. Emailed invite acceptance (minor auto-invite)
- `POST /api/parent/accept-invite` — `src/app/api/parent/accept-invite/route.ts`.
  - Auth: signed-in guardian cookie session (43-51).
  - Verifies guardian profile (68-72), redeems via idempotent RPC `link_guardian_via_invite_code` (92-95), retires the NULL-guardian placeholder row (127-132).
  - Code truncated in logs (37-39, P13).
  - Terminal status: `approved` (idempotent ON CONFLICT).

### A4. Edge Function `parent_login` (legacy link-code-only, WEAKEST)
- `supabase/functions/parent-portal/index.ts` → `handleParentLogin` (68-243).
  - Main handler now REQUIRES a Bearer JWT for every action including `parent_login` (1140-1156); `body.auth_user_id` is ignored (1130-1139, 2026-04-29 hardening).
  - On a valid link code it creates/links a guardian with **`status: 'active', is_verified: true`** (129-138, 223-231) — **no student approval, no OTP**.
  - 2026-04-29 fix prevents impersonating an *existing* guardian for a leaked code (152-195).
  - **No server-side rate limit on the Edge Function.** The brute-force lockout in `src/app/parent/_components/parent-session.ts:99-138` is **client-side sessionStorage only** (bypassable).
  - Marked deprecated (`logDeprecatedEdgeFunctionHit`, 13-15) but still deployed and callable.
  - **This is the consent-model weakness — see PP-1.**

### Link-boundary summary for Journey A
| Path | Auth gate | Approval/consent | Rate-limited (server) | Terminal status |
|---|---|---|---|---|
| A1 approve-link | student cookie session | student approves | n/a | approved |
| A2 OTP redeem | guardian cookie session | email OTP 2FA | yes (IP + per-challenge) | (RPC) |
| A3 accept-invite | guardian cookie session | emailed invite code | no (relies on code secrecy) | approved |
| A4 Edge parent_login | guardian Bearer JWT | **none** | **no** | **active** |

---

## 2. Journey B — Dashboard (linked children only)

- Web parent pages: `src/app/parent/page.tsx`, `children/page.tsx`, `reports/page.tsx`, etc. (18 files under `src/app/parent/`).
- Parent auth state resolved by `useParentAuth()` — `src/app/parent/_components/useParentAuth.ts:29-71`. Two modes: `guardian` (full Supabase auth, multi-child) and `link-code` (anonymous HMAC session, single pinned child). Link-code session payload is HMAC-integrity-checked, 4h TTL, stores only `{id,name,grade}` (parent-session.ts:49-87).
- Children list (the canonical read both web + mobile use):
  - `GET /api/v2/parent/children` — `src/app/api/v2/parent/children/route.ts`.
    - Auth gate: `authorizeRequest(request,'child.view_progress')` (29) — RBAC (P9).
    - Guardian resolution: `getGuardianByAuthUserId(auth.userId)` → 403 if none (34-37).
    - Boundary: `listChildrenForGuardian(auth.userId)` (`relationship.ts:128-190`) — joins `guardian_student_links ∩ students` filtered to `ACTIVE_GUARDIAN_LINK_STATUSES` (140-146). **App-only** (service-role read inside the domain helper).
    - Data returned (P13): `student_id, name, grade` only (52-56); grade coerced to string (P5).
- Edge Function multi-child dashboard: `handleGetAllChildrenDashboard` (index.ts:569-596) — reads links by `guardian_id` (overridden to the JWT-trusted value at 1169) filtered to `['active','approved']`.

---

## 3. Journey C — Child drill-down (progress / reports scoped to linked child)

All of these take a `student_id` and MUST verify the link before returning data.

| Route | File:line | Auth gate (P9) | Link boundary | RLS-backed? |
|---|---|---|---|---|
| Glance (mobile) `GET /api/v2/parent/glance` | `v2/parent/glance/route.ts:54,64,71-82` | `child.view_progress` | `isGuardianLinkedToStudent` + Edge re-checks via forwarded JWT | App-only (Edge uses service role) |
| Weekly AI report `POST /api/parent/report` | `parent/report/route.ts:20,37,47-53` | `child.view_progress` | `isGuardianLinkedToStudent` | App-only |
| Calendar `GET /api/parent/calendar` | `parent/calendar/route.ts:71,103` | `child.view_progress` | `canAccessStudent` | App-only (reads via `supabaseAdmin`) |
| Child Foxy chat `GET /api/parent/children/[id]/chat` | `parent/children/[student_id]/chat/route.ts:115,128` | `child.view_progress` | `canAccessStudent` | **RLS-backed** (reads via RLS-scoped anon client, 84-107, 161; backed by `foxy_chat_messages_guardian_select` policy) |
| Data export `GET /api/parent/children/[id]/export` | `.../export/route.ts:112,146-170` | `child.view_progress` | `listChildrenForGuardian` (needs school_id) | App-only |
| Erasure request/status `.../request-erasure`, `.../erasure-status` | `request-erasure/route.ts:66,99`; `erasure-status/route.ts:38,61` | `child.view_progress` | explicit `guardian_student_links` link check | App-only |
| Edge dashboard `get_child_dashboard` | `index.ts:614-689` (link check 639-655) | Bearer JWT + guardian resolution | explicit link check `['active','approved']` | App-only (service role) |
| Edge attendance `get_child_attendance` | `index.ts:832-886` (link check 848-858) | Bearer JWT + guardian resolution | explicit link check | App-only |
| Edge monthly report `get_monthly_report` | `index.ts:891-977` (link check 911-927) | Bearer JWT + guardian resolution | explicit link check | App-only |

**Defense-in-depth observation**: only the **child Foxy chat** route reads
through an RLS-scoped client (true two-layer enforcement, app + DB). Every
other child-data read uses `supabaseAdmin` (service role) and relies on the
app-layer link check alone. The child-data *tables* (`concept_mastery`,
`topic_mastery`, etc.) DO carry guardian RLS via `is_guardian_of()`, but those
policies are not exercised on the service-role path these routes take.

---

## 4. Journey D — Comms (report / WhatsApp / messages / encourage)

| Route | File:line | Auth gate | Boundary | Notes |
|---|---|---|---|---|
| Encourage (preset cheer) `POST /api/v2/parent/encourage` | `v2/parent/encourage/route.ts:43,...` | `child.encourage` | `getGuardianByAuthUserId` + `isGuardianLinkedToStudent` | P12: message is a curated preset key only, never free text (23-24); 1 cheer / 6h rate limit (38); logs UUIDs only (31) |
| Messages list `GET/POST /api/parent/messages` | `parent/messages/route.ts:57,70,116` | `child.view_progress` | guardian resolution + link check before thread create (116) | teacher↔parent threads |
| Thread list `GET /api/parent/messages/threads` | `messages/threads/route.ts:46,49` | `child.view_progress` | guardian-row resolution | |
| Thread messages `GET .../threads/[id]/messages` | `threads/[id]/messages/route.ts:34,40,67` | `child.view_progress` | **strict thread ownership** `thread.guardian_id === guardian.id` (67) → 403 | no IDOR |
| Notifications list / read | `notifications/route.ts:61,67`; `[id]/read/route.ts:36,42`; `mark-all-read/route.ts:29,32` | `child.receive_alerts` | guardian-row resolution | |
| Profile update `PATCH /api/parent/profile` | `parent/profile/route.ts:21-33,66` | **bespoke** Bearer→`getUser`→guardian (no `authorizeRequest`) | self-scoped to own `guardian.id` | No RBAC permission gate (PP-4); no IDOR (updates own row) |
| Consent `POST /api/parent/consent` | `parent/consent/route.ts:63-64,69` | cookie session + guardian resolution | guardian-scoped | DPDP parental consent (migration `20260527000004`) |
| Billing `GET /api/parent/billing` | `parent/billing/route.ts:39,128` | `child.view_progress` | (subscription scoped) | reads via `supabaseAdmin` |
| WhatsApp | `supabase/functions/whatsapp-notify/` | (Edge — not parent-invoked directly from these routes) | — | parent-facing comms producer |

---

## 5. Onboarding integrity (P15) touch-points

- Parent auth has two transports, both handled: cookie session (`createSupabaseServerClient`) and Bearer JWT (mobile / Edge). The chat route explicitly honors both (chat/route.ts:84-107).
- Parent link funnel = A1–A4 above. The consent-based path (A1, approve-link) is pinned by REG-117; the OTP path (A2) is pinned by `src/__tests__/api/link-code-otp.test.ts`.
- Bootstrap/link-status fail-soft pinned by REG-110/REG-111 (referenced only in `auth-module-migration-canaries.test.ts`).
- Link-code brute-force defense: server-side on the OTP routes (A2) and (per the deprecation banner) the canonical path; **absent** on the legacy Edge `parent_login` (A4) — only client-side lockout exists there.

---

## 6. Existing test coverage (for GAP cross-reference)

`src/__tests__/`: `api/parent/approve-link/*`, `api/parent/parent-calendar.test.ts`,
`api/link-code-otp.test.ts`, `parent-billing.test.ts`, `parent-child-erasure.test.ts`,
`parent-child-export.test.ts`, `parent-consent.test.ts`, `parent-dashboard-data.test.ts`,
`parent-notifications.test.ts`, `parent-portal-api.test.ts`,
`parent-report-generator-security.test.ts`, `parent-children-link.test.ts`,
`lib/domains/relationship.test.ts`, `api/v2/parent/*`,
`components/parent/parent-unified-auth.test.tsx`, `api/track-b/invite-guardian.test.ts`.

Gap-relevant absence: no test asserts the Edge `parent_login` consent posture
(A4 creating `active` without approval), and no test pins PostgREST-filter
escaping of `link_code` (PP-2).
