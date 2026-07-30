# Runbook — Super Admin Quota Control (Institution Entitlements)

**Purpose:** Let a super-admin operator set a specific school's daily Foxy-chat
and daily-quiz quota from the admin panel, verify the change actually landed,
and clear it later. This is the operator guide for `/super-admin/entitlements`.

**Audience:** CEO or ops operator with a super-admin session. No SQL knowledge
required for the panel workflow itself; the verification step uses one
copy-pasteable read-only query for anyone who wants to double-check in
Supabase directly.

**Owner:** ops (this panel's operational rules). Backend owns the API route
and resolver implementation; architect owns the enforcement wiring described
in Section 0.2 (landed 2026-07-29, migration `20260729130600`).

**Risk class: P11-adjacent, LIVE — read this before touching the panel.**
As of migration `20260729130600`, a quota you set in this panel takes effect
for real students immediately, with no flag to flip. It is a commercial grant
(it can raise what a school's students are allowed to consume) but it can
never grant paid *module/feature* access beyond what
`institution_entitlements` already restricts, and — critically — it can
**only raise a quota, never lower one** (see Section 4). Treat every save in
this panel as an operational change that reaches students the moment you
click Save, not a staged/preview action.

**Estimated time:** 5 minutes to set a quota, 2 minutes to verify.

---

## Section 0 — What this does and does not do

### 0.1 Scope: per-SCHOOL, not per-student

This panel controls **one row per (school, entitlement key)** in
`institution_entitlements`. There is no per-individual-student override
anywhere in this data model. If the request is "give this one student more
Foxy messages," this panel cannot do that — the only way to raise a single
student's quota today is a personal `student_subscriptions` upgrade (a
different, existing mechanism), not this panel.

**How a school-level override reaches a student ("who" it applies to):** a
student is covered by a school's override through the same seat-linkage logic
used elsewhere in the platform (`get_plan_limit()`'s school-coverage branch,
migration `20260729130400`) — the UNION of: (a) a direct
`students.school_id` link, (b) an active `class_students` roster row, (c) an
active `class_enrollments` roster row, for a class belonging to that school.
Any student who resolves into that candidate set for the school you configure
is in scope for that school's override. You are not picking students — you
are picking a school, and every student currently linked to it (by any of
those three paths) inherits the override.

### 0.2 Current shipped state — enforcement wiring LANDED 2026-07-29

**Update (2026-07-30): the gap this section used to warn about is closed.**
Migration `20260729130600_get_plan_limit_institution_override_floor.sql`
wires `institution_entitlements` into the real enforcement path. This has
been re-verified against the migration's own header and body (not just its
filename) before writing this update. What it does:

- `get_plan_limit(p_student_id, p_feature)` — the single SQL function that
  **both** `check_and_record_usage()` (real-time enforcement: does this
  student get to send another Foxy message / start another quiz today?) and
  `get_student_usage()` (the "X of Y used today" display students and
  parents see) already delegate to exclusively — now returns:
  ```
  GREATEST(v_personal, v_school, v_institution_override)
  ```
  where `v_institution_override` is read live from `institution_entitlements`
  for the school(s) the target student is linked to (direct `school_id`, or
  an active class roster row), for the matching key
  (`limit.foxy_chat_daily` for Foxy, `limit.quiz_daily` for quizzes), honoring
  the row's `effective_from`/`effective_to` window.
- **Because both enforcement and display already called `get_plan_limit()`,
  zero application/TypeScript code changed.** The panel, the API route, and
  the resolver preview (`resolver.ts`) are untouched by this migration — only
  the SQL function underneath them got smarter.
- **It is NOT gated behind `ff_institution_entitlements_v1` or any other
  flag.** The migration's header explains why in detail: the change is
  provably monotonic (`GREATEST` can only raise a student's cap, never lower
  it) and is a strict no-op for every school with no
  `institution_entitlements` row, so there was no "wired but inert behind an
  OFF flag" risk to gate against. **This means: the moment you click Save in
  this panel, the change is live for real students. There is no second step,
  no flag to flip, no deploy to wait for.**
