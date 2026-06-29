# Cycle 6 — Super-Admin & Observability — 05 IMPLEMENTATION

Owner: ops (lead) + frontend (SAO-2 type cleanup) + testing (SAO-7, SAO-4). Implements the AUTO-FIX-SAFE set designed in `04-solution-design.md`: SAO-3 egress redaction + SAO-2 field drop (ops), the SAO-2 frontend stale-type cleanup (frontend), and the SAO-7 full-surface P9 gate sweep + SAO-4 bare-name log canary (testing). No RBAC/tier changes (SAO-1/SAO-5 remain user-gated).

## Redactor reused (no new scheme)

- `redactPII` — re-exported for Next.js at `src/lib/ops-events-redactor.ts:7`, canonical impl `supabase/functions/_shared/redact-pii.ts:74-95` (deep, key-based, circular-safe; `SENSITIVE_KEYS` at `redact-pii.ts:37-66`). This is the same redactor `src/lib/logger.ts:18,67` uses for in-flight log metadata. Reused as-is on the observability CSV egress.

---

## SAO-3 — egress redaction of `context_json`

File: `src/app/api/super-admin/observability/export/route.ts`

### Change 1 — import (after line 3)

Added:
```ts
import { redactPII } from '@/lib/ops-events-redactor';
```

### Change 2 — context cell (was line 91)

Before:
```ts
        escapeCSV(row.environment),
        escapeCSV(row.context ? JSON.stringify(row.context) : null),
```

After:
```ts
        escapeCSV(row.environment),
        // P13 (SAO-3): defense-in-depth egress redaction. Ops events are
        // SUPPOSED to be PII-free at write time (logOpsEvent), but this CSV
        // export is the last line of defense before bulk egress. Deep-redact
        // context with the shared key-based redactor (redactPII) so a single
        // mis-instrumented upstream event that put a name/email/phone/token
        // into context cannot be exfiltrated. Clean data is unchanged.
        escapeCSV(row.context ? JSON.stringify(redactPII(row.context)) : null),
```

### Why this is safe / shape-preserving

- `CSV_COLUMNS` (lines 13-24) untouched → header + column order + count identical.
- Only the `context_json` cell VALUE changes, and only when `row.context` contains a `SENSITIVE_KEYS` member; for clean context `redactPII` rebuilds the same object (identity transform). Nested objects/arrays are deep-walked by `redactPII`.
- The other 9 columns are controlled scalars (timestamps/enums/UUID/correlation-id/template message) — left intact. `subject_id` (UUID) deliberately retained for forensic joinability; it is an identifier, not PII content, and is not a `SENSITIVE_KEYS` key. `message` is a fixed ops-event template; the key-based redactor is a no-op on plain strings and we intentionally did NOT bolt on the text-regex redactor (would be inventing a second scheme on a controlled column — out of scope; that class is a write-time SAO-4 concern).

### P13 rationale

This path was the documented single-layer-of-defense gap (03-root-cause SAO-3): redaction was assumed to happen at write time only. Egress is now the second layer, so a bulk export of up to 100k rows cannot exfiltrate a name/email/phone/token that an upstream logging mistake placed into `context`.

---

## SAO-2 — drop unused `email` from `top_students`

Investigation: `top_students[].email` has ZERO consume sites in the UI (full detail in 04-solution-design.md). Leaderboard renders Rank/Name/Grade/XP/Streak/Assessment (`learning/page.tsx:268-317`), CSV export uses name/grade/xp/streak (`:327-329`), LearnerHealth widget uses xp_total only (`LearnerHealth.tsx:20-21`). React keys use `s.id`. → DROP the field (AUTO-FIX-SAFE data minimization).

File: `src/app/api/super-admin/analytics/route.ts`

### Change 1 — query projection (was line 86)

Before:
```ts
      // 8. Top students by XP
      supabaseRest('students', `select=id,name,email,grade,xp_total,streak_days,avatar_url&is_demo=eq.false&order=xp_total.desc.nullslast&limit=10`),
```
After: select list is `id,name,grade,xp_total,streak_days,avatar_url` (email removed) with a P13/SAO-2 comment. Email never leaves Postgres now — minimized at the source query.

### Change 2 — row type (was line 107)

`safeJson<{ id: string; name: string; email: string; grade: string; ... }>` → removed `email: string`.

### Change 3 — response map (was lines 184-192)

Removed `email: s.email,` from the `top_students` object literal (replaced with a P13/SAO-2 comment). Response now carries `id,name,grade,xp_total,streak_days,avatar_url`.

### Disposition

