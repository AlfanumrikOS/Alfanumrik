# Requirements — Audited Demo Comp-Grant Endpoint (`schools.is_demo` setter)

**Status:** requirements only. No implementation, no schema, no flag change in this document.
**Date:** 2026-07-29
**Requested by:** ops. **Implemented by:** backend. **Reviewed by:** architect (P11 + schema + RBAC), testing (regression pins), ops (contract conformance).
**Consumes:** `docs/runbooks/school-demo-playbook.md` (the operational procedure this endpoint replaces Section 5 of).

---

## ⚠️ P11 EXCEPTION SURFACE — mandatory justification header

> **This endpoint grants paid product access without a verified payment.** P11 states: *"Never grant plan access without verified payment. Subscription status changes MUST be written atomically with the payment record."* Setting `schools.is_demo = true` unlocks the comp branch in `apps/host/src/app/api/school-admin/subscription/route.ts` (~L271-378 for POST, ~L697-743 for PATCH), which writes `school_subscriptions.status = 'active'` with `razorpay_subscription_id = null` and **never contacts Razorpay**. `packages/lib/src/demo/is-demo-school.ts` documents this as THE ONE sanctioned exception to P11.
>
> **The implementing file MUST carry this justification block verbatim in its module header**, naming: (a) that it is a P11 exception, (b) that the exception is bounded by mandatory expiry, (c) that it fails closed, (d) the audit action names it emits. A reviewer who opens the file must be unable to miss that this route hands out free paid access.
>
> **Why it must exist anyway:** today the flag is flipped by hand in the Supabase SQL editor. There is no actor, no reason, no expiry, no audit row, and no cap. Every property that makes a P11 exception tolerable is currently absent. A worse-governed version of this capability already ships; this endpoint is a *reduction* in risk, not an addition.

**Verified gap (2026-07-29):** no route in `apps/host/src/app/api/**` sets `schools.is_demo` on an existing school. The only `is_demo: true` write onto a `schools` row is at INSERT time inside `provisionDemoSchool()` (`apps/host/src/app/api/super-admin/demo-accounts/route.ts:302`) for the throwaway `school_admin` demo tenant. `provision_school` (`supabase/migrations/20260623020000_provision_school_rpc.sql`) does not touch it.

---

## 1. Scope

**In scope:** grant / extend / revoke / list the demo comp flag on an *existing* `schools` row, with mandatory expiry, mandatory reason, blast-radius caps, and a full audit trail. Plus the companion expiry sweeper without which "mandatory expiry" is decorative.

**Out of scope (do not build here):**
- Creating schools — `POST /api/super-admin/institutions/provision` already does that.
- Creating demo students — `POST /api/super-admin/demo-accounts` already does that.
- Changing the comp branch in `/api/school-admin/subscription`. That branch is correct and stays untouched; this endpoint only governs its *precondition*.
- Fixing the `get_plan_limit` vs `effective-plan.ts` divergence (Section 7 of the playbook). Separate work, separate owner.

---

## 2. Routes

Convention: `authorizeAdmin(request, level)` with ranked tiers `support(0) < analyst(1) < content_manager(2) < finance(3) < admin(4) < super_admin(5)`. This is the dominant `/api/super-admin/*` convention (99 routes vs 22 using `authorizeRequest`).

| Method | Path | Required tier | Purpose |
|---|---|---|---|
| `POST` | `/api/super-admin/institutions/demo-grant` | **`super_admin`** | Grant or extend the demo comp flag. |
| `DELETE` | `/api/super-admin/institutions/demo-grant?school_id=<uuid>` | **`super_admin`** | Revoke immediately. |
| `GET` | `/api/super-admin/institutions/demo-grant` | **`finance`** | The comp-grant register: every school currently flagged, with expiry, reason, and grantor. |

**Tier rationale.** `super_admin` for the mutations matches every comparable P11-adjacent or high-blast-radius mutation already in the codebase (`institutions/provision` POST, `institutions` PATCH/DELETE, `demo-accounts` POST/DELETE). `finance(3)` on the read because a standing register of unpaid-access grants is a finance artefact — finance must be able to reconcile revenue against it without holding `super_admin`. **Do not** default the read to `support` and do not use the `authorizeRequest(permission)` path here; the tier system is what the rest of this surface uses and a mixed convention on a P11 route is a review-time trap.

Deny paths must short-circuit **before any DB I/O** and must return no payload beyond the standard `{ error, code }` shape produced by `authorizeAdmin`.

---

## 3. Request / response contracts

### 3.1 `POST` — grant or extend

