# Parent Portal — Implementation (IMPLEMENT phase)

Engineering Audit Cycle 7 · Backend agent · IMPLEMENTATION
Repo: `D:\Alfa_local\Alfanumrik` · Date: 2026-06-29

Implements the **auto-fix-safe** parts of PP-2, PP-1 (rate-limit half), PP-4.
Consent/link MODEL untouched. No RBAC roles/permissions added or altered.

---

## Files changed

### New — shared validator (PP-2)
- **`supabase/functions/_shared/link-code.ts`** (new)
  - `export const LINK_CODE_RE = /^[A-Z0-9]{4,12}$/`
  - `export function isValidLinkCode(code: string): boolean`
  - Deno/Edge twin of the `src/lib/sanitize.ts` helper (deploy-boundary forces a
    synchronized copy; documented in both files).

### `src/lib/sanitize.ts` (PP-2)
- Added `LINK_CODE_RE` + `isValidLinkCode()` (above the `isValidGrade` helper),
  with the format rationale (6-char `link_code` / 8-char `invite_code`, both
  `[A-Z0-9]`) and the cross-reference to the Edge twin.

### `src/app/api/parent/link-code/request-otp/route.ts` (PP-2)
- Import: `normalizeIP, isValidLinkCode` from `@/lib/sanitize`.
- After `const linkCode = linkCodeRaw.trim().toUpperCase();` (was line 141),
  **before** the `.or('invite_code.eq.${linkCode},link_code.eq.${linkCode}')`
  lookup (was line 153):
  - **Before**: normalized code flowed straight into the `.or()` filter.
  - **After**: `if (!isValidLinkCode(linkCode)) { audit('link_code_otp_request_invalid_format', {prefix,length}); return silentSuccess(); }`
  - Preserves the route's enumeration-safe `silentSuccess()` contract.

### `src/app/api/parent/accept-invite/route.ts` (PP-2)
- Import: `isValidLinkCode` from `@/lib/sanitize`.
- After `const linkCode = linkCodeRaw.trim().toUpperCase();` (was line 65),
  **before** the redeem RPC + the `.or()` student lookup (was line 119):
  - **Before**: normalized code flowed into the RPC and the `.or()` filter.
  - **After**: `if (!isValidLinkCode(linkCode)) return err('Invalid or expired invite code', 409);`
  - Same generic shape as a domain rejection (no leak).

### `supabase/functions/parent-portal/index.ts` (PP-1 rate-limit + PP-2)
- Imports added: `isValidLinkCode` from `../_shared/link-code.ts`,
  `createRateLimiter` from `../_shared/rate-limiter.ts`.
- New module-level block before the action handlers:
  - `PARENT_LOGIN_IP_LIMIT = 5`, `PARENT_LOGIN_IP_WINDOW_MS = 60*60*1000`,
    `parentLoginIpLimiter = createRateLimiter(...)`, `getClientIp(req)`.
  - In-code `TODO(PP-1, USER-GATED)` documenting that the consent-posture fix is
    NOT done here and requires user approval.
- `handleParentLogin(...)` signature gained `clientIp: string = 'unknown'`.
  - **PP-1 (Before)**: no server rate limit anywhere in the function; only the
    client-side `parent-session.ts` lockout existed.
  - **PP-1 (After)**: first statement is the per-IP limiter check; on exceed →
    `429 { error: 'Too many attempts…' }` + `Retry-After`, PII-safe `console.warn`
    (limits/counts only). Applied BEFORE any DB lookup.
  - **PP-2 (Before)**: `linkCode` flowed straight into
    `.or('invite_code.eq.${linkCode},link_code.eq.${linkCode}')` (was line 86).
  - **PP-2 (After)**: after `if (!linkCode)`, added
    `if (!isValidLinkCode(linkCode)) return <same 200 'Invalid link code' response>;`
- Dispatch site (was line 1155): `handleParentLogin(body, origin, authUserId)` →
  `handleParentLogin(body, origin, authUserId, getClientIp(req))`.

### `src/app/api/parent/profile/route.ts` (PP-4)
- Import added: `authorizeRequest` from `@/lib/rbac`.
- **Before**: bespoke `Bearer → supabaseAdmin.auth.getUser(token) →
  getGuardianByAuthUserId(user.id)`; no `authorizeRequest`.
- **After**:
  ```
  const auth = await authorizeRequest(request, 'profile.update_own');
  if (!auth.authorized) return auth.errorResponse!;
  const guardianResult = await getGuardianByAuthUserId(auth.userId!);
  ```
- `profile.update_own` is already granted to the `parent` role
  (`20260612123200_rbac_matrix_conformance.sql:238`) — **no new permission**.
- The manual Bearer parsing is removed; `authorizeRequest` accepts Bearer JWT
  AND cookie session (superset — existing callers unaffected).

---

## Invariant rationale

### P9 (RBAC enforcement)
- PP-4: `PATCH /api/parent/profile` now gates on `authorizeRequest(request,
  'profile.update_own')` — the house pattern. The permission is pre-granted to
  the parent role; no role/permission was added or altered (those are USER-GATED).

### P8 / P13 (RLS boundary + data privacy)
- PP-2: the validator runs purely on caller input before any query; it does not
  change which client (service vs RLS-scoped) reads data, so the existing RLS
  posture is unchanged. Rejecting malformed codes can only *narrow* what a query
  can match — it never broadens access.
- PP-1: rate-limit denial returns a generic 429 with **no** child/guardian
  payload. The new `console.warn` logs limits/counts/`retry_after_ms` only —
  never the IP, the link code, or any name/email/phone (P13). The `request-otp`
  invalid-format audit logs a 2-char prefix + length only (matches the existing
  no-match audit style).
