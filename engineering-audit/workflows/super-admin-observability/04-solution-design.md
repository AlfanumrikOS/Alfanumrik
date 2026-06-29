# Cycle 6 — Super-Admin & Observability — 04 SOLUTION DESIGN

Owner: ops (lead) + frontend (SAO-2 type cleanup) + testing (SAO-7, SAO-4). Scope: the AUTO-FIX-SAFE half of the cycle — the two P13 data-minimization gaps (SAO-3 egress redaction, SAO-2 field drop), the SAO-2 frontend stale-type cleanup, and the two test-only hardening gaps (SAO-7 full-surface P9 gate sweep, SAO-4 bare-name log canary). The tiering gaps (SAO-1, SAO-5) and the residual SAO-2 "raise-the-tier" branch are explicitly GATED (owner = user — DPDP-relevant admin access-model decision) and out of scope for this cycle — see the GATED section at the bottom.

> **Shipped final state (reconciled against `05-implementation.md`):** SAO-3 + SAO-2 (ops) and the SAO-2 frontend type cleanup (frontend) and SAO-7 + SAO-4 (testing) all LANDED. The SAO-2 frontend cleanup, originally written below as "deferred to frontend," was completed in-cycle (stale `email: string` decls removed from the two `top_students` type sites). SAO-7/SAO-4 are documented in the new test sections at the end.

Guiding principle (from 03-root-cause cross-cutting observation): the admin-level ladder differentiates by ACTION destructiveness, not by DATA sensitivity of reads. We are NOT touching the ladder. We are doing the complementary, ops-owned, non-gated half: **data minimization on response/export field sets + egress redaction**, so that even at the current tier no fresh PII leaves via these two paths.

---

## SAO-3 — Observability export ships `context_json` without an export-time redaction pass

### Approach: reuse the existing key-based redactor on egress (NO new scheme)

The repo already has a single source of truth for PII redaction:

- Canonical impl: `supabase/functions/_shared/redact-pii.ts` — `redactPII(value)` (deep, key-based, circular-safe; `SENSITIVE_KEYS` covers password/token/secret/api_key/authorization/cookie, email/phone/parent_phone/mobile_number, full_name/first_name/last_name, school_name/school_address, and the Razorpay/card/UPI payment surface). Membership test is `key.toLowerCase()`; adding redaction is always safe (more redaction, never less).
- Next.js re-export: `src/lib/ops-events-redactor.ts` → `export { redactPII } from '.../redact-pii'`. This is exactly the redactor `src/lib/logger.ts:18,67` already uses for in-flight log metadata.

This is the same redactor the audit (SAO-3 recommendation) and root-cause (`ops-events-redactor.ts` existed but "wasn't wired to this CSV egress") pointed at. We REUSE it; we do not invent a redaction scheme.

### Where it applies

`src/app/api/super-admin/observability/export/route.ts`. The CSV has 10 columns (`CSV_COLUMNS`, line 13-24). Of those, the only **object / free-form** column that can carry an arbitrary upstream payload is `context_json` (serialized from `row.context`, line 91). The other nine are controlled/typed scalars:

- `occurred_at`, `environment` — timestamps / enum-ish env string (non-PII).
- `category`, `source`, `severity` — controlled enums (non-PII).
- `request_id` — opaque correlation id (non-PII).
- `subject_type` / `subject_id` — type tag + UUID (UUID is an identifier, not PII content; not redacted by the key-based redactor and intentionally retained so the export remains joinable for forensics).
- `message` — a fixed ops-event template string, not a free-form user field. The key-based `redactPII` operates on object KEYS and returns plain strings unchanged, so it would be a no-op on `message`; we deliberately do NOT apply the text-regex redactor (`redactPIIInText`) here because (a) the audit scoped SAO-3 to `context`, and (b) introducing a second redaction scheme on a controlled string column is exactly the "invent a new scheme" the task forbids. If a future event template is found to interpolate user PII into `message`, that is a write-time logging fix (SAO-4 class), not an egress change.

So the fix is surgical: deep-redact `row.context` right before serialization.

### Change (exact)

- Add import: `import { redactPII } from '@/lib/ops-events-redactor';`
- Line 91: `escapeCSV(row.context ? JSON.stringify(row.context) : null)` → `escapeCSV(row.context ? JSON.stringify(redactPII(row.context)) : null)`

### Shape/format preserved

CSV header and column order are unchanged (`CSV_COLUMNS` untouched). Only the **value** inside the `context_json` cell changes, and only for rows whose context contains a sensitive key — for clean (already PII-free) context the redactor is an identity transform (it rebuilds the same object). Timestamps, levels, request ids, counts, subject ids: all intact. `escapeCSV` still runs on the final string, so quoting/escaping is unchanged. Deep/nested redaction is inherent to `redactPII`'s recursive `walk`.

---

## SAO-2 — `top_students.email` exposure at the support tier

### Decision tree (from the task)

```
Is top_students[].email consumed by ANY super-admin UI?
├── NO  → DROP the email field (data minimization, P13). Keep what the UI renders. [AUTO-FIX-SAFE]
└── YES → do NOT change behavior; report as GATED tiering decision (folds into SAO-1). [GATED]
```

### Investigation result: email is NOT consumed by any UI → DROP

Grepped `top_students` + `.email` across `src/`:

- `src/app/super-admin/learning/page.tsx`
  - Leaderboard table (lines 268-317) renders columns: **Rank, Name, Grade, XP, Streak, Assessment**. No email column. Row key is `s.id` (line 288). `s.email` is never referenced.
  - CSV export button (lines 327-329) emits `Rank,Name,Grade,XP,Streak` — `${s.name},${s.grade},${s.xp_total},${s.streak_days}`. No email.
  - Derived metrics (lines 342-356) use only `xp_total` / `streak_days`.