```jsonc
{
  "school_id": "550e8400-e29b-41d4-a716-446655440000",  // uuid, REQUIRED
  "reason": "Prospect requires live school-admin billing walkthrough on 2026-08-04.",
                                                        // string, REQUIRED, 20..500 chars
  "expires_at": "2026-08-06T18:30:00.000Z",             // ISO 8601, REQUIRED
  "ticket_ref": "SALES-1182",                           // string, optional, <=64 chars
  "acknowledge_p11_exception": true                     // literal true, REQUIRED
}
```

Field rules:

| Field | Rule |
|---|---|
| `school_id` | Must be a valid UUID (`isValidUUID`). Must resolve to a non-deleted `schools` row. |
| `reason` | Trimmed length 20-500. Rejecting short reasons is deliberate: "demo" is not a reason. Must not match `/\b\d{10}\b/` (bare phone number) or an email-shaped substring — reject with `reason_contains_pii` rather than silently storing PII (P13). |
| `expires_at` | Must parse, must be `> now() + 1 hour`, must be `<= now() + 30 days`. **There is no null/omitted/"forever" form.** Absence is a 400, not a default. |
| `ticket_ref` | Free-form, stored, not validated against any tracker. |
| `acknowledge_p11_exception` | Must be the literal boolean `true`. A missing or `false` value is a 400. This is a deliberate speed bump, not ceremony — it makes "I did not realise this granted paid access" an unavailable defence. |

**Success `200`:**

```jsonc
{
  "success": true,
  "data": {
    "school_id": "550e8400-...",
    "is_demo": true,
    "demo_expires_at": "2026-08-06T18:30:00.000Z",
    "demo_granted_at": "2026-07-29T09:14:22.104Z",
    "previously_demo": false,          // true when this call extended an existing grant
    "operation": "granted",            // "granted" | "extended" | "noop"
    "active_comp_grants": 2,           // count AFTER this call, incl. this one
    "audit_id": "9f2c...",             // audit_logs.id of the row this call wrote
    "active_students_at_grant": 4
  }
}
```

Response carries **no** school name, no billing email, no student data. UUIDs and counts only (P13).

### 3.2 `DELETE` — revoke

Query param `school_id` (uuid, required). Optional body `{ "reason": "..." }` (10-500 chars) — recommended, not required, because revocation must never be harder than granting.

**Success `200`:**

```jsonc
{
  "success": true,
  "data": {
    "school_id": "550e8400-...",
    "is_demo": false,
    "operation": "revoked",            // "revoked" | "noop" (was already false)
    "was_granted_at": "2026-07-29T09:14:22.104Z",
    "grant_duration_hours": 41,
    "active_comp_grants": 1,
    "audit_id": "a71d..."
  }
}
```

Revocation clears `is_demo`, `demo_expires_at`, `demo_reason`, `demo_granted_by`, `demo_granted_at` in one statement. It **must not** touch `school_subscriptions` — expiring the comp'd subscription is a separate, explicit operator decision (playbook §4.2 step 2), because auto-cancelling a subscription row from a flag-clearing endpoint is exactly the kind of implicit money mutation P11 forbids. The response should carry an advisory `"subscription_still_active": true` when a `status IN ('active','trial') AND razorpay_subscription_id IS NULL` row still exists for that school, so the operator is told, not surprised.

### 3.3 `GET` — the register

No params (return all) or `?include_expired=true` (include revoked/expired within 90 days).

```jsonc
{
  "success": true,
  "data": {
    "active_count": 2,
    "cap": 5,
    "grants": [
      {
        "school_id": "550e8400-...",
        "school_slug": "st-xaviers-demo",     // slug is safe; NOT the display name or billing email
        "demo_granted_at": "2026-07-29T09:14:22.104Z",
        "demo_expires_at": "2026-08-06T18:30:00.000Z",
        "hours_remaining": 41,
        "expired": false,
        "reason": "Prospect requires live school-admin billing walkthrough...",
        "ticket_ref": "SALES-1182",
        "granted_by_admin_id": "c3a1...",     // admin_users.id — NOT name or email
        "active_students": 4,
        "school_subscription_status": "active",
        "razorpay_subscription_id_present": false
      }
    ]
  }
}
```

### 3.4 Error codes

