# Parent Portal — Solution Design (SOLUTION phase)

Engineering Audit Cycle 7 · Backend agent · DESIGN
Repo: `D:\Alfa_local\Alfanumrik` · Date: 2026-06-29

Scope of THIS phase: the **auto-fix-safe** parts of PP-1, PP-2, PP-4 only.
The consent/link MODEL is untouched — PP-1's consent-posture half and PP-3
consolidation are USER-GATED and are surfaced (not changed) below.

---

## PP-2 (MEDIUM, filter-injection) — validate/escape `link_code` before PostgREST `.or()`

### Root of the issue
`link_code` (or the equivalent `invite_code`) was interpolated **un-escaped**
into a PostgREST `.or()` string at three sites:

- `src/app/api/parent/link-code/request-otp/route.ts:153`
- `src/app/api/parent/accept-invite/route.ts:119`
- `supabase/functions/parent-portal/index.ts:86` (inside `handleParentLogin`)

The value was only `.trim().toUpperCase()`-ed — normalized for *correctness*,
never validated for *safety*. PostgREST treats `,` `.` `(` `)` `*` `:` as filter
control characters, so a crafted code such as `A,deleted_at.is.null` could split
into extra filter terms and broaden/alter the query.

### Link-code FORMAT validated against (determined from how codes are generated)
All link/invite codes are **server-generated** and are always a subset of
`[A-Z0-9]`:

| Source | Generator (baseline `00000000000000_baseline_from_prod.sql`) | Shape |
|---|---|---|
| `students.link_code` | `generate_link_code()` trigger → `upper(substr(md5(...),1,6))` | 6 uppercase hex |
| `students.invite_code` | column default → `upper(encode(gen_random_bytes(4),'hex'))` | 8 uppercase hex |
| `guardian_student_links.link_code` | `generate_parent_link_code()` → `upper(substr(md5(...),1,6))` | 6 uppercase hex |

The `.or()` matches `invite_code` (8) **OR** `link_code` (6), so the validator
must accept both. **Format is NOT changed** — we only reject values that fall
outside it.

### Fix
A single shared, strict validator applied at **every** interpolation site,
AFTER the existing `.trim().toUpperCase()` normalization:

```
LINK_CODE_RE = /^[A-Z0-9]{4,12}$/   // 4–12 covers the 6- and 8-char forms with margin
isValidLinkCode(code) = LINK_CODE_RE.test(code)
```

`[A-Z0-9]` admits **no** PostgREST metacharacter (`,` `.` `(` `)` `*` `:` quotes,
whitespace), so a malformed code can never reach the query. Width 4–12 leaves
headroom for both formats without widening the attack surface. (We deliberately
use the full alphanumeric class rather than the tighter `[A-F0-9]` hex class so
the guard is robust to any non-hex code source while still blocking every
filter control character.)

No first-class PostgREST escaper exists in the codebase, and there was no shared
`resolveStudentByCode()` helper (each call hand-built the `.or()`), so a strict
charset guard is the clean fix per the gap-analysis recommendation.

### Shared util — two synchronized copies (deploy-boundary constraint)
The Deno/Edge runtime cannot import from `src/` (only `supabase/functions/**`
ships to the Edge), exactly as `_shared/rate-limiter.ts` documents. So the
validator is an intentional twin:

- `src/lib/sanitize.ts` → `isValidLinkCode` / `LINK_CODE_RE` (Next.js routes)
- `supabase/functions/_shared/link-code.ts` → identical `isValidLinkCode` / `LINK_CODE_RE` (Edge)

Both carry a cross-reference comment requiring they be kept in sync.

### Per-site rejection behavior (preserves each route's existing posture)
- **request-otp**: invalid format → audit `link_code_otp_request_invalid_format`
  (prefix + length only) → `silentSuccess()`. Keeps the route's enumeration-safe
  contract (indistinguishable from a valid-but-unknown code).
- **accept-invite**: invalid format → `err('Invalid or expired invite code', 409)`
  — the same generic shape as a domain rejection (no leak about which check failed).
- **Edge `parent_login`**: invalid format → the same `200 { error: 'Invalid link
  code…' }` it already returns for a genuine no-match.

---

## PP-1 (HIGH — auto-fix-safe HALF only) — server-side rate limit on the legacy Edge `parent_login` path

### Root of the issue
`handleParentLogin` creates an `active`, `is_verified:true` guardian link from a
bare link-code match. The only brute-force protection was **client-side**
(`src/app/parent/_components/parent-session.ts`, sessionStorage lockout) —
trivially bypassed by calling the Edge Function directly. A 6-uppercase-hex code
is grindable server-side with no server limiter.

