# Parent Portal — Gap Analysis (GAP phase)

Engineering Audit Cycle 7 · Backend agent · ANALYSIS ONLY
Repo: `D:\Alfa_local\Alfanumrik` · Date: 2026-06-29

Per-gap schema: ID | Title | Evidence (file:line) | Business impact |
Technical impact | Severity | Likelihood | Recommendation | Est. effort |
Fix classification.

Required-question verdicts up front (details in the gaps + the "Compliant"
section):
- **IDOR (parent reads an unlinked child)?** No IDOR found on the canonical
  routes — every `student_id`-bearing route verifies the link before returning
  data. One *consent-model* weakness (PP-1) lets a parent who possesses a link
  code obtain an *active* link with no approval, but that is an authorization-
  by-secret weakness, not a parameter-tampering IDOR.
- **Boundary server-side AND at RLS (defense-in-depth)?** Partially. Only the
  child Foxy-chat route is RLS-backed; all other child-data reads are app-only
  (PP-5).
- **Link/approve abuse (guessable code, missing approval, no rate limit)?**
  Yes on the legacy Edge `parent_login` path (PP-1) — no approval, no server
  rate limit. The OTP path is hardened.
- **PII leak to a non-linked parent / in logs?** None found; deny paths carry
  no payload and logs are UUID-only. One latent risk if the app check were
  bypassed (PP-5).
- **`authorizeRequest` on every parent mutating route?** All but one
  (`/api/parent/profile`, PP-4) — and that one is self-scoped, not an IDOR.
- **P15 funnel handles all branches?** Yes for the canonical paths; the four
  parallel link-creation flows are a consistency/consent risk (PP-3).
- **Bilingual gaps?** Server-generated insight/tip/report strings are
  English-only (PP-7).

---

## PP-1 — Legacy Edge `parent_login` grants an `active` link from a link code alone (no approval, no server rate limit)