| HTTP | `code` | Condition |
|---|---|---|
| 400 | `invalid_school_id` | missing / malformed UUID |
| 400 | `reason_required` | missing, or trimmed length outside 20-500 |
| 400 | `reason_contains_pii` | reason matches an email or bare-10-digit-phone pattern |
| 400 | `expiry_required` | `expires_at` absent or unparseable |
| 400 | `p11_acknowledgement_required` | `acknowledge_p11_exception` not literally `true` |
| 401/403 | (from `authorizeAdmin`) | `ADMIN_NO_TOKEN`, `ADMIN_SESSION_EXPIRED`, `ADMIN_INSUFFICIENT_LEVEL` |
| 404 | `school_not_found` | no row, or `deleted_at IS NOT NULL` |
| 409 | `school_has_paid_subscription` | any `school_subscriptions` row with non-null `razorpay_subscription_id` |
| 409 | `blast_radius_schools_exceeded` | granting would push active grants above the cap |
| 409 | `blast_radius_students_exceeded` | school's active student count exceeds the per-school cap |
| 422 | `expiry_out_of_range` | `expires_at <= now()+1h` or `> now()+30d` |
| 500 | `grant_write_failed` | DB write failed; nothing was changed |

Error bodies carry `{ success: false, code, error }` and, for the 409s, the offending count (`current_grants`, `cap`) — counts only, never the names of the other comp'd schools.

---

## 4. Idempotency

Keyed on `school_id`. The endpoint is a **state setter**, not an append-only action, and must behave that way under retry.

| Current state | POST with… | Result | `operation` | Audit action |
|---|---|---|---|---|
| `is_demo = false` | valid payload | grant applied | `granted` | `school.demo_grant_granted` |
| `is_demo = true`, `expires_at` **later than** request's | any | **no change to expiry** — never silently shortens a live grant | `noop` | `school.demo_grant_granted` with `noop: true` |
| `is_demo = true`, `expires_at` **earlier than** request's | valid payload, still ≤ now+30d | expiry extended, reason replaced | `extended` | `school.demo_grant_extended` |
| `is_demo = true`, identical payload replayed | identical | no state change | `noop` | `school.demo_grant_granted` with `noop: true` |

**Every call writes an audit row, including no-ops.** A retry storm producing five audit rows is correct and desirable; a retry that silently changes nothing and logs nothing is how a grant becomes untraceable.

DELETE against an already-`false` school returns `200` with `operation: "noop"` (not 404) and still audits.

Concurrency: the grant must be applied with a conditional `UPDATE ... WHERE id = $1 AND deleted_at IS NULL AND is_demo IS DISTINCT FROM …` and the blast-radius count must be evaluated **inside the same transaction** as the write (or behind `pg_advisory_xact_lock` keyed on a constant for this resource), so two concurrent grants cannot both observe `count = 4` and both commit past a cap of 5.

---

## 5. Guardrails — what stops this becoming a silent unpaid-access backdoor

Each guardrail below must be enforced **server-side, in the route or the RPC**, and must have a test. A guardrail documented but not enforced is worse than none, because it produces false confidence at review time.

### G1 — Mandatory expiry, hard-capped at 30 days
No null. No "permanent". No default. `expires_at` is required on every grant and every extension, and can never be more than 30 days out. Extensions are unlimited in *number* but each is capped in *length* and each is separately audited — so a year-long comp is reachable only via 12+ deliberate, individually-logged acts, which is exactly the visibility we want.

### G2 — Mandatory reason, 20-500 chars, PII-screened
Rejects `"demo"`, `"test"`, `""`. Rejects reasons containing email- or phone-shaped substrings (P13 — the reason string lands in `audit_logs.details`).

### G3 — Never comp a paying customer
Hard 409 if the school has **any** `school_subscriptions` row with a non-null `razorpay_subscription_id`, regardless of that row's status. Converting a paying tenant to comp must be impossible through this endpoint. If it is ever genuinely needed it is a finance decision executed deliberately elsewhere, not an ops convenience.

### G4 — Blast-radius cap: concurrent grants
At most **5** schools may hold an active (non-expired) grant at any time. The 6th returns 409 `blast_radius_schools_exceeded` with `{ current_grants, cap }`. The cap is a named constant in the route module, not a magic number, and changing it is a code change with review — not a config toggle.

### G5 — Blast-radius cap: tenant size
Reject with 409 if the target school has more than **50** active students (`students.is_active = true AND school_id = ...`). A tenant with a real student body is a revenue event, not a demo. Report the count in the error body so the operator understands the refusal.

### G6 — Fail closed on every path
Any lookup error, any missing row, any ambiguity → **do not grant**. Mirrors `isDemoSchool()`'s own posture: "any error, missing row, or missing/false flag returns false, so the default outcome is the real-Razorpay path, never a free grant."