- Result: **email DROPPED** (not gated). The "raise the tier" alternative is moot because the field was unused.
- Frontend type cleanup **LANDED in-cycle** (frontend-owned): the stale `email: string` decl was removed from the `top_students` element type in BOTH `src/app/super-admin/learning/page.tsx` and `src/app/super-admin/_components/widgets/control-room-types.ts`. Type-honesty — the field was never dereferenced, so this is non-breaking; type-check PASS before and after. The data-contract handoff (ops drops field → frontend confirms no render regression → testing pins shape) is fully closed.

### P13 rationale

Data minimization: a top-XP leaderboard does not need student email. Removing it shrinks the PII surface of a `support`-tier dashboard endpoint without changing what the dashboard renders. No PII added to logs.

---

## Self-review

- [x] SAO-3 reuses existing `redactPII` (no new redaction scheme invented).
- [x] SAO-3 applied to the only object/free-form column (`context_json`); deep-redacts nested objects; clean data unchanged; CSV header/columns/order preserved.
- [x] SAO-2 confirmed `email` unused by any UI before dropping; dropped at query + type + map; id retained for keys; frontend stale `email: string` decls removed from both type sites (type-honesty).
- [x] SAO-7 sweep covers the FULL admin surface (134 routes, 207/207 gate-before-I/O); `super-admin/login` is the sole allowlist; test-only.
- [x] SAO-4 canary is conservative (excludes compound `*_name` keys); the redactor's global key set was NOT widened; test-only.
- [x] No RBAC role/permission added or altered; no access tier changed (SAO-1/SAO-5 + SAO-2 raise-tier branch left GATED, owner = user).
- [x] No new PII in logs; no `console.log` added; existing audit-log call (`logAdminAudit`) unchanged and already metadata-only.
- [x] `npm run type-check` — PASS (exit 0, no errors).
- [x] `npm run lint` — PASS (0 errors).
- [x] `npm test` (targeted) — **6/6 new** (4 SAO-7 + 2 SAO-4) + **351/351** broad super-admin/analytics/observability — PASS.
- [x] `npm run build` — PASS; bundle within P10 caps (analytics/observability are server routes; the two new files are test-only — no shared-chunk or page-budget impact).

### tests (testing)

Two new test-only hardening gaps landed alongside the ops/frontend data-minimization fixes. **6 new tests, all PASS** (and they ride on top of 351/351 broad super-admin/analytics/observability tests, also green).

#### SAO-7 — `admin-route-auth-gate-sweep.test.ts` (P9, 4 tests) → REG-186

A mechanical 100%-surface sweep that enumerates every admin route file on disk (no sampling):

1. **Surface completeness** — all **134** admin routes are discovered and walked: super-admin **119** + `v1/admin` **2** + `internal/admin` **13**.
2. **Token presence** — every one of the 134 routes carries a canonical gate token (`authorizeAdmin` / `authorizeRequest` / `requireAdminSecret`).
3. **Gate-before-I/O ordering** — **207/207** DB-touching handlers place the gate call BEFORE the first DB I/O (`supabaseAdmin`/`fetch`/`supabaseRest`). This is the assertion that closes the "only 10/119 read line-by-line" coverage gap from `02-gap-analysis.md` SAO-7.
4. **Allowlist exactness** — `super-admin/login` is the ONLY allowlisted self-auth exception (it authenticates rather than gates); no other route may appear in the allowlist.

Effect: any future admin route that imports a gate but mis-orders it, gates a GET but not a sibling mutation, or omits the gate entirely, now **fails PR-CI**. Mechanical breadth replaces manual spot-checking.

#### SAO-4 — `bare-name-log-canary.test.ts` (P13, 2 tests) → REG-187

A conservative canary on `logger.*(...)` call shapes:

1. **No bare PII key** — no logger call passes a bare `name` / `email` / `phone` key into its metadata object.
2. **Compound-key exclusion (anti-false-positive)** — the anchor explicitly EXCLUDES `full_name`/`first_name`/`last_name`/`flag_name`/`event_name`/`school_name`/etc., so the canary flags only the genuinely-risky bare-`name` shape and never trips on legitimate compound keys.

Effect: keeps the documented precision-vs-recall tradeoff in the key-based redactor (the global `SENSITIVE_KEYS` set is NOT widened) while adding call-site structural enforcement so a `{ name: <student full name> }` log can't slip past review.

#### Catalog

- **REG-186** (P9) — admin-route auth-gate full-surface sweep (134 routes; 207/207 gate-before-I/O; `super-admin/login` sole allowlist).
- **REG-187** (P13) — bare-name log canary (no bare `name`/`email`/`phone` logger key; conservative compound-key exclusion).
- Catalog **152 → 154**. `.claude/regression-catalog.md` is authoritative.