### Fix (mirrors the hardened OTP path's per-IP bound)
Add a **server-side per-IP rate limit** to `handleParentLogin`, applied BEFORE
any DB lookup (mirroring `request-otp`'s "apply before we touch the DB"):

```
PARENT_LOGIN_IP_LIMIT     = 5
PARENT_LOGIN_IP_WINDOW_MS = 60 * 60 * 1000   // 1 hour — mirrors REQUEST_OTP_IP_LIMIT (5/hour)
parentLoginIpLimiter      = createRateLimiter(PARENT_LOGIN_IP_LIMIT, PARENT_LOGIN_IP_WINDOW_MS)
```

On exceed: `429` with a generic body + `Retry-After` header, and a PII-safe
`console.warn` (limits/counts/retry only — never the IP, link code, or any PII).
The IP is derived from `x-forwarded-for` (first hop) / `x-real-ip`, matching the
OTP path's `normalizeIP`.

### Mechanism choice (why in-memory, and the durable follow-up)
The OTP path uses the Next.js Upstash-backed `checkApiRateLimit`. That limiter is
**not reachable from the Deno runtime** (it lives behind the supabase/ ↔ src/
deploy boundary). The limiter that IS available — and that every other Edge
Function (foxy, quiz) already uses — is `_shared/rate-limiter.ts`'s in-memory
sliding-window `createRateLimiter`. We reuse it.

Limitation (documented in-code): the in-memory store is per-instance and resets
on cold start, so it bounds rapid enumeration through a *warm* instance but is
weaker than a distributed store. The durable hardening is either an Upstash/DB-
backed shared counter OR retiring this path entirely (the gated consent fix
below collapses the whole problem). Captured as an in-code TODO.

### GATED — consent-posture half (NOT done here; owner = user)
> **PP-1 consent fix is USER-GATED.** The deeper remediation — have
> `parent_login` create links as `pending` and require student approval (A1) or
> OTP (A2) before `active`, OR fully deprecate `parent_login` now that
> `/api/v2/parent/*` is canonical — **changes the consent/link MODEL** and
> therefore **requires user approval**. This phase ONLY adds the brute-force
> rate limit + the PP-2 input validation. A clear `TODO(PP-1, USER-GATED)` is
> left at the top of `handleParentLogin`'s rate-limit block. **Owner: user.**

---

## PP-4 (LOW) — auth gate on `PATCH /api/parent/profile`

### Root of the issue
The route authenticated with a bespoke `Bearer → supabaseAdmin.auth.getUser →
getGuardianByAuthUserId` chain and **no `authorizeRequest`** — diverging from the
P9 pattern every sibling parent route follows. It is self-scoped (updates the
caller's own resolved `guardianId`, no body-supplied id), so there is **no IDOR**
— the gap is consistency, not exposure.

### Fix (reuse an already-granted permission — no new RBAC)
`profile.update_own` is **already granted to the `parent` role** in the RBAC
matrix (`20260612123200_rbac_matrix_conformance.sql:238`), and is the same code
the student profile/shop routes use. So:

```
const auth = await authorizeRequest(request, 'profile.update_own');
if (!auth.authorized) return auth.errorResponse!;
const guardianResult = await getGuardianByAuthUserId(auth.userId!);  // self-scope
```

- **No new permission code** is created (creating one would be USER-GATED).
- `authorizeRequest` accepts BOTH the Bearer JWT this route already used and the
  Supabase cookie session, so existing callers keep working (strict superset).
- **Self-scope / no IDOR confirmed**: the update target is resolved from the
  verified `auth.userId`; the `.eq('id', guardianId)` write never reads an id
  from the request body.

---

## GATED items surfaced (NOT changed) — owner = user

| Gap | What it would change | Owner |
|---|---|---|
| **PP-1 (consent half)** | Make `parent_login` create `pending` links requiring approval/OTP, or deprecate it — changes the consent/link MODEL | user |
| **PP-3** | Converge the 4 parallel link-creation paths onto one RPC choke-point + one terminal status — changes the consent/link MODEL | user |

PP-5 (RLS defense-in-depth for child-data reads — tests are auto-fix-safe; client
migration is architect-owned), PP-6 (boundary-helper convergence), and PP-7
(bilingual server strings) are out of scope for this backend security pass and
remain as catalogued in `02-gap-analysis.md`.