### G7 — Expiry must actually expire (companion sweeper — REQUIRED, not optional)
Expiry that only exists as a stored timestamp is a comment. A daily job (add a step to `supabase/functions/daily-cron/`, or a Vercel cron route following the `CRON_SECRET` fail-closed pattern used by `/api/cron/adaptive-remediation`) must:

1. Select `schools WHERE is_demo = true AND demo_expires_at < now()`.
2. Set `is_demo = false` and clear the grant columns.
3. Write one audit row per school: `school.demo_grant_expired`, `actor_type = 'system'`, details `{ school_id, granted_at, expires_at, overdue_hours }`.
4. **Not** touch `school_subscriptions` (same reasoning as §3.2) — instead emit a metadata-only ops alert listing school_ids whose comp'd subscription is still `active` after the flag cleared, so a human closes the loop.
5. Be idempotent and safe to run twice in a day.

**Ship the sweeper in the same PR as the endpoint.** An endpoint with mandatory expiry and no sweeper is strictly worse than today's manual flip, because it *looks* time-bounded.

### G8 — The register must be readable without `super_admin`
G4-G7 only work if somebody looks. `GET` at `finance` tier, surfaced on `/super-admin/institutions` as a persistent "Active comp grants: N/5" indicator (frontend follow-up), is what turns the cap into an operational reality instead of a 409 nobody ever sees.

---

## 6. Schema requirements (architect owns — do not implement without review)

`schools.is_demo BOOLEAN NOT NULL DEFAULT false` already exists (migration `20260528000001_promote_demo_accounts_v2.sql:107`) with a partial index `idx_schools_is_demo ON schools(is_demo) WHERE is_demo = true`. **There is no expiry, grantor, or reason column.** The endpoint cannot meet G1/G2/G7 without them.

Requested additive columns on `public.schools` (all nullable, no default, no backfill needed — existing `is_demo = true` rows are pre-endpoint and will be surfaced by the register as `expires_at IS NULL` → treated as *immediately expired* by the sweeper, which is the correct posture for an ungoverned legacy grant):

| Column | Type | Notes |
|---|---|---|
| `demo_expires_at` | `timestamptz` | Sweeper key. Index alongside the existing partial index: `(demo_expires_at) WHERE is_demo = true`. |
| `demo_granted_at` | `timestamptz` | |
| `demo_granted_by` | `uuid` | FK → `admin_users(id)`, `ON DELETE SET NULL`. Never store the grantor's email or name on the row. |
| `demo_reason` | `text` | Length constraint 20-500 enforced in-app; a CHECK is acceptable but must not break the legacy `is_demo = true` rows (nullable). |
| `demo_ticket_ref` | `text` | |

Architect decides whether the write lives in the route (service-role `UPDATE` with the guard predicates inline) or in a `SECURITY DEFINER` RPC (`grant_school_demo_comp(p_school_id, p_reason, p_expires_at, p_granted_by, p_ticket_ref)`). **Ops preference: an RPC**, so the blast-radius count and the conditional write are one transaction by construction and the guard predicates cannot drift between call sites — the same reasoning that put `provision_school` and `atomic_subscription_activation` in the DB.

RLS: `schools` policy posture is unchanged; all access here is service-role. No new table, so no new RLS policy is required — but if an RPC is added it must be `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` and granted to `service_role` only, matching `20260516040000_revoke_execute_internal_functions.sql`.

---

## 7. Audit requirements

### 7.1 Action names (exact strings — testing pins these)

| Action | Emitted by | `actor_type` |
|---|---|---|
| `school.demo_grant_granted` | POST (grant or no-op) | `admin` |
| `school.demo_grant_extended` | POST (expiry extended) | `admin` |
| `school.demo_grant_revoked` | DELETE | `admin` |
| `school.demo_grant_expired` | sweeper (G7) | `system` |

Written via `logAdminAudit(auth, action, 'school', schoolId, details, ip, { before, after })`. `resource_type` is `'school'`, `resource_id` is the school UUID.

`before_state` / `after_state` must be populated on every mutating call — this is the diff-forensics affordance `logAdminAudit` already supports and which the manual SQL flip cannot provide:

```jsonc
before_state: { "is_demo": false, "demo_expires_at": null }
after_state:  { "is_demo": true,  "demo_expires_at": "2026-08-06T18:30:00.000Z" }
```

### 7.2 `details` payload — allowed keys (P13: metadata only)

```jsonc
{
  "reason": "<the operator-supplied reason string>",
  "ticket_ref": "SALES-1182",
  "expires_at": "2026-08-06T18:30:00.000Z",
  "granted_at": "2026-07-29T09:14:22.104Z",
  "previously_demo": false,
  "noop": false,
  "operation": "granted",
  "active_comp_grants_after": 2,
  "active_students_at_grant": 4,
  "school_subscription_status": "trial",
  "razorpay_subscription_id_present": false,
  "p11_exception": true
}
```