- **Evidence**: `supabase/functions/parent-portal/index.ts` — `handleParentLogin` inserts links with `status: 'active', is_verified: true` on a bare link-code match (`129-138`, `223-231`); no student-approval step and no per-IP/per-code rate limit anywhere in the function. Main handler requires a Bearer JWT (`1140-1156`) but not a consent step. Client-side-only lockout in `src/app/parent/_components/parent-session.ts:99-138` (sessionStorage; bypassable). Contrast with the OTP path (`link-code/redeem/route.ts:82-99,167-263`) and the consent path (`approve-link/route.ts:108-120`).
- **Business impact**: Anyone who learns a child's link code — a tuition centre, a non-custodial adult, a leaked screenshot — and has (or creates) an authenticated account can self-attach as an `active` guardian and read the full child dashboard (progress, accuracy, streaks, chats via the chat route, attendance, reports). DPDP child-data + parental-consent exposure; reputational/legal risk.
- **Technical impact**: Creates an `active` link that `canAccessStudent` / `is_guardian_of()` treat as fully equivalent to a student-approved `approved` link, so every downstream P13 boundary opens. Bypasses the consent gate the rest of the system was built around (A1/A2).
- **Severity**: High.
- **Likelihood**: Medium — requires possession of a valid link code AND an authenticated session; mitigated since 2026-04-29 (cannot impersonate an *existing* guardian, JWT now mandatory), but the consent gap and missing server rate limit remain.
- **Recommendation**: (a) Server-side rate-limit the Edge Function `parent_login` action (mirror the OTP route's `checkApiRateLimit`). (b) Have `parent_login` create links as `pending` and require approval (A1) or OTP (A2) before `active` — i.e. retire the link-code-only auto-active path. (c) Or fully deprecate `parent_login` now that `/api/v2/parent/*` is canonical (the banner at `index.ts:13-15` already flags it).
- **Est. effort**: (a) 0.5 day (AUTO-FIX-SAFE). (b)/(c) change the **consent/link model** → **REQUIRES USER APPROVAL**.
- **Fix classification**: rate-limit = AUTO-FIX-SAFE; consent-model change = REQUIRES USER APPROVAL.

---

## PP-2 — PostgREST filter built by string-interpolating an un-escaped `link_code`

- **Evidence**: `.or(\`invite_code.eq.${linkCode},link_code.eq.${linkCode}\`)` with `linkCode` only `.trim().toUpperCase()`-ed, never escaped, in:
  - `src/app/api/parent/link-code/request-otp/route.ts:153`
  - `src/app/api/parent/accept-invite/route.ts:119`
  - `supabase/functions/parent-portal/index.ts:86`
- **Business impact**: A crafted code containing PostgREST control characters (comma, `.`, `(` `)`, `*`) could broaden or alter the `.or()` filter — at worst matching a student the caller never had the real code for, feeding the wrong `student_id` into the OTP challenge / link RPC.
- **Technical impact**: PostgREST filter-injection class. `.eq` values containing commas split into extra filter terms; `*` becomes a wildcard in some operators. Risk is bounded by `.eq.` (not `.like.`) and the uppercase normalization, but the pattern is unsafe by construction.
- **Severity**: Medium.
- **Likelihood**: Low-Medium — needs a deliberately crafted code; current callers pass user input straight through.
- **Recommendation**: Validate `link_code` against a strict charset (`^[A-Z0-9]{4,12}$`) before use, and/or replace the interpolated `.or()` with two parameterized `.eq()` queries or an RPC. Add a regression test feeding `A,deleted_at.is.null` style payloads.
- **Est. effort**: 0.5 day. **AUTO-FIX-SAFE** (input validation; no behavior change for valid codes).

---

## PP-3 — Four parallel link-creation paths with divergent security postures and terminal statuses

- **Evidence**: A1 `approve-link` (→`approved`, consent), A2 `link-code/redeem` (OTP, RPC), A3 `accept-invite` (→`approved`, emailed code), A4 Edge `parent_login` (→`active`, no consent). Status set in `index.ts:131,225`; `approve-link/route.ts:115`; RPCs `link_guardian_to_student_via_code` / `link_guardian_via_invite_code`. `ACTIVE_GUARDIAN_LINK_STATUSES` treats `active` and `approved` identically (`relationship.ts:146,207,328`).
- **Business impact**: The weakest path (A4) defines the effective consent guarantee. Audit/compliance cannot state a single "how a parent gets linked" story; DPDP consent evidence differs per path.
- **Technical impact**: Two semantically-equal terminal statuses (`active` vs `approved`) and four writers make it easy to regress one path's checks without noticing. No single choke-point for link creation.
- **Severity**: Medium.
- **Likelihood**: Medium (maintenance/regression risk).
- **Recommendation**: Converge on one link-create choke-point (a single RPC) and one terminal status; document which path each client uses. Surface only — do not change behavior unilaterally.
- **Est. effort**: 1-2 days. **REQUIRES USER APPROVAL** (changes the link/consent model).

---

## PP-4 — `PATCH /api/parent/profile` has no `authorizeRequest` RBAC gate

- **Evidence**: `src/app/api/parent/profile/route.ts:21-33` — bespoke `Bearer → supabaseAdmin.auth.getUser(token) → getGuardianByAuthUserId`; no `authorizeRequest(request, 'permission.code')`. Update is scoped to the resolved own `guardianId` (66), so no IDOR.
- **Business impact**: Low — a guardian can only edit their own name/phone. But it diverges from the P9 pattern every other parent route follows.
- **Technical impact**: No permission-code enforcement; relies solely on token→guardian resolution. If `getGuardianByAuthUserId` semantics ever change, there is no RBAC backstop.
- **Severity**: Low.
- **Likelihood**: Low.
- **Recommendation**: Wrap in `authorizeRequest(request, 'parent.profile.update')` (or the nearest existing granted code) for consistency, keeping the self-scoped update. Confirm the permission is already granted to the guardian role (architect) before adding.
- **Est. effort**: 0.25 day. **AUTO-FIX-SAFE** if reusing an already-granted permission code; **REQUIRES USER APPROVAL** if a new permission code must be added.

---

## PP-5 — Child-data reads are app-only (no RLS defense-in-depth) except the Foxy-chat route

- **Evidence**: `canAccessStudent` runs on the service client (`rbac.ts:244`, bypasses RLS). Child-data routes then read via `supabaseAdmin` (report `report/route.ts:57`; calendar `calendar/route.ts:129-210`; export `export/route.ts:188-259`; billing `billing/route.ts:128`; Edge dashboard/attendance/monthly all service-role). Only `parent/children/[id]/chat/route.ts:161` reads through an RLS-scoped client (84-107), backed by `foxy_chat_messages_guardian_select` (migration `20260620000200`).
- **Business impact**: A single missed/incorrect app-layer link check on any of these routes would expose another family's child data with no DB backstop.
- **Technical impact**: P8 defense-in-depth is incomplete. The child-data *tables* do carry `is_guardian_of()` RLS, but those policies are dormant on the service-role path these routes use.
- **Severity**: Medium.
- **Likelihood**: Low (current checks are present and correct), but high blast radius if regressed.
- **Recommendation**: Where feasible, read child data through an RLS-scoped client (as the chat route does) so RLS + app form two layers. At minimum, add regression tests asserting a 403 (no payload) for an unlinked parent on each child-data route.
- **Est. effort**: 1 day for tests (AUTO-FIX-SAFE); migrating routes to RLS-scoped clients is larger and architect-owned.
- **Fix classification**: tests = AUTO-FIX-SAFE; client migration = architect review.

---

## PP-6 — Two interchangeable boundary helpers (`canAccessStudent` vs `isGuardianLinkedToStudent`)

- **Evidence**: chat (`chat/route.ts:128`) and calendar (`calendar/route.ts:103`) use `canAccessStudent`; report (`report/route.ts:47`), glance (`glance/route.ts:71`), encourage (`encourage/route.ts:35`) use `getGuardianByAuthUserId`+`isGuardianLinkedToStudent`; export uses `listChildrenForGuardian` (`export/route.ts:146`). All enforce `status IN ('active','approved')`.
- **Business impact**: Low (all equivalent today).
- **Technical impact**: Three ways to express the same boundary; a future change to the status set (e.g. adding a `suspended` status) must be made in 3+ places or they drift.
- **Severity**: Low.
- **Likelihood**: Medium.
- **Recommendation**: Standardize parent child-data routes on a single boundary helper; have the others delegate to it. Document `canAccessStudent` as the canonical cross-role boundary (mirrors the teacher-side convention).
- **Est. effort**: 0.5 day. **AUTO-FIX-SAFE** (refactor, behavior-preserving).

---

## PP-7 — Server-generated parent insight / tip / report strings are English-only (P7)

- **Evidence**: Edge `parent-portal` emits English `insights` (`index.ts:498-502`), static `tips` (`790-826`) and `generateTips` strings (`1041-1107`); `/api/v2/parent/glance` builds English `highlights`/`concerns`/`suggestion` (`glance/route.ts:163-195`) with the comment "client renders bilingually (P7)".
- **Business impact**: Hindi-preferring parents may see dynamic narrative text only in English, weakening the bilingual promise on a parent-facing surface.
- **Technical impact**: These are free-form English strings, not i18n keys, so the client cannot translate them deterministically. P7 compliance depends on a client translation layer that, for dynamic strings, likely does not exist.
- **Severity**: Medium.
- **Likelihood**: High for Hindi-mode parents viewing insights/tips.
- **Recommendation**: Emit structured keys + params (or pre-render both `en` and `hi`) for insights/tips/glance moments, mirroring how the AI weekly report already accepts `language: 'en'|'hi'` (`report/route.ts:34`). Verify the parent UI's rendering of these fields.
- **Est. effort**: 1 day (server emits keyed strings) + frontend review. **AUTO-FIX-SAFE** server-side; needs frontend review for the render.

---

## Compliant / strong (explicitly noted)

- **No parameter-tampering IDOR** on canonical routes: every `student_id`-bearing route verifies the link before returning data (report 47-53, glance 71-82, calendar 103, chat 128, export 146-170, encourage, Edge handlers 639-655/848-858/911-927). Thread messages enforce strict `thread.guardian_id === guardian.id` (`threads/[id]/messages/route.ts:67`).
- **Deny paths carry no payload** (P13): chat 403 returns no data and audits `reason: 'not_linked'` (chat/route.ts:129-142); export, glance, report likewise return `{success:false,error}` only.
- **PII-safe logging** (P13): routes log UUIDs/counts only; link codes truncated (`accept-invite/route.ts:37-39`); encourage logs UUIDs only (31); chat never logs message text (59-61), audits `message_count` only (206-211).
- **OTP path is well hardened** (A2): per-IP + per-challenge rate limits, constant-time compare, silent-success enumeration defense, full `auth_audit_log` trail (`request-otp` + `redeem` routes).
- **Edge Function P13 hardening**: trusts the Bearer JWT, ignores `body.auth_user_id`, overrides `body.guardian_id` with the JWT-resolved guardian (`index.ts:1130-1169`); the prior impersonation bug is fixed (152-195).
- **approve-link** correctly rejects non-owning students with a generic 404 (no info leak) and uses service role only for the write the student legitimately can't do under RLS (`approve-link/route.ts:108-120`).
- **RLS on `guardian_student_links`** is enabled with guardian-scoped SELECT/INSERT/UPDATE + service-role policy (baseline 19837-19958); `is_guardian_of()` enforces the approved/active boundary at the DB for child-data tables.
- **RBAC permission gates present** on all parent routes except `/api/parent/profile` (PP-4): `child.view_progress`, `child.receive_alerts`, `child.encourage`.
