# Parent Portal — Root-Cause Analysis (ROOT-CAUSE phase)

Engineering Audit Cycle 7 · Backend agent · ANALYSIS ONLY
Repo: `D:\Alfa_local\Alfanumrik` · Date: 2026-06-29

For each significant gap: the true root cause and the layer that introduced it.

---

## PP-1 — `parent_login` grants `active` links without consent or server rate limit

- **Root cause**: The Edge Function `parent-portal` is the **original (pre-RBAC, demo-era) parent entry point**. It was written when "enter a link code, see your child" was the entire product, before the consent flow (`approve-link`, REG-117) and the OTP flow (`link_code_otp`, migration `20260527000005`) existed. It encodes the old trust model — *possession of the code IS the authorization* — and writes `status:'active', is_verified:true` directly. The newer, safer paths were added *alongside* it rather than replacing it; the function was only ever soft-deprecated (the `logDeprecatedEdgeFunctionHit` banner) and its security model never re-baselined to the consent era.
- **Introducing layer**: Backend / Edge Functions (the legacy `parent-portal` Deno function). The 2026-04-29 patch closed the *impersonation* hole but deliberately left the link-create posture (`active`, no approval) and added no rate limit.
- **Why it persisted**: No regression test pins the consent posture of `parent_login` (the A4 path), so its divergence from A1/A2 is invisible to CI. The client-side lockout (`parent-session.ts`) created a *false sense* of brute-force protection that does not apply to direct Edge calls.

## PP-2 — Un-escaped `link_code` interpolated into PostgREST `.or()`

- **Root cause**: The "match invite_code OR link_code" requirement has no first-class PostgREST helper, so the original author hand-built the `.or()` filter string and copied it to each new caller (request-otp, accept-invite, Edge). `linkCode` was normalized for *correctness* (`.toUpperCase()`) but never for *safety* (escaping/charset validation), because the author reasoned the value is a short code, not free text.
- **Introducing layer**: Backend (parent link routes) + Edge Function — copy-paste propagation of an unsafe query-construction idiom. No shared, validated `resolveStudentByCode()` helper exists, so each copy repeats the flaw.
- **Why it persisted**: PostgREST string filters are not flagged by ESLint or the content-check hook (those target secrets, XP literals, integer grades). The class is invisible to the existing guardrails.

## PP-3 — Four parallel link-creation paths

- **Root cause**: Feature accretion without a designated link-creation choke-point. Each new requirement (student-initiated approval, 2FA, minor auto-invite, legacy demo login) added its own writer to `guardian_student_links` rather than funneling through one RPC. The dual terminal statuses (`active` from the demo era, `approved` from the consent era) were reconciled *downstream* (`ACTIVE_GUARDIAN_LINK_STATUSES`) instead of *upstream*, cementing both as permanent.
- **Introducing layer**: Architecture / backend — absence of a single domain owner for "create a guardian link". The `relationship.ts` domain module deliberately scoped itself to **reads only** ("Writes ... stay in the route handlers", `relationship.ts:13-15`), so no module owns the write path where consolidation would naturally live.
- **Why it persisted**: Each path has tests in isolation; none asserts cross-path equivalence or a single consent invariant.

## PP-4 — `/api/parent/profile` lacks `authorizeRequest`

- **Root cause**: The route was extracted from a direct client-side anon write in `parent/profile/page.tsx` (per its own header comment) and the author reproduced the *minimum* server check needed to stop the client write (token→guardian), not the full P9 pattern used by sibling routes. The self-scoped update made the missing permission gate feel harmless.
- **Introducing layer**: Backend — an incremental "lift the client write to the server" change that under-applied the house auth convention.
- **Why it persisted**: It is functionally safe (no IDOR), so neither tests nor review flagged it; the gap is consistency, not exposure.

## PP-5 — App-only boundary on child-data reads (no RLS defense-in-depth)

- **Root cause**: `canAccessStudent` was designed as the *single app-layer* cross-role boundary and deliberately runs on the service client so it can resolve `guardians`/`guardian_student_links` (which the calling parent cannot read directly under RLS). Routes then naturally continued on `supabaseAdmin` for the actual data read — the path of least resistance — so the read inherits no RLS. The Foxy-chat route is the *only* one retrofitted to an RLS-scoped client, and only because the 2026-06-20 remediation explicitly added the `is_guardian_of()` read policy as a DB backstop for that newly-exposed PII surface.
- **Introducing layer**: Backend pattern + Architecture. The convention "authorize once at the top, then read with admin" is efficient but trades away the second (DB) layer for everything except chat.
- **Why it persisted**: Single-layer enforcement is correct as long as the app check is present, so it tests green. Defense-in-depth gaps only surface under a *future* regression, which current tests do not simulate.

## PP-6 — Two interchangeable boundary helpers

- **Root cause**: `canAccessStudent` (rbac.ts) and `isGuardianLinkedToStudent` (relationship.ts) were introduced by different efforts (cross-role RBAC vs the relationship-domain extraction) and both survived. Newer v2 routes adopted the domain helper (it returns the resolved `guardian` they also need), while older routes kept `canAccessStudent`.
- **Introducing layer**: Backend — parallel evolution of two modules with overlapping responsibility and no deprecation of either.
- **Why it persisted**: Both are correct; there is no forcing function to converge.

## PP-7 — English-only server-generated parent narrative strings

- **Root cause**: The parent dashboard/insights/tips predate the structured-bilingual discipline applied to newer surfaces. Insight and tip text was authored as inline English strings (fastest path to shipping a parent dashboard) on the assumption the client would translate — but free-form strings cannot be keyed for translation after the fact. The AI weekly report *did* get a `language` parameter (the right pattern), but the dashboard insights/tips/glance moments did not.
- **Introducing layer**: Backend / Edge Function — content authored as literals rather than i18n keys; the P7 obligation was deferred to "the client renders bilingually" without a key contract that makes that possible.
- **Why it persisted**: P7 has no automated parity test on the broader critical-surface set (constitution: "No regression test yet enforces Hi/En parity on the broader critical-surface set"), so English-only dynamic strings pass CI.

---

## Cross-cutting theme

Most parent-portal gaps trace to **the same structural fact**: the portal was
built in **two eras** — a demo/link-code era (Edge `parent-portal`, `active`
links, English literals, app-only reads) and a consent/RBAC era (`approve-link`,
OTP, `authorizeRequest`, `is_guardian_of()` RLS, `relationship.ts`). The newer
era was added **alongside** the older one rather than **replacing** it, leaving
a weaker legacy path live (PP-1), duplicated idioms (PP-2, PP-6), and deferred
obligations (PP-5 defense-in-depth, PP-7 bilingual). The single highest-leverage
remediation is to **retire/replace the legacy Edge `parent_login` link-create
path and converge link creation on one consent-respecting choke-point** — which
collapses PP-1 and most of PP-3 at once. That step changes the consent/link
model and therefore **requires user approval**.