**Forbidden in `details` (must be asserted by a test):** school display name, `schools.email`, `billing_email`, `phone`, `principal_name`, `custom_domain`, any student name/email/phone, any guardian contact. `school_slug` is permitted in the `GET` register response but **not** in audit details — the UUID is sufficient there.

Known context, not a licence: `logAdminAudit` itself appends `admin_name` + `admin_email` (the *operator's* identity — required for accountability, not student PII). Do not add any further identity fields.

### 7.3 Never fail the grant on an audit failure — but never grant silently either

`logAdminAudit` is fire-and-forget by design. That is acceptable for most routes and **not** acceptable here: an unaudited P11 exception is the exact failure this endpoint exists to eliminate. Requirement: the audit write is `await`ed and its `audit_logs.id` returned in the response (`data.audit_id`). If the canonical `audit_logs` write fails, the route must return `500 grant_write_failed` **and roll back the flag** (which is trivial if the write lives in an RPC that inserts the audit row in the same transaction — a further argument for the RPC form in §6).

---

## 8. Testing requirements (testing agent owns)

Minimum pinned behaviours. Propose as new regression-catalog entries (next free ids after REG-321):

1. **Tier gate.** Every tier below `super_admin` gets 403 `ADMIN_INSUFFICIENT_LEVEL` on POST and DELETE, before any DB I/O; every tier below `finance` gets 403 on GET.
2. **Guard completeness.** Each of G1-G6 produces its documented status + `code`, and leaves `schools.is_demo` unchanged. Specifically: a school with a non-null `razorpay_subscription_id` can never be granted (G3), and the 6th concurrent grant is refused (G4).
3. **Expiry is not optional.** Omitted / null / `now()-1h` / `now()+31d` `expires_at` all 400 or 422; no code path produces a grant with `demo_expires_at IS NULL`.
4. **Idempotency matrix** — the four rows of §4, including that a later-expiry existing grant is never silently shortened, and that no-ops still audit.
5. **Audit completeness.** Every mutating call writes exactly one `audit_logs` row with the exact action string, populated `before_state`/`after_state`, and a `details` object that does **not** match `/name|email|phone|principal|domain/i` on its keys or values.
6. **Sweeper closes the loop.** A grant with `demo_expires_at` in the past is cleared on the next sweeper run, emits `school.demo_grant_expired` with `actor_type='system'`, and is idempotent across two runs. A legacy `is_demo = true` row with `demo_expires_at IS NULL` is treated as expired.
7. **Fail-closed (G6).** A simulated DB error on the lookup leaves `is_demo` false and returns 500 — never a grant.

---

## 9. Review chain (P14)

| Step | Agent | Why |
|---|---|---|
| Contract + guardrails (this doc) | **ops** | Owns the WHAT and the operational governance. |
| Schema (`demo_expires_at` et al.), RPC-vs-route decision, RLS/EXECUTE posture | **architect** | Schema and P11 exception surface. |
| Route + RPC implementation, sweeper | **backend** | Owns API implementation and cron workers. |
| Register UI on `/super-admin/institutions` ("Active comp grants: N/5") | **frontend** | Follow-up; G8 depends on it being visible. |
| Regression pins §8 | **testing** | |
| Final review | **quality** | |

Per the constitution's chain table this is simultaneously *Admin user/role APIs* (backend per ops/architect → architect, frontend, testing) and payment-adjacent. Treat architect review as **blocking**, not advisory.

**User (CEO) approval is required before merge** — this is a change to how a P11 exception is granted. It is not covered by the "feature flag toggles / bug fixes" autonomous list.

---

## 10. Acceptance criteria

The endpoint is done when all of the following are true:

- [ ] `docs/runbooks/school-demo-playbook.md` Section 5 (manual SQL break-glass) can be **deleted and replaced** with a single API call, and the runbook is updated in the same PR.
- [ ] No grant can exist without an expiry, a reason, an identified grantor, and an audit row carrying all three.
- [ ] The sweeper has run at least once in staging and demonstrably cleared an expired grant.
- [ ] `GET` returns a register that reconciles 1:1 with `SELECT id FROM schools WHERE is_demo = true`.
- [ ] A paying school (non-null `razorpay_subscription_id`) cannot be granted through any code path in the route.
- [ ] The implementing module header carries the P11 justification block from the top of this document.
- [ ] The playbook's Section 4.4/P1 standing query returns zero unexplained rows.
