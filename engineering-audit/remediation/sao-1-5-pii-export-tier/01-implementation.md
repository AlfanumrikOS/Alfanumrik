# SAO-1 / SAO-5 — Implementation (bulk PII export re-tiering)

**Item:** SAO-1 / SAO-5 (post-program remediation backlog, Tier-1; surfaced Cycle 6 — super-admin-observability)
**Invariant:** P13 (data privacy) + P9 (RBAC enforcement) — security hardening WITHIN the existing RBAC ladder; **NOT a P9 permission/role addition**
**Author:** backend (impl) — ops finalization
**Date:** 2026-06-29
**Type:** Application code change (one route) — read-tier hardening, **no migration / no new permission code / no role**
**File:** `src/app/api/super-admin/reports/route.ts`

---

## 1. The defect (before)

`/api/super-admin/reports` sat behind a SINGLE gate for ALL six report types:

```ts
// BEFORE (single floor gate for every type)
const auth = await authorizeAdmin(request, 'support');
if (!auth.authorized) return auth.response;
// ... type read AFTER the gate, defaulting to 'students'
const type = params.get('type') || 'students';
```

`support` is the FLOOR admin tier (any active `admin_users` row). Four of the six export types egress
personally-identifiable data at up to 5000 rows, CSV or JSON:

| Type | Table | PII egressed |
|---|---|---|
| `students` | `students` | **minors'** `name` + `email` |
| `teachers` | `teachers` | `name` + `email` |
| `parents` | `guardians` | `name` + `email` + **`phone`** |
| `audit` | `admin_audit_log` | admin `name` / `email` surfaced in `details` (SAO-5) |

The admin-level ladder gates by **action destructiveness**, not **read data-sensitivity**, so the
platform's most PII-heavy export sat at its lowest tier. A single phished/over-provisioned low-tier
credential = mass minors'/parent PII exfiltration. DPDP-relevant (minors' data).

The two remaining types egress only UUIDs + aggregate counters (no PII):

| Type | Table | Content |
|---|---|---|
| `quizzes` | `quiz_sessions` | `id`, `student_id` (UUID), subject/grade/score counters |
| `chats` | `chat_sessions` | `id`, `student_id` (UUID), message counters |

A secondary defect: `type` was read AFTER the gate and defaulted to `students` — an unknown/mistyped
type slipped through to a query, and the safest type (full student roster) was the default.

---

## 2. The fix (after) — per-type tier map, validate-first, fail-closed ordering

Introduced a `REPORT_CONFIG` map keyed by type. Each entry carries the table, the column whitelist
(`select`), the demo filter, and the **minimum** admin tier for that type:

| Type | `level` | Reason |
|---|---|---|
| `students` | `super_admin` | PII: minors' name+email |
| `teachers` | `super_admin` | PII: name+email |
| `parents` | `super_admin` | PII: name+email+**phone** |
| `audit` | `super_admin` | PII: admin name+email in `details` (SAO-5) |
| `quizzes` | `support` | UUID-only, non-PII → keep the floor |
| `chats` | `support` | UUID-only, non-PII → keep the floor |

Ordering in `GET` (each step fails closed before the next):

1. **Validate `type` FIRST** — `const config = REPORT_CONFIG[type]; if (!config) → 400 "Invalid report type"`.
   Unknown/mistyped type fails closed **BEFORE any auth gate or DB access**; cannot inherit a lower tier
   or reach a query.
2. **Per-type gate** — `await authorizeAdmin(request, config.level)`; non-authorized → `auth.response`.
   The gate still runs **BEFORE any data query** for every type (gate-before-data preserved).
3. Build the filter (demo filter + ISO-8601-validated `from`/`to`), then fetch, audit-log, and serialize.

The missing-type default changed from `support`-tier `students` to `students` → **`super_admin`**
(safer than the old support default — a `type`-less call now requires the highest tier, not the lowest).

```ts
// AFTER (validate-first, then per-type gate)
const type = params.get('type') || 'students';
const config = REPORT_CONFIG[type];
if (!config) return NextResponse.json({ error: 'Invalid report type' }, { status: 400 }); // pre-gate, pre-DB
const auth = await authorizeAdmin(request, config.level); // per-type tier, BEFORE any query
if (!auth.authorized) return auth.response;
```

---

## 3. Byte-identical data path (no data-shape regression)

Everything DOWNSTREAM of the gate is unchanged — this is purely an access-tier change, not a data
change:

- **Column whitelists** (`select`) per type are byte-identical to the pre-fix inline selects — same
  columns, same order. CSV headers/columns/order and JSON shape are unchanged.
- **Demo filter** (`is_demo=eq.false`) applies to the same types as before (students/teachers/parents).
- **`from`/`to`** ISO-8601 validation + PostgREST interpolation guard is preserved (rejects a sneaky
  second `select=` override; PostgREST honours the last duplicate param).
- **Audit log** — every export still writes `report.exported` via `logAdminAudit` with
  `{ format, row_count, from, to }`.
- **Output** — `format=json` and CSV branches unchanged; filename pattern unchanged.

A previously-authorized `super_admin` exporter sees an identical response to before for all six types.
The ONLY behavioral change is that `support`/`finance`/`admin`/`analyst`/`content_manager` accounts now
receive `403` on the four PII types (quizzes/chats unaffected).

---

## 4. What did NOT change (scope guardrail)

- **No migration.** No schema, no new column, no new table.
- **No new permission code.** No entry added to the RBAC permission registry.
- **No new role / no new admin tier.** Only the EXISTING `super_admin` and `support` tiers are reused.
- **No P9 permission-addition gate triggered.** This is security hardening within the existing ladder
  (re-pointing a route from the floor tier to an existing higher tier), not an RBAC model change.
- **No PII added to any response.** Data minimization unchanged; this only restricts WHO may export.

---

## 5. Loosening path (recorded for the operational follow-up)

If the CEO later decides some non-super-admin staff must retain PII export, the change is a **one-line
`REPORT_CONFIG` edit** — drop the relevant type's `level` from `super_admin` to `finance` or `admin`.
No migration, role, or permission code is involved. **That edit is a fresh reviewed decision** — it
turns REG-198 red (the pin asserts the four PII types require `super_admin`), forcing an explicit,
reviewed loosening rather than a silent drift. This is the intended guardrail.