- PP-4: update remains scoped to the caller's OWN guardian row (resolved from
  `auth.userId`); no body-supplied id is used to select the row — **no IDOR**,
  and the student-data boundary is unaffected.

### Consent/link model + format
- The link-code FORMAT is unchanged (validator only rejects out-of-format input).
- The consent posture of `parent_login` (link-code-only → `active`) is
  **unchanged** — only the brute-force rate limit was added. The consent fix is
  explicitly deferred to the user (in-code TODO + 04-solution-design.md).

---

## Self-review

- [x] PP-2 validation added at ALL THREE `.or()` interpolation sites
      (request-otp, accept-invite, Edge `parent_login`) via one shared validator
      (two synchronized copies for the deploy boundary).
- [x] Validator regex `^[A-Z0-9]{4,12}$` blocks every PostgREST filter
      metacharacter and accepts both the 6-char `link_code` and 8-char
      `invite_code` formats.
- [x] Each site preserves its existing rejection posture (silent-success /
      generic-409 / generic-200) — no behavior change for VALID codes.
- [x] PP-1 server-side per-IP rate limit added to `handleParentLogin`, applied
      before any DB lookup, mirroring the OTP request path's per-IP bound.
- [x] No consent-model change; `TODO(PP-1, USER-GATED)` left in code.
- [x] PP-4 uses an already-granted permission (`profile.update_own`); no new
      RBAC; self-scope/no-IDOR confirmed.
- [x] P13: no PII (name/email/phone/raw link code/IP) in any new log; IDs,
      counts, truncated-prefix, and limits only.
- [x] `npm run type-check` — PASS.
- [x] `npm run lint` (eslint on the 4 changed Next.js files) — clean, 0 findings.
- [x] `deno check supabase/functions/parent-portal/index.ts` — my added code is
      clean. 4 PRE-EXISTING errors remain in `handleGetChildDashboard`
      (lines 603/605/629/630, `todayStudyTime`/`todayQuizzes` inferred as `{}`);
      verified present on the pre-change (stashed) file, unrelated to this change,
      and intentionally NOT fixed (out of scope, behavior-preserving constraint).

---

### tests (testing)

**5 new test files · 71 new tests** (all PASS). They contribute to the **104/104
target** parent/guardian run; the **404/404 broad** parent/guardian suite stays
green. → regression catalog **REG-188 / REG-189 / REG-190**.

| # | Test file | Pins | Gap | REG |
|---|---|---|---|---|
| 1 | `parent-link-code-injection.test.ts` | PostgREST `.or()` filter-injection — crafted codes (`A,deleted_at.is.null`, `A.B`, `A*`, `A(`, `A:1`, comma/paren/star/colon/quote/whitespace payloads) are rejected by `isValidLinkCode` BEFORE the `.or()` lookup at all 3 sites; each site keeps its posture (request-otp → enumeration-safe `silentSuccess`, accept-invite → generic 409, Edge `parent_login` → 200 no-match); valid 6-char `link_code` + 8-char `invite_code` pass unchanged | PP-2 | REG-188 |
| 2 | `parent-link-code-shared-validator.test.ts` | `isValidLinkCode`/`LINK_CODE_RE` (`^[A-Z0-9]{4,12}$`) accept/reject table + **byte-identical Next.js (`src/lib/sanitize.ts`) ↔ Deno (`supabase/functions/_shared/link-code.ts`) twin parity** (same regex source, same verdicts) so the deploy-boundary copies cannot drift | PP-2 | REG-188 |
| 3 | `parent-login-rate-limit.test.ts` | Edge `handleParentLogin` per-IP rate limit — 5 attempts/hour, 6th → **429 + `Retry-After`**, applied BEFORE any DB lookup; PII-safe warn (limits/counts/`retry_after_ms` only — never IP / link code / name / email / phone); mirrors the hardened OTP path's per-IP bound | PP-1 | REG-189 |
| 4 | `parent-profile-authz.test.ts` | `PATCH /api/parent/profile` gates on `authorizeRequest('profile.update_own')` (already-granted parent permission — no new RBAC) → 401/403 before any write when unauthorized; self-scoped to `auth.userId` (no body-supplied id → **no IDOR**); accepts both Bearer JWT and cookie session (superset) | PP-4 | REG-190 |
| 5 | `parent-child-data-deny.test.ts` | unlinked-parent **deny across all 9 child-data routes** (glance, report, calendar, child Foxy chat, export, request-erasure, erasure-status, encourage, messages-thread-create) → **403, no child payload** on every deny path; canonical guardian-link boundary (`status IN ('active','approved')`) pinned for both `canAccessStudent` and `isGuardianLinkedToStudent` | PP-5 | REG-190 |

**Gate totals:** type-check **PASS** · lint **0 errors** · **104/104 target + 404/404
broad** parent/guardian tests **PASS** · build **PASS** · no bundle impact (the
4 changed runtime files are server routes + one Deno Edge Function; the shared
validator is a tiny pure module; test files have no bundle footprint).

**Catalog:** **REG-188** (PP-2 link-code filter-injection + shared-validator twin parity),
**REG-189** (PP-1 per-IP brute-force rate limit on `parent_login`), **REG-190** (PP-4
profile authz gate + PP-5 unlinked-parent deny across all 9 child-data routes) →
catalog **154 → 157**. Existing parent-funnel entries **REG-110 / REG-111 / REG-117**
remain green.