- `src/app/super-admin/_components/widgets/LearnerHealth.tsx` (control-room widget) — uses only `xp_total` (lines 20-21). No email.
- Type decls that LIST email but never read it: `src/app/super-admin/_components/widgets/control-room-types.ts:62` and `src/app/super-admin/learning/page.tsx:60`. These are manual interfaces; nothing dereferences `.email`.

`.email` on the `top_students` payload has **zero render/consume sites**. The leaderboard needs name + grade + xp + streak (+ id for React keys, which we keep). Email is gratuitous PII surface exactly as the gap analysis stated.

### Change (exact) — ops-owned data-contract minimization

`src/app/api/super-admin/analytics/route.ts` (the analytics route is in the ops domain):

1. Line 86 PostgREST `select`: drop `email` from the column list (`id,name,email,grade,...` → `id,name,grade,...`). Minimize at the source — email never leaves Postgres.
2. Line 107 `safeJson<...>` row type: drop `email: string`.
3. Lines 184-192 `top_students` map: drop `email: s.email`.

### Frontend type cleanup (LANDED in-cycle, non-breaking)

`control-room-types.ts:62` and `learning/page.tsx:60` declared `email: string` on the `top_students` element type. This is a FRONTEND-owned edit and is purely type-honesty/non-breaking (the field is never read, and a manual interface declaring a now-absent field produces neither a compile nor a runtime error). It was completed in-cycle by frontend: both stale `email: string` decls removed so the TS type matches the trimmed response shape. type-check PASS before and after.

### Handoff

Per the super-admin-reporting skill, dropping a field from a response is an ops-owned data-contract change → notify **frontend** (confirm no render regression — confirmed none here) + **testing** (response-shape assertion + a regression that `top_students[*]` carries no `email`).

---

## SAO-7 — full-surface P9 gate sweep (test-only)

### Problem (from 02-gap / 03-root-cause)

The MAP phase proved a `Grep` token match (`authorizeAdmin|authorizeRequest|requireAdminSecret`) on all 119 super-admin route files, but only ~10 routes were read line-by-line to confirm the gate PRECEDES the first DB I/O. The other ~109 + the `v1/admin` + `internal/admin` surfaces were unverified for ordering. Enforcement was by convention + spot-checked pins (REG-116/119), not mechanical coverage. A route could import a gate yet `fetch` before it, or gate a GET but not a sibling mutation in the same file.

### Approach: a mechanical 100%-surface sweep test (owner = testing)

A static-analysis test (`admin-route-auth-gate-sweep.test.ts`) that enumerates every admin route file on disk and asserts:
1. **Token presence** — each of the 134 admin routes (super-admin 119 + `v1/admin` 2 + `internal/admin` 13) carries a canonical gate token.
2. **Gate-before-I/O ordering** — for every DB-touching handler, the `authorize*` / `requireAdminSecret` call appears before the first DB I/O (`supabaseAdmin`/`fetch`/`supabaseRest`).
3. **Allowlist** — `super-admin/login` is the only self-auth exception (it authenticates rather than gates).

Result: 207/207 DB-touching handlers gate before first DB I/O. This converts the "only 10/119 sampled" coverage gap from a manual spot-check into a mechanical PR-CI invariant. → **REG-186** (P9).

> Note: this is the test-driven complement to the gap's "AST/lint check" recommendation. The sweep is implemented as a Vitest file-walk (no new lint plugin), which is sufficient to fail CI on a mis-ordered or ungated handler.

## SAO-4 — bare-name log canary (test-only)

### Problem

The key-based redactor intentionally excludes bare `name`/`ip` to avoid colliding with `event_name`/`subject_name`/metric keys (`redact-pii.ts:43-46`); only `full_name`/`first_name`/`last_name` are caught. A caller logging `{ name: <student full name> }` would bypass redaction. The residual risk is unmanaged caller discipline, not a redactor bug — so the global key set is deliberately NOT widened (would over-redact legitimate telemetry).

### Approach: a conservative grep/AST canary (owner = testing)

A test (`bare-name-log-canary.test.ts`) that scans `logger.*(...)` call sites and fails if any passes a bare `name`/`email`/`phone` key. The anchor is conservative — it EXCLUDES `full_name`/`flag_name`/`event_name`/`school_name`/`first_name`/`last_name`/etc. so it flags only the genuinely-risky bare-`name` shape, never the legitimate compound keys. → **REG-187** (P13).

> This keeps the documented precision-vs-recall tradeoff in the redactor (no global-set change) while adding the structural enforcement the gap asked for at the call-site layer.

## GATED (owner = user) — explicitly NOT touched in this cycle

| Gap | Why gated | Owner |
|---|---|---|
| **SAO-1** — bulk PII export (`/api/super-admin/reports`, students/teachers/parents) gated at the `support` floor tier | Raising the required level for PII-bearing report types changes the admin ACCESS MODEL (the tier ladder). Per CLAUDE.md, RBAC/tier changes require USER APPROVAL. | user (decision); architect + ops (implement after approval) |
| **SAO-5** — audit-log CSV export carries `admin_name`/`admin_email` in `details` at `support` | Same root cause as SAO-1; the audit says "fold into SAO-1's tier decision, no separate action." Access-model change. | user (decision) |
| **SAO-2 (raise-tier branch)** | Not taken — email was unused, so we minimized (dropped) instead of raising the tier. The alternative remedy (raise analytics tier) would have been a gated access-model change; it is moot now. | n/a (resolved by minimization) |

This cycle does NOT add or alter any RBAC role/permission and does NOT change any access tier. SAO-1/SAO-5 remain open as user-gated tiering decisions.
