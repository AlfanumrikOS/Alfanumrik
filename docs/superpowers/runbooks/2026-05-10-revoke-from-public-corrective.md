# 2026-05-10 — REVOKE FROM PUBLIC corrective migration (post-#676 audit)

## TL;DR

PR #676 (`20260516040000_revoke_execute_internal_functions.sql`) was a **silent no-op** in production. The advisor count did not drop. The corrective migration `20260516050000_revoke_execute_from_public_corrective.sql` revokes `FROM PUBLIC` for 183 of the 186 functions, excluding 3 confirmed RLS helpers.

## Why #676 was a no-op

PR #676 issued `REVOKE EXECUTE ... FROM anon, authenticated` for 189 functions.

But the actual ACL on every targeted function looks like:

```
{=X/postgres,postgres=X/postgres,service_role=X/postgres}
```

The `=X/postgres` entry is the **default PostgreSQL grant to PUBLIC** at function creation. There is no explicit `anon=X` or `authenticated=X` entry to remove. `authenticated` and `anon` have EXECUTE *because they inherit from PUBLIC*, not because of a direct grant.

Verification SQL (run on prod 2026-05-10 after PR #676 merged):

```sql
SELECT
  COUNT(*) FILTER (WHERE p.prosecdef AND has_function_privilege('authenticated', p.oid::regprocedure::text, 'EXECUTE')) AS sec_def_auth_executable,
  COUNT(*) FILTER (WHERE p.prosecdef AND has_function_privilege('anon', p.oid::regprocedure::text, 'EXECUTE')) AS sec_def_anon_executable,
  COUNT(*) FILTER (WHERE p.prosecdef) AS total_sec_def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f';
```

Result: `{sec_def_auth_executable: 228, sec_def_anon_executable: 228, total_sec_def: 261}`. Of 261 SECURITY DEFINER functions, 228 are still callable by both `authenticated` and `anon` — virtually unchanged from pre-#676 state.

## RLS-helper audit — which functions cannot have PUBLIC EXECUTE revoked

```sql
WITH policy_text AS (
  SELECT string_agg(COALESCE(pol.qual::text,'') || ' ' || COALESCE(pol.with_check::text,''), ' ') AS combined
  FROM pg_policies pol
  JOIN pg_class pc ON pc.relname = pol.tablename
  JOIN pg_namespace pn ON pn.oid = pc.relnamespace
  WHERE pn.nspname = 'public'
),
public_fns AS (
  SELECT DISTINCT proname AS fn_name FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
)
SELECT f.fn_name FROM public_fns f, policy_text t
WHERE position(f.fn_name || '(' IN t.combined) > 0
ORDER BY f.fn_name;
```

10 functions are referenced inside RLS USING/WITH CHECK expressions:

- `get_admin_school_id`
- `get_my_guardian_id`
- `get_my_guardian_student_ids` ⚠️ (in #676 list)
- `get_my_student_id`
- `get_my_teacher_id`
- `get_my_teacher_student_ids` ⚠️ (in #676 list)
- `get_student_id_for_auth`
- `is_admin` ⚠️ (in #676 list)
- `is_guardian_of`
- `is_teacher_of`

Of these, **3 appear in the #676 REVOKE list**: `is_admin()` (line 193), `get_my_guardian_student_ids()` (line 172), `get_my_teacher_student_ids()` (line 174). These MUST keep PUBLIC EXECUTE — RLS evaluates these as the calling role (`authenticated` or `anon`), and a denied EXECUTE returns null/empty, silently breaking RLS visibility.

## What the corrective migration does

`20260516050000_revoke_execute_from_public_corrective.sql`:

- Re-issues each #676 REVOKE as `FROM PUBLIC` instead of `FROM anon, authenticated` — this is the only form that actually works, since the grant lives on PUBLIC.
- Excludes the 3 RLS-helper functions (`is_admin`, `get_my_guardian_student_ids`, `get_my_teacher_student_ids`).
- Total: 186 REVOKE statements covering 183 unique function names (3 names with overloads).
- Expected advisor reduction: ~366 WARNs (183 × 2 roles).

## Risk callouts

1. **Service-role bypass holds**: `service_role` ignores GRANT/REVOKE entirely, so anything called from `supabase-admin.ts`, edge functions with `SUPABASE_SERVICE_ROLE_KEY`, or pg_cron jobs is unaffected.

2. **Trigger functions safe**: Postgres invokes triggers without checking EXECUTE on the firing role.

3. **SQL-internal callers safe**: A function calling another function uses the *outer* function's privileges; nested REVOKE doesn't break the call chain.

4. **What WOULD break if a function is called from authenticated context**:
   - Direct `supabase.rpc('fn_name', …)` calls from the browser client (Bucket 1, NOT in this migration)
   - SECURITY INVOKER functions called via `SELECT fn(…)` from authenticated SQL
   - RLS policies referencing the function (mitigated — 3 known cases excluded)

5. **Bucket 4 "orphaned" classification was grep-based**, not exhaustive. If any of the 119 Bucket 4 functions is actually called from a client RPC, runtime errors will surface as `permission denied for function …`. Rollback pattern is per-function and committed in the migration footer.

## Rollback

If a specific function needs to be re-granted:

```sql
GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO authenticated;  -- or anon, or PUBLIC
```

The full rollback contract for #676 still applies — same signatures, same rollback SQL. See the footer of `20260516040000_revoke_execute_internal_functions.sql`.

## Verification after merge

Run the same prod query as above. Expected new result:

```
sec_def_auth_executable: ~45  (Bucket 1 RPCs + 16 Bucket 5 manual-review + 3 RLS helpers)
sec_def_anon_executable: ~45
total_sec_def: 261
```

Then re-fetch advisors via MCP `get_advisors` to confirm the WARN count drop.

## Related

- Original triage: `2026-05-09-function-executable-triage.md`
- No-op PR: AlfanumrikOS/Alfanumrik#676
- Bucket 5 manual review still pending — 16 functions awaiting per-function decision.