- The panel's **"Enforcement is OFF" banner (Section 2.3) is now STALE UI
  COPY, not a true statement.** It refers to `ff_institution_entitlements_v1`,
  which genuinely is still off — but that flag was never what gated *this*
  mechanism; it gates a *different*, still-unused enforcement path
  (`resolver.ts`'s `isEntitledEnforced()`, which — re-confirmed this session —
  is still called nowhere in the product except its own test). Do not let the
  banner's wording talk you out of treating a save as live. This is flagged
  to frontend as a known UI-copy defect (Section 7); it does not block this
  runbook's guidance.

**Conclusion: setting a quota in this panel now changes what a student
actually experiences, immediately, with no flag involved.** See Section 4 for
the one crucial limit on what "changes" means — this is a floor, not a
ceiling; you can raise a school's quota with this panel, you cannot lower one
below the school's plan-derived default.

### 0.3 What IS live today

The panel is a **live operational quota lever** for one specific purpose:
**raising a school's daily Foxy-chat or quiz quota above what its plan
already grants** (e.g. a pilot school negotiated 200 Foxy chats/day instead
of the `pro` plan's default). Setting a value here takes effect for that
school's students immediately upon Save — no flag, no waiting. It is **not**
a lever for throttling or capping a school down (Section 4). It remains also
useful for the original pre-staging purpose (configuring a deal's other
module/feature toggles ahead of the separate, still-off
`ff_institution_entitlements_v1` flag) — those toggle rows are unaffected by
this migration and still do not reach enforcement yet.

---

## Section 1 — Prerequisites

- **Admin tier:** `super_admin` — the highest tier in the platform's 6-level
  hierarchy (`support < analyst < content_manager < finance < admin <
  super_admin`, `packages/lib/src/admin-auth.ts`). Both `GET` and `PUT
  /api/super-admin/entitlements` call `authorizeAdmin(request, 'super_admin')`
  with no lower floor. Even the `admin` tier (one below the ceiling) cannot
  reach this page.
  - **Flag for architect (not fixed here, just noted per this runbook's
    review scope):** because `institution_entitlements` rows are described in
    their own migration as "commercial contract terms" (the same category as
    `school_contracts`), and `finance` tier already gets
    `finance.view_revenue`, day-to-day quota administration arguably belongs
    at `finance` rather than requiring the single highest tier in the system.
    This is a judgment call for architect/CEO, not a defect — noted here so
    it isn't lost.
- A super-admin session (log in at `/super-admin/login`).

---

## Section 2 — Step-by-step: set a school's daily Foxy chat and quiz quota

### 2.1 Navigate to the panel

Super Admin sidebar → **Access & Institutions** section → **Entitlements**
(`/super-admin/entitlements`). The nav icon is ⊞.

### 2.2 Find the school

Use the **"Select school"** dropdown near the top of the page. It is a
name-based `<select>`, not a raw-UUID text field — you pick the school by
its name, not by pasting an ID.

**Known limitation (flagging, not fixing — see Section 7):** the dropdown is
populated from `GET /api/super-admin/institutions?page=1&limit=100`, which
returns only the **100 most-recently-created schools** (ordered
`created_at.desc`) with no search box and no pagination inside the picker
itself. If the target school is not among the 100 newest, or if the
institution count ever exceeds 100, it will not appear in this list and there
is currently no in-panel way to reach it. For today's institution count this
is unlikely to bite, but it is a real gap for a non-technical operator and
should be fixed (a searchable combobox, or lifting the picker's page size)
before this is handed to the CEO as a self-serve tool at scale.

### 2.3 Read the deal-context header

Once a school is selected, the page loads and shows:
- The linked **contract** (number, status, billing cycle, seats, term,
  value) if one exists, or "No active contract" if not.
- The resolved **plan** code (free / starter / pro / unlimited).
- An **"Enforcement is OFF"** banner. **Ignore this banner for the two Limit
  rows (Foxy Chats per Day, Quizzes per Day) — it is stale UI copy that
  refers to an unrelated flag.** See Section 0.2: limit overrides reach
  students immediately with no flag flip. The banner remains accurate only
  for the Module/Feature toggle rows above the Limits section, which
  genuinely do not enforce yet.

### 2.4 Set the Foxy chat quota

Scroll to the **Limits** section (third group, after Modules and Features).
Find the **"Foxy Chats per Day"** row.

- To set a specific number (e.g. 200/day): type `200` into the number input.
  The row's **State** chip flips from `Inherit` to `Override`, and the
  **Effective** column live-updates to `200 / day`.
- To set unlimited: check the **"Unlimited"** checkbox next to the input
  instead. The Effective column shows `Unlimited`.
- The period is fixed to `day` for both live limits — there is no
  week/month option exposed in the UI for these two keys today.

### 2.5 Set the quiz quota (optional, same pattern)

Find the **"Quizzes per Day"** row directly below and repeat 2.4 with
whatever daily quiz cap you want.

### 2.6 (Optional) attach the change to a contract

If the school has a linked contract, a checkbox reads **"Attach this
session's changes to this contract"**. Check it if this quota change is part
of a specific negotiated deal you want traceable to that contract's
`contract_id`. Leave it unchecked for an ad-hoc operational adjustment.

### 2.7 Save

A sticky bar appears at the bottom of the page showing **"N changes"** once
you've touched at least one row. Click **Save**.

- On success: a green **"Saved"** toast appears, the sticky bar clears, and
  the page re-loads the just-saved values from the server response (it does
  not trust your local edits — it re-displays what the server actually
  persisted).
- On failure: a red toast shows the error message and your edits are kept
  (nothing is lost) so you can retry.

### 2.8 Confirm the row now shows "Override," not "Inherit"

After saving, the **State** column for the row(s) you touched should read
**Override** (a filled/info-colored badge), and the page-level banner "No
overrides set for this school — everything is inheriting from the plan
default" should **no longer appear** if this was the school's first
override. If every row on the page still reads `Inherit` after a save you
believed succeeded, something went wrong — re-check the toast.

---

## Section 3 — Verify the change actually took effect

There are two different things "took effect" can mean here. Check both, and
understand which one you're checking.

### 3.1 Confirm the override row landed in the database (works today)

Replace `<SCHOOL_NAME>` with (part of) the school's name — you already know
it, since you just picked it from the panel dropdown in 2.2. No student
lookup needed for this one:

```sql
SELECT ie.school_id, s.name AS school_name, ie.entitlement_key, ie.value,
       ie.contract_id, ie.effective_from, ie.effective_to, ie.updated_at
FROM public.institution_entitlements ie
JOIN public.schools s ON s.id = ie.school_id
WHERE s.name ILIKE '%<SCHOOL_NAME>%'
  AND ie.entitlement_key IN ('limit.foxy_chat_daily', 'limit.quiz_daily')
ORDER BY ie.updated_at DESC;
```

**PASS when:** a row exists for the key(s) you set, `value` matches what you
entered (e.g. `{"max": 200, "period": "day"}`, or `{"max": null, "period":
"day"}` for unlimited), and `updated_at` is recent. This confirms the panel's
write path and Section 2 worked.

### 3.2 Confirm the quota is actually ENFORCED for a student (expected to PASS today)

This is the honest check Section 0.2 used to warn would fail — it now
should not. It finds one real, currently-enrolled student for the target
school and asks the exact same function (`get_plan_limit()`) that
`check_and_record_usage()` uses to gate real Foxy chats and quizzes:

```sql
WITH target_student AS (
  SELECT st.id, st.grade, st.school_id
  FROM public.students st
  JOIN public.schools s ON s.id = st.school_id
  WHERE s.name ILIKE '%<SCHOOL_NAME>%'
    AND st.is_active = true
  ORDER BY st.created_at DESC
  LIMIT 1
)
SELECT ts.id AS student_id, ts.grade,
       public.get_plan_limit(ts.id, 'foxy_chat') AS foxy_daily_cap_enforced,
       public.get_plan_limit(ts.id, 'quiz')      AS quiz_daily_cap_enforced
FROM target_student ts;
```

**What you should see now (derived from migration `20260729130600`'s own
no-op proof, not asserted blind):** `get_plan_limit()` returns
`GREATEST(v_personal, v_school, v_institution_override)`. Concretely:

- **If the number you set in the panel is HIGHER than the student's
  pre-existing personal/school-derived cap:** `foxy_daily_cap_enforced` (or
  `quiz_daily_cap_enforced`) should now equal the number you set in the
  panel — it should **match the panel's Effective column exactly**. This is
  the case that proves the wiring: before `20260729130600` this query would
  have returned the OLD (lower) number regardless of what the panel showed;
  now it returns the number you set.
- **If the number you set is LOWER than or equal to the student's
  pre-existing cap:** the query will return the student's **unchanged**
  pre-existing cap, not your lower number. This is not a bug — see Section 4,
  this is the floor-not-ceiling behavior working exactly as designed. Do not
  read an unchanged result as "the save didn't take" without first checking
  whether your number was actually a raise or not (Section 3.1 will still
  show the row correctly stored either way).
- **Unlimited:** setting the panel's "Unlimited" checkbox stores `{max:
  null}`, which resolves to the shared sentinel `999999`. If the student's
  existing cap was already `999999` (e.g. an `unlimited`-tier plan), the
  query result will not visibly change even though the override IS stored
  and IS being read — again, floor semantics, not a failure.

If this query returns zero rows, the school has no active student — pick a
different school or create/activate one before using this check.

**If you set a raise and this query does NOT reflect it:** something is
actually wrong (stale connection pooling a cached plan, a typo in the
entitlement key, the school you queried isn't the same school you configured
in the panel, etc.) — this is now a real defect to escalate, not an expected
gap.

---

## Section 4 — Floor-semantics caveat: THIS PANEL CAN ONLY RAISE A QUOTA, NEVER LOWER ONE

**Read this in plain terms, no engineering background needed:**

> **This panel is a "give more" button, not a "take away" button.** If you
> type a number into this panel, the most it can do is guarantee a school's
> students get *at least* that many Foxy chats or quizzes per day. If the
> school's existing plan already gives them more than the number you typed,
> **they keep the higher number** — this panel cannot cut them down to a
> smaller amount. There is currently **no way, anywhere in the product, to
> use this panel to throttle or restrict a school below what its plan
> already allows.**

This is live, confirmed behavior as of migration `20260729130600`
(`RETURN GREATEST(v_personal, v_school, v_institution_override)`), not a
future intention — it is consistent with the same `GREATEST(personal,
school)` pattern already shipped for B2B plan coverage in migration
`20260729130400`.

**Worked example:** a school is on the `pro` plan, which already gives
unlimited Foxy chats. You open this panel and type `50` into "Foxy Chats per
Day," intending to restrict that school to 50/day. After you save: students
at that school **still get unlimited** Foxy chats. Your `50` is silently
ignored in this direction because the plan default (unlimited) is already
higher than your override. The panel will not warn you when this happens —
it will show your `50` as saved and "Override" in the state column, because
the row IS stored correctly; it is simply not the winning (highest) value at
enforcement time.

**If you ever need to actually cap or throttle a school below its plan
default** (e.g. a demo tenant is abusing free access, or a school needs to
be restricted for a billing dispute), **this panel cannot do it today.** That
is a new capability requiring its own design and review chain (architect +
backend) — do not assume setting a low number here will have any restrictive
effect. See the migration's own header ("OPEN PRODUCT QUESTION FOR THE CEO")
for the underlying design question, which is explicitly unresolved and
awaiting a product decision, not merely unbuilt.

---

## Section 5 — Teardown: clear an override (revert to inherit)

In the panel:

1. Navigate to the school (Section 2.1–2.2).
2. Find the row you previously overrode.
3. Click **"Revert to inherit"** on the right of that row. (This button is
   disabled/greyed if the row is already inheriting — nothing to revert.)
4. The row's State chip flips back to `Inherit` and the sticky save bar
   shows 1 change.
5. Click **Save**.

Under the hood this sends `{ key: "limit.foxy_chat_daily", _delete: true }`
in the PUT body, which deletes the `institution_entitlements` row for that
`(school_id, key)` pair — not a soft "set back to default" write. After
saving, Section 3.1's query should return **zero rows** for that key.

---

## Section 6 — Audit trail: who changed what quota, when

Every save writes one row per changed key to **both** `audit_logs`
(canonical) and `admin_audit_log` (legacy, dual-written for back-compat) via
`logAdminAudit()`. Fields:

| Field | Value |
|---|---|
| `action` | `entitlement.override.set` (a value was written) or `entitlement.override.clear` (reverted to inherit) |
| `entity_type` / `resource_type` | `institution_entitlement` |
| `entity_id` / `resource_id` | `<school_id>:<entitlement_key>` (e.g. `3f2...:limit.foxy_chat_daily`) |
| `details` | `school_id`, `key`, `category`, `old_value`, `new_value`, `contract_id`, `actor` (admin id) — **ids/keys/values only, never PII (P13)** |
| actor | the logged-in super-admin's identity (name/email enriched automatically) |

**In the UI:** Super Admin sidebar → **Logs** (`/super-admin/logs`). Filter
by:
- **Entity filter:** `institution_entitlement`
- **Action filter:** `entitlement.override` (matches both `.set` and
  `.clear` via the route's `ilike.*...*` match)
- Optionally a date range.

**In SQL**, if you want the raw rows for a specific school:

```sql
SELECT action, resource_id, details, created_at
FROM public.audit_logs
WHERE resource_type = 'institution_entitlement'
  AND resource_id LIKE '<SCHOOL_ID>:%'
ORDER BY created_at DESC;
```

(This one does need the school's UUID rather than its name, since
`resource_id` is stored as `school_id:key` — pull the UUID from the Section
3.1 query's `school_id` column if you don't already have it.)

---

## Section 7 — Known gaps (report to orchestrator, not fixed here)

| Gap | Impact | Who should fix |
|---|---|---|
| **Re-confirmed 2026-07-30, still present** — school picker is a plain `<select>` populated from `GET /api/super-admin/institutions?page=1&limit=100` (`apps/host/src/app/super-admin/entitlements/page.tsx`), capped at the 100 most-recently-created schools, no search/filter, no pagination inside the picker | A CEO cannot find or configure a school outside the newest 100 through this page at all. **Workaround for today:** if the target school doesn't appear in the dropdown, it was created earlier than the 100 most-recently-created schools — ask engineering to either raise the picker's page size for you one-off or query/update the row directly via Section 3.1's SQL pattern (swap the `SELECT` for the correct `INSERT`/`UPDATE` shape, or just ask an engineer to do it). Do not assume the school doesn't exist just because it's not in the list. | frontend (picker UX — add search/pagination), possibly backend (raise/paginate the institutions list call) |
| `super_admin`-only tier gate | Day-to-day quota administration may reasonably belong at `finance` tier instead of the platform's single highest tier | architect (RBAC decision) |
| **RESOLVED 2026-07-29** — ~~Enforcement not wired~~. Migration `20260729130600` wired `institution_entitlements` into `get_plan_limit()`. Kept here as a closed-item record, not an open gap. | N/A — closed | closed by architect (migration `20260729130600`) |
| **NEW gap, found 2026-07-30** — the panel's "Enforcement is OFF" banner (Section 2.3) is now misleading for the two Limit rows: it implies quota overrides don't take effect, but as of `20260729130600` they do, immediately, with no flag. The banner is still accurate for Module/Feature toggle rows, which genuinely wait on `ff_institution_entitlements_v1`. | An operator could under-trust a live change, or (worse) a future operator could assume ALL rows are inert and be surprised when a Limit change reaches students | frontend (split the banner copy per-section, or scope it to only the Modules/Features tables) |
| No per-student override in the data model | If "to whom" turns out to mean individual students rather than schools, this panel cannot serve that request at all — would need new schema | architect (schema), assessment (if it becomes a learner-facing quota concept) |
| **No ceiling/throttle capability** (Section 4) | An operator cannot use this panel to cap a school below its plan default; today's only usable direction is raising a quota | architect + backend (new scope if the CEO decides this is needed — see the migration's "OPEN PRODUCT QUESTION FOR THE CEO") |

---

## Related runbooks

- [`school-demo-playbook.md`](./school-demo-playbook.md) — the sibling
  investigation that produced the `get_plan_limit()` school-coverage fix
  (migration `20260729130400`) referenced throughout Section 0 and 3 above.
  Read it for the full "two disagreeing resolvers" background.
- [`b2b-school-activation-playbook.md`](./b2b-school-activation-playbook.md)
  — flag activation for a real pilot/paying school.
- [`feature-flag-governance.md`](./feature-flag-governance.md) — process for
  flipping `ff_institution_entitlements_v1`. **Note:** this flag no longer
  gates the two Limit rows (Foxy chats/day, quizzes/day) covered by this
  runbook — those went live with migration `20260729130600` and need no flag.
  The flag still gates the separate Module/Feature toggle enforcement path
  (`resolver.ts`'s `isEntitledEnforced()`), which remains unwired into any
  product route as of this writing.
