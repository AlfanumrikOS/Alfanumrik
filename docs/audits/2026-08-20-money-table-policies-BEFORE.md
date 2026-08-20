# Money-table RLS policies — BEFORE state (captured 2026-08-20 14:18:19.984326 UTC from shktyoxqhundlvkiwguu)

> **This is the ROLLBACK REFERENCE for the money-table policy fix.**
> If the fix must be reverted, the policy definitions below are the exact live state of
> production immediately before the change. Every `qual` / `with_check` body is reproduced
> verbatim as `pg_get_expr` emitted it — including indentation and embedded newlines.

- **Project ref:** `shktyoxqhundlvkiwguu` (PRODUCTION — the only environment)
- **Database:** `postgres`
- **Captured:** `2026-08-20 14:18:19.984326` UTC
- **Method:** read-only `SELECT` against `pg_policies` and `pg_class` via Supabase MCP `execute_sql`
- **Tables in scope:** `public.payment_history`, `public.student_subscriptions`, `public.subscription_events`, `public.student_daily_usage`
- **Total policies captured:** **21** (payment_history 6, student_subscriptions 5, subscription_events 5, student_daily_usage 5)
- **All policies are `PERMISSIVE`.** No `RESTRICTIVE` policy exists on any of the four tables.

## Capture query

```sql
SELECT schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('payment_history','student_subscriptions','subscription_events','student_daily_usage')
ORDER BY tablename, policyname;
```

## Row-security flags (`pg_class`)

| table | relrowsecurity | relforcerowsecurity |
|---|---|---|
| `payment_history` | `true` | `false` |
| `student_daily_usage` | `true` | `false` |
| `student_subscriptions` | `true` | `false` |
| `subscription_events` | `true` | `false` |

RLS is **enabled** on all four tables and **not forced** on any of them, so the table owner is
not itself subject to these policies (`service_role` bypasses RLS regardless).

## Shared predicate

Sixteen of the twenty-one policies use one identical "own row" predicate. It is written out in
full under every policy below; for reference the canonical body is:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

Note the two-branch shape: it matches when `student_id` equals the caller `auth.uid()`
**directly**, OR when `student_id` is any `students.id` whose `auth_user_id` is the caller.

---

## `public.payment_history` — 6 policies

| policyname | permissive | roles | cmd |
|---|---|---|---|
| `Students can insert own payment_history` | PERMISSIVE | `{public}` | INSERT |
| `payment_history_own_delete` | PERMISSIVE | `{authenticated}` | DELETE |
| `payment_history_own_insert` | PERMISSIVE | `{authenticated}` | INSERT |
| `payment_history_own_select` | PERMISSIVE | `{authenticated}` | SELECT |
| `payment_history_own_update` | PERMISSIVE | `{authenticated}` | UPDATE |
| `payments_service_write` | PERMISSIVE | `{service_role}` | ALL |

### `Students can insert own payment_history` (INSERT, `{public}`)

qual:

```
NULL
```

with_check:

```
(student_id = get_my_student_id())
```

### `payment_history_own_delete` (DELETE, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
NULL
```

### `payment_history_own_insert` (INSERT, `{authenticated}`)

qual:

```
NULL
```

with_check:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

### `payment_history_own_select` (SELECT, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
NULL
```

### `payment_history_own_update` (UPDATE, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

### `payments_service_write` (ALL, `{service_role}`)

qual:

```
true
```

with_check:

```
true
```

---

## `public.student_subscriptions` — 5 policies

| policyname | permissive | roles | cmd |
|---|---|---|---|
| `student_subscriptions_own_delete` | PERMISSIVE | `{authenticated}` | DELETE |
| `student_subscriptions_own_insert` | PERMISSIVE | `{authenticated}` | INSERT |
| `student_subscriptions_own_select` | PERMISSIVE | `{authenticated}` | SELECT |
| `student_subscriptions_own_update` | PERMISSIVE | `{authenticated}` | UPDATE |
| `subs_service_write` | PERMISSIVE | `{service_role}` | ALL |

### `student_subscriptions_own_delete` (DELETE, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
NULL
```

### `student_subscriptions_own_insert` (INSERT, `{authenticated}`)

qual:

```
NULL
```

with_check:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

### `student_subscriptions_own_select` (SELECT, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
NULL
```

### `student_subscriptions_own_update` (UPDATE, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

### `subs_service_write` (ALL, `{service_role}`)

qual:

```
true
```

with_check:

```
true
```

---

## `public.subscription_events` — 5 policies

| policyname | permissive | roles | cmd |
|---|---|---|---|
| `sub_events_service_write` | PERMISSIVE | `{service_role}` | ALL |
| `subscription_events_own_delete` | PERMISSIVE | `{authenticated}` | DELETE |
| `subscription_events_own_insert` | PERMISSIVE | `{authenticated}` | INSERT |
| `subscription_events_own_select` | PERMISSIVE | `{authenticated}` | SELECT |
| `subscription_events_own_update` | PERMISSIVE | `{authenticated}` | UPDATE |

### `sub_events_service_write` (ALL, `{service_role}`)

qual:

```
true
```

with_check:

```
true
```

### `subscription_events_own_delete` (DELETE, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
NULL
```

### `subscription_events_own_insert` (INSERT, `{authenticated}`)

qual:

```
NULL
```

with_check:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

### `subscription_events_own_select` (SELECT, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
NULL
```

### `subscription_events_own_update` (UPDATE, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

---

## `public.student_daily_usage` — 5 policies

| policyname | permissive | roles | cmd |
|---|---|---|---|
| `Service role manages usage` | PERMISSIVE | `{service_role}` | ALL |
| `student_daily_usage_own_delete` | PERMISSIVE | `{authenticated}` | DELETE |
| `student_daily_usage_own_insert` | PERMISSIVE | `{authenticated}` | INSERT |
| `student_daily_usage_own_select` | PERMISSIVE | `{authenticated}` | SELECT |
| `student_daily_usage_own_update` | PERMISSIVE | `{authenticated}` | UPDATE |

### `Service role manages usage` (ALL, `{service_role}`)

qual:

```
true
```

with_check:

```
true
```

### `student_daily_usage_own_delete` (DELETE, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
NULL
```

### `student_daily_usage_own_insert` (INSERT, `{authenticated}`)

qual:

```
NULL
```

with_check:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

### `student_daily_usage_own_select` (SELECT, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
NULL
```

### `student_daily_usage_own_update` (UPDATE, `{authenticated}`)

qual:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

with_check:

```
((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
```

---

## Baseline comparison

Compared against the earlier 2026-08-20 capture (21 policies; payment_history 6 /
student_subscriptions 5 / subscription_events 5 / student_daily_usage 5, all PERMISSIVE):

**MATCHES BASELINE.** No policy was added, removed, renamed, or re-scoped. Counts, names,
`permissive`, `roles`, and `cmd` all agree exactly with the expected baseline, and every
predicate body is the shape recorded above. Production has not moved since the earlier
capture, so the money-table policy fix may proceed against this BEFORE state.
