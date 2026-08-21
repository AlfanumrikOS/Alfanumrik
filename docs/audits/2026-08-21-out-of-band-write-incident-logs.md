# Out-of-band write incidents — verbatim Postgres log export

**Captured:** 2026-08-21 · **Author:** read-only log export (no database was mutated to produce this file)
**Scope:** two out-of-band write sessions — Incident A (PRODUCTION `shktyoxqhundlvkiwguu`, 2026-08-18) and
Incident B (STAGING `gzpxqklxwzishrkiaatd`, 2026-08-20).

---

## Why this file exists — retention warning

Supabase log retention on these projects is **90 days, rolling**. Measured on 2026-08-21, the oldest entry
still present in the production unified log stream is **`2026-05-23T12:37:00.007Z`** (the brief cited
`2026-05-23T11:44Z`; the edge has advanced ~53 minutes since that earlier measurement, which is exactly what a
rolling window does).

That means:

| Incident | Log window | Ages out of retention on |
|---|---|---|
| A — production | 2026-08-18 | **2026-11-16** |
| B — staging | 2026-08-20 | **2026-11-18** |

After those dates the underlying log rows are gone and cannot be re-queried by anyone.
**This file is the durable record.** Do not delete it, and do not "refresh" it from logs after November 2026 —
there will be nothing to refresh from.

---

## Redaction note — the two actor identifiers are truncated

**Added 2026-08-21, immediately after this file was first committed.** Two values — and only two — were
shortened. They now appear in this exact form at **every** occurrence:

* `oauth:c36bf53d-…[REDACTED]` — the Incident B (staging) MCP actor
* `session:d7881e43-…[REDACTED]` — the Incident A (production) Studio actor

**Why.** Gitleaks' `generic-api-key` rule fires on the `oauth:<high-entropy-string>` /
`session:<high-entropy-string>` shape and failed the secret-scanning gate on this file. The rule matched a
*shape*, not a real credential.

**What these are.** Opaque session/user identifiers minted by the Supabase management plane and echoed back in
the `-- user:` statement trailer. They are **identifiers, not credentials** — they authenticate nothing, grant
nothing, and cannot be replayed. Truncating them is a scanner accommodation, not a security finding.

**Forensic impact — read this before November 2026.** The 8-character prefix is preserved and is written
identically everywhere, so the two actors stay distinguishable from each other and every mention still
cross-references correctly (`grep c36bf53d` / `grep d7881e43` still finds them all). The **full** values remain
recoverable from each project's `postgres_logs` only until that project's rolling window closes — **2026-11-16**
for Incident A (production) and **2026-11-18** for Incident B (staging), the same dates as the retention table
above. After those dates the truncated prefixes in this file are all that survives of them. If a full identifier
is ever needed, re-query before those dates; afterwards it is unrecoverable from any source.

**Nothing else was redacted.** Project refs, view/function/table names, SQL bodies, timestamps, pids, vxids, and
`alfanumrik@outlook.com` are all intact and verbatim. See §Redactions at the end of this file for the full
inventory of what was seen and kept.

---

## Method and provenance

* Source: Supabase MCP `query_logs`, `source = 'postgres_logs'`, run against each project explicitly by ref.
* The `query_logs` API caps each request at a 24-hour range; both windows here are under 24h so no paging was
  required. Boundary probes were run to confirm nothing was clipped (see per-incident notes).
* Two distinct fields carry statement text and they hold **disjoint** sets of rows:
  * `event_message` — carries `statement: …` lines (emitted by `log_statement = 'ddl'`) and
    `duration: … plan: Query Text: …` lines (emitted by auto_explain).
  * `log_attributes['parsed.query']` — carries the offending statement on **ERROR** rows.
  A search of only one field misses half the evidence. Both were searched for every window below.
* Statement bodies are reproduced verbatim. Individual statements longer than ~2000 characters are cut at that
  point and explicitly marked `[TRUNCATED — full length N chars]`.

### What Postgres does **not** log here (read this before concluding "it didn't happen")

1. `log_statement = 'ddl'` emits a `statement:` line only when the submitted string contains **top-level DDL**.
   A statement that is only `DELETE` / `INSERT` / `UPDATE` / a `DO $$ … $$` block produces **no** `statement:`
   line, even though it executed and committed.
2. Successful non-DDL statements therefore leave no trace at all unless they error or exceed the auto_explain
   duration threshold.
3. `UPDATE`s are invisible to DDL logging. This is directly relevant to the feature-flag question in Incident A
   (see §A.4).

---

# Incident A — PRODUCTION `shktyoxqhundlvkiwguu`, 2026-08-18

## A.1 Actor

Every row below carries one of two source trailers, both bound to the **same** Supabase Studio session id:

```
-- user: session:d7881e43-…[REDACTED]
```

with `-- source:` taking three distinct values across the session:

| `-- source:` value | What it means | Rows in window |
|---|---|---|
| `POST /platform/pg-meta/:ref/query` | Studio SQL runner / pg-meta query endpoint | 26 |
| `POST /mcp` | **MCP client** using the same Studio session token | 4 |
| `dashboard` | Studio SQL **editor** tab (`application_name = supabase/dashboard-query-editor` or `supabase/dashboard`) | 4 |

Database role on every write: **`postgres`** (superuser-equivalent). `application_name` is `mgmt-api` for the
pg-meta path, `supabase/dashboard-query-editor` for the editor path. Connections originate from
`2406:da18:96a:82xx::/…` (Supabase management plane egress), so the source IP is not the operator's.

**Row count captured for the requested window 12:00Z → 14:30Z: 34.**
(17 via `event_message`, 17 via `parsed.query`, disjoint.)

Boundary probe over the full day 2026-08-18 00:00Z–23:59Z returns rows for this session only in hours
12 (17), 13 (17), 14 (7) and 15 (4) — i.e. nothing before 12:00Z, and **11 rows after the requested 14:30Z
cutoff**. Those 11 are preserved in §A.3 rather than dropped, because they age out on the same date.

## A.2 Verbatim log — 12:00:00Z → 14:30:00Z (34 rows)

Legend: `sev` = `parsed.error_severity`, `sqlstate` = `parsed.sql_state_code`, `pid` = `parsed.process_id`.

---

### A-01 · `2026-08-18T12:01:47.394Z` · LOG · `mgmt-api` · `supabase_read_only_user` · pid 989413

auto_explain plan record, 20,452 chars. The statement is pg-meta's standard table/column introspection query.
Trailer embedded at offset 6737:

```
-- source: POST /mcp
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:01:31.630Z
Query Parameters: $1 = 'public', $2 = 'analytics'
```

`duration: 15274.779 ms`. Read-only introspection. `[TRUNCATED — full length 20452 chars]`

### A-02 · `2026-08-18T12:02:14.492Z` · LOG · `mgmt-api` · `supabase_read_only_user` · pid 989428

Same introspection query. `duration: 15561.804 ms`.

```
-- source: POST /mcp
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:01:58.422Z
Query Parameters: $1 = 'public'
```

`[TRUNCATED — full length 20409 chars]`

### A-03 · `2026-08-18T12:03:48.795Z` · LOG · `mgmt-api` · `supabase_read_only_user` · pid 990098

Same introspection query. `duration: 16273.869 ms`.

```
-- source: POST /mcp
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:03:32.031Z
Query Parameters: $1 = 'public', $2 = 'storage'
```

`[TRUNCATED — full length 20448 chars]`

### A-04 · `2026-08-18T12:04:18.706Z` · LOG · `mgmt-api` · `supabase_read_only_user` · pid 990112

Same introspection query. `duration: 16986.960 ms`.

```
-- source: POST /mcp
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:04:01.213Z
Query Parameters: $1 = 'public', $2 = 'storage'
```

`[TRUNCATED — full length 20448 chars]`

### A-05 · `2026-08-18T12:18:56.445Z` · **ERROR** `42702` · `mgmt-api` · `postgres` · pid 991175

`column reference "relname" is ambiguous`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_agg(x)::text r from (
 select relname, n_live_tup live, pg_size_pretty(pg_total_relation_size(c.oid)) sz,
        last_autovacuum is not null as vac, seq_scan, idx_scan
 from pg_stat_user_tables s join pg_class c on c.oid=s.relid
 where s.schemaname='public'
 order by pg_total_relation_size(c.oid) desc limit 35
) x

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:18:55.982Z
```

### A-06 · `2026-08-18T12:20:06.880Z` · **ERROR** `42703` · `mgmt-api` · `postgres` · pid 991205

`column "is_enabled" does not exist`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_build_object(
'cron_jobs',(select json_agg(json_build_object('j',jobname,'s',schedule,'act',active) order by jobname) from cron.job),
'cron_recent_fail',(select json_agg(json_build_object('j',jobid,'st',status,'n',c) ) from (select jobid,status,count(*) c from cron.job_run_details where start_time > now()-interval '3 days' group by 1,2) z),
'alert_rules',(select count(*) from alert_rules),
'alert_rules_enabled',(select count(*) from alert_rules where coalesce(is_enabled,enabled,true)),
'alert_dispatches_7d',(select count(*) from alert_dispatches where created_at > now()-interval '7 days'),
'notification_channels',(select count(*) from notification_channels)
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:20:06.401Z
```

### A-07 · `2026-08-18T12:20:17.892Z` · **ERROR** `42703` · `mgmt-api` · `postgres` · pid 991215

`column "created_at" does not exist`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_build_object(
'cron_jobs',(select json_agg(json_build_object('j',jobname,'s',schedule,'act',active) order by jobname) from cron.job),
'alert_rules',(select count(*) from alert_rules),
'alert_rules_enabled',(select count(*) from alert_rules where enabled),
'alert_dispatches_total',(select count(*) from alert_dispatches),
'alert_dispatches_7d',(select count(*) from alert_dispatches where created_at > now()-interval '7 days'),
'notification_channels',(select count(*) from notification_channels)
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:20:17.409Z
```

### A-08 · `2026-08-18T12:26:19.610Z` · **ERROR** `42703` · `mgmt-api` · `postgres` · pid 992027

`column "event_type" does not exist`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_build_object(
'se_max',(select to_char(max(created_at),'YYYY-MM-DD HH24:MI') from state_events),
'se_min',(select to_char(min(created_at),'YYYY-MM-DD HH24:MI') from state_events),
'se_types',(select string_agg(t||'='||n,', ') from (select event_type t,count(*) n from state_events group by 1 order by 2 desc limit 10) z),
'se_cols',(select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_name='state_events'),
'offsets',(select json_agg(to_jsonb(s)) from state_events_subscriber_offsets s),
'deadletters',(select count(*) from subscriber_dead_letters),
'tables_like_offset',(select string_agg(tablename,', ') from pg_tables where schemaname='public' and (tablename ilike '%offset%' or tablename ilike '%dead_letter%'))
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:26:19.128Z
```

### A-09 · `2026-08-18T12:26:36.789Z` · **ERROR** `42703` · `mgmt-api` · `postgres` · pid 992032

`column "created_at" does not exist`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_build_object(
'se_max',(select to_char(max(created_at),'YYYY-MM-DD HH24:MI') from state_events),
'se_kinds',(select string_agg(k||'='||n,', ') from (select kind k,count(*) n from state_events group by 1 order by 2 desc limit 12) z),
'se_last7d',(select count(*) from state_events where created_at>now()-interval '7 days'),
'offsets',(select json_agg(to_jsonb(s)) from subscriber_offsets s),
'deadletters',(select count(*) from subscriber_dead_letters),
'dl_recent',(select to_char(max(created_at),'YYYY-MM-DD') from subscriber_dead_letters),
'retry_state',(select count(*) from subscriber_retry_state)
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:26:36.325Z
```

### A-10 · `2026-08-18T12:29:31.908Z` · **ERROR** `42703` · `mgmt-api` · `postgres` · pid 992120

`column "created_at" does not exist`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_build_object(
'auth_users',(select count(*) from auth.users),
'auth_users_7d',(select count(*) from auth.users where last_sign_in_at>now()-interval '7 days'),
'students',(select count(*) from students),
'foxy_msgs_7d',(select count(*) from foxy_chat_messages where created_at>now()-interval '7 days'),
'foxy_msgs_total',(select count(*) from foxy_chat_messages),
'foxy_last',(select to_char(max(created_at),'YYYY-MM-DD') from foxy_chat_messages),
'quiz_resp_7d',(select count(*) from quiz_responses where created_at>now()-interval '7 days'),
'mol_logs_7d',(select count(*) from mol_request_logs where created_at>now()-interval '7 days'),
'circuit',(select json_agg(to_jsonb(c)) from (select * from security_circuit_state limit 5) c),
'ops_events_7d',(select count(*) from ops_events where created_at>now()-interval '7 days')
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:29:31.432Z
```

### A-11 · `2026-08-18T12:30:52.997Z` · **ERROR** `42883` · `mgmt-api` · `postgres` · pid 992790

`function round(double precision, integer) does not exist`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_build_object(
'top_queries',(select json_agg(json_build_object('ms',round(total_exec_time)::int,'calls',calls,'mean',round(mean_exec_time,1),'q',left(regexp_replace(query,'\s+',' ','g'),90))) from (select * from pg_stat_statements order by total_exec_time desc limit 8) z),
'audit_last',(select to_char(max(created_at),'YYYY-MM-DD') from audit_logs),
'audit_7d',(select count(*) from audit_logs where created_at>now()-interval '7 days'),
'grounded_traces',(select count(*) from grounded_ai_traces),
'grounded_last',(select to_char(max(created_at),'YYYY-MM-DD') from grounded_ai_traces),
'retrieval_traces',(select count(*) from retrieval_traces)
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:30:52.523Z
```

### A-12 · `2026-08-18T12:31:14.934Z` · **ERROR** `42703` · `mgmt-api` · `postgres` · pid 992797

`column "status" does not exist`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_build_object(
'audit_last',(select to_char(max(created_at),'YYYY-MM-DD') from audit_logs),
'audit_7d',(select count(*) from audit_logs where created_at>now()-interval '7 days'),
'grounded_traces',(select count(*) from grounded_ai_traces),
'grounded_last',(select to_char(max(created_at),'YYYY-MM-DD') from grounded_ai_traces),
'retrieval_traces',(select count(*) from retrieval_traces),
'agent_runs',(select count(*) from agent_runs),
'net_resp',(select count(*) from net._http_response),
'synthetic_recent',(select json_agg(json_build_object('s',status,'n',n)) from (select status,count(*) n from synthetic_monitor_results where created_at>now()-interval '2 days' group by 1) s)
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:31:14.455Z
```

### A-13 · `2026-08-18T12:39:16.038Z` · LOG · `mgmt-api` · `postgres` · pid 993027 · vxid 85/6513

**First confirmed write of the session.** Logged because the transaction contains a `drop index` (DDL). The
`update` and `delete` inside the same transaction would not have been logged on their own.

```sql
statement: SET statement_timeout='58s'; SET idle_session_timeout='58s';
begin;
update alert_rules
   set enabled = true,
       channel_ids = array['9a8e9894-a56e-4d63-b11e-f1128ace31fc'::uuid],
       updated_at = now()
 where id in ('6e075a6f-fd5f-4299-9440-290491931191',
              'a74bf069-bdfd-4c84-aa05-4ae9cddd2cf8',
              'c02bf745-042f-4f7e-ad1b-1453a9368ba3');

delete from subscriber_offsets where subscriber_name = 'happy-08d48d';

drop index if exists public.idx_learner_twin_memory_embedding_hnsw;
commit;
select json_build_object(
 'rules_enabled',(select count(*) from alert_rules where enabled),
 'rules_with_channel',(select count(*) from alert_rules where coalesce(array_length(channel_ids,1),0)>0),
 'subscribers',(select string_agg(subscriber_name,', ') from subscriber_offsets),
 'twin_hnsw',(select count(*) from pg_indexes where tablename='learner_twin_memory' and indexdef ilike '%hnsw%')
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:39:15.564Z
```

### A-14 · `2026-08-18T12:39:42.144Z` · LOG · `mgmt-api` · `postgres` · pid 993038

`failed to parse schedule: 60 seconds`

### A-15 · `2026-08-18T12:39:42.144Z` · **ERROR** `22023` · `mgmt-api` · `postgres` · pid 993038

`invalid schedule: 60 seconds` — same statement as A-14, cron reschedule attempt, rejected.

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select cron.unschedule('synthetic-host-monitor-tick') as a,
       cron.alter_job((select jobid from cron.job where jobname='agent-worker-tick-every-minute'), schedule => '60 seconds') as b,
       cron.alter_job((select jobid from cron.job where jobname='agent-timeout-sweep-every-minute'), schedule => '*/5 * * * *') as c

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:39:41.669Z
```

> Note: the statement is a single expression list. Because `cron.unschedule(…) as a` is evaluated in the same
> target list that raised, the whole statement aborted — but this log does **not** by itself establish whether
> the `unschedule` took effect. Verify `cron.job` directly if that matters.

### A-16 · `2026-08-18T12:46:43.823Z` · **ERROR** `42703` · `mgmt-api` · `postgres` · pid 993920

`column "event_type" does not exist`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_build_object(
'email_tables',(select string_agg(tablename,', ') from pg_tables where schemaname='public' and tablename ~* 'email|mail'),
'ops_email_events',(select json_agg(json_build_object('t',event_type,'n',n,'last',to_char(mx,'MM-DD'))) from (select event_type,count(*) n,max(occurred_at) mx from ops_events where event_type ~* 'email|relay|mail' group by 1 order by 2 desc limit 12) z),
'ops_cols',(select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_name='ops_events')
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:46:43.339Z
```

### A-17 · `2026-08-18T12:48:04.596Z` · **ERROR** `42703` · `mgmt-api` · `postgres` · pid 993942

`column "created_at" does not exist`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_build_object(
'payment_tables',(select string_agg(tablename,', ') from pg_tables where schemaname='public' and tablename ~* 'payment|subscription|order|invoice|razorpay'),
'webhook_events',(select count(*) from payment_webhook_events),
'webhook_last',(select to_char(max(created_at),'YYYY-MM-DD HH24:MI') from payment_webhook_events)
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T12:48:04.114Z
```

### A-18 · `2026-08-18T13:12:02.121Z` · LOG · `mgmt-api` · `postgres` · pid 995704 · vxid 58/5911

**The `_rls_policy_backup_20260818` creation named in the incident brief.**

```sql
statement: SET statement_timeout='58s'; SET idle_session_timeout='58s';
create table if not exists public._rls_policy_backup_20260818 as
select schemaname, tablename, policyname, cmd, roles::text roles, qual, with_check, now() captured_at
from pg_policies
where (schemaname='realtime' and tablename='messages');
select count(*) backed_up from public._rls_policy_backup_20260818

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:12:01.636Z
```

### A-19 · `2026-08-18T13:12:02.134Z` · LOG · `mgmt-api` · `postgres` · pid 995704

`rls_auto_enable: enabled RLS on public._rls_policy_backup_20260818`

A project-local guard fired on the new table and enabled RLS automatically, 13 ms after A-18. The `parsed.query`
on this row is the same statement as A-18. **No policies were created** — only `ENABLE ROW LEVEL SECURITY`.

### A-20 · `2026-08-18T13:28:08.248Z` · LOG · `supabase/dashboard-query-editor` · `postgres` · pid 997251

**The statement self-headed "Author: Backend/DB Doctor, 2026-08-18".** Executed from the Studio SQL editor tab
(`-- source: dashboard`, not pg-meta). Full length 10,231 chars.

Head:

```sql
statement: -- ============================================================================
-- Alfanumrik — learning-loop health monitor
-- Project: shktyoxqhundlvkiwguu
-- Author: Backend/DB Doctor, 2026-08-18
-- STATUS: NOT APPLIED. Authored but blocked from direct execution (see report).
--         Ship through CI like any other migration.
--
-- WHY: Your monitoring currently answers "does the demo subdomain return 200".
--      It returned 100% OK, p95 ~850ms, every 5 minutes, for the entire period
--      in which mastery never computed, no diagram image existed, 18,750
--      questions sat unembedded, and 246 consecutive alerts failed to deliver.
--      This adds checks for the invariants that actually define the product.
--
-- DESIGN NOTES
--  * One category, `learning_loop_stale`, with per-check severity. Matches the
--    existing convention: alert_rules.category is compared to
--    ops_events.category exactly, gated by min_severity.
--  * Every emit is deduplicated on (category, message) over a 6-hour window.
--    This is deliberate: `stuck_pending_payments` produced 439 rows for one
--    stuck record because its emitter had no dedup. Do not remove this.
--  * Check 5 monitors the alerting channel itself. If delivery is broken, that
--    fact at least lands in ops_events where a human or a dashboard can see it.
-- ============================================================================

create or replace function public.ops_check_learning_loop_health()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_emitted   integer  := 0;
  v_dedup     interval := interval '6 hours';
  v_quiz_24h  bigint;
  v_att_total bigint;
  v_att_24h   bigint;
  v_pending   bigint;
  v_done      bigint;
  v_bad_img   bigint;
  v_disp_fail bigint;
  v_disp_ok   bigint;
  r           record;
begin
  ------------------------------------------------------------------
  -- 1.
```

`[TRUNCATED — full length 10231 chars]`

Tail (verbatim, including the trailer):

```sql
y = 'learning_loop_stale' order by occurred_at desc;
-- select public.ops_check_learning_loop_health();   -- expect 0 new rows

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- select cron.unschedule('learning-loop-health');
-- delete from alert_rules where name = 'Learning loop broken';
-- drop function if exists public.ops_check_learning_loop_health();

-- source: dashboard
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:28:07.759Z
```

> **Contradiction on the record.** The statement's own header says `STATUS: NOT APPLIED. Authored but blocked
> from direct execution … Ship through CI like any other migration.` The log shows it was **executed**, from the
> SQL editor, at 13:28:08. See A-21 for the immediate consequence.

### A-21 · `2026-08-18T13:30:00.219Z` · **ERROR** `23502` · `pg_cron` · `postgres`

`null value in column "occurred_at" of relation "ops_events" violates not-null constraint`

```sql
select public.ops_check_learning_loop_health()
```

This row does **not** carry the session trailer — it is `pg_cron` executing on its own schedule. It is included
because it is the direct downstream effect of A-20: 112 seconds after the function was created from the SQL
editor, a **cron job was already invoking it in production**, and failing. This establishes that A-20 created
both the function and a live schedule, not just a function.

### A-22 · `2026-08-18T13:32:29.117Z` · **ERROR** `42703` · `mgmt-api` · `postgres` · pid 997356

`column "requests_per_minute" does not exist`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_build_object(
'qb_emb_cols',(select string_agg(column_name,',') from information_schema.columns where table_name='question_bank' and column_name in ('embedding','embedding_model','embedded_at','embedding_text','updated_at')),
'route_policy',(select json_agg(json_build_object('route',route,'role',role,'rpm',requests_per_minute,'rpd',requests_per_day)) from security_route_policies where route ilike '%embed%'),
'route_policy_cols',(select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_name='security_route_policies'),
'qb_by_grade',(select string_agg(coalesce(grade::text,'null')||'='||n,', ') from (select grade,count(*) n from question_bank where embedding is null group by 1 order by 2 desc limit 12) z)
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:32:28.633Z
```

### A-23 · `2026-08-18T13:35:42.088Z` · LOG · `supabase/dashboard` · `postgres` · pid 998035

auto_explain plan record for Studio's own schema introspection, `duration: 12970.464 ms`.

```
-- source: dashboard
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:35:28.581Z
```

`[TRUNCATED — full length 19996 chars]`

### A-24 · `2026-08-18T13:35:45.942Z` · **ERROR** `23502` · `mgmt-api` · `postgres` · pid 998041

`null value in column "occurred_at" of relation "ops_events" violates not-null constraint`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';select public.ops_check_learning_loop_health() as emitted

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:35:45.446Z
```

### A-25 · `2026-08-18T13:38:07.875Z` · LOG · `mgmt-api` · `postgres` · pid 998107 · vxid 56/6361

**`ops_check_learning_loop_health` rewrite #1** (compacted, `occurred_at` supplied). Full length 5,524 chars.

```sql
statement: SET statement_timeout='58s'; SET idle_session_timeout='58s';
create or replace function public.ops_check_learning_loop_health()
returns integer language plpgsql security definer
set search_path = public, pg_catalog as $fn$
declare
  v_emitted integer := 0; v_dedup interval := interval '6 hours';
  v_quiz_24h bigint; v_att_total bigint; v_att_24h bigint;
  v_pending bigint; v_done bigint; v_bad_img bigint;
  v_disp_fail bigint; v_disp_ok bigint; r record;
begin
  select count(*) into v_quiz_24h from quiz_responses where created_at > now() - interval '24 hours';
  select count(*) into v_att_total from concept_attempts;
  select count(*) into v_att_24h from concept_attempts where created_at > now() - interval '24 hours';

  if v_att_total = 0 then
    insert into ops_events (occurred_at, category, source, severity, message, context)
    select now(), 'learning_loop_stale', 'cron/learning-loop-health', 'critical',
           'mastery_pipeline_never_ran: concept_attempts is empty',
           jsonb_build_object('quiz_responses_total',(select count(*) from quiz_responses),'concept_attempts_total',0)
    where not exists (select 1 from ops_events where category='learning_loop_stale'
       and message='mastery_pipeline_never_ran: concept_attempts is empty' and occurred_at > now() - v_dedup);
    v_emitted := v_emitted + 1;
  elsif v_quiz_24h > 0 and v_att_24h = 0 then
    insert into ops_events (occurred_at, category, source, severity, message, context)
    select now(), 'learning_loop_stale', 'cron/learning-loop-health', 'critical',
           'mastery_pipeline_disconnected: quiz activity with no concept_attempts',
           jsonb_build_object('quiz_responses_24h',v_quiz_24h,'concept_attempts_24h',0)
    where not exists (select 1 from ops_events where category='learning_loop_stale'
       and message='mastery_pipeline_disconnected: quiz activity with no concept_attempts' and occurred_at > now() - v_dedup);
    v_emitted := v_emitted + 1;
  end if;

  for r in
```

`[TRUNCATED — full length 5524 chars]`

Tail:

```sql
nb_build_object('failed_6h',v_disp_fail,'sent_6h',0,
             'last_error',(select delivery_error from alert_dispatches where delivery_error is not null order by fired_at desc limit 1))
    where not exists (select 1 from ops_events where category='learning_loop_stale'
       and message='alert_delivery_failing: every dispatch in the last 6h failed' and occurred_at > now() - v_dedup);
    v_emitted := v_emitted + 1;
  end if;

  return v_emitted;
end; $fn$;

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:38:07.401Z
```

### A-26 · `2026-08-18T13:38:20.313Z` · **ERROR** `23502` · `mgmt-api` · `postgres` · pid 998110

`null value in column "environment" of relation "ops_events" violates not-null constraint`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';
select json_build_object(
'vault_names',(select string_agg(name,', ' order by name) from vault.secrets),
'monitor_emitted',(select public.ops_check_learning_loop_health()),
'loop_events',(select json_agg(json_build_object('sev',severity,'msg',message)) from ops_events where category='learning_loop_stale')
)::text r

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:38:19.837Z
```

> This statement enumerates `vault.secrets` **names** (`select string_agg(name, …)`), not
> `vault.decrypted_secrets` values. No secret material is present in this row.

### A-27 · `2026-08-18T13:40:50.824Z` · LOG · `mgmt-api` · `postgres` · pid 998173 · vxid 105/6227

**`ops_check_learning_loop_health` rewrite #2** — adds the `environment` column ('production') to every insert.
Full length 5,578 chars. Head is identical to A-25 up to the first `insert into ops_events`, which becomes:

```sql
    insert into ops_events (occurred_at, environment, category, source, severity, message, context)
    select now(), 'production', 'learning_loop_stale', 'cron/learning-loop-health', 'critical', 'mastery_pipeline_never_ran: concept_attempts is empty',
           jsonb_build_object('quiz_responses_total',(select count(*) from quiz_responses),'concept_attempts_total',0)
    where not exists (select 1 from ops_events where category='learning_loop_stale' and message='mastery_pipeline_never_ran: concept_attempts is empty' and occurred_at > now() - v_dedup);
```

`[TRUNCATED — full length 5578 chars]` · trailer `-- source: POST /platform/pg-meta/:ref/query` · `-- date: 2026-08-18T13:40:50.355Z`

### A-28 · `2026-08-18T13:45:19.436Z` · LOG · `mgmt-api` · `postgres` · pid 998890 · vxid 28/5686

**`reconcile_embedding_backfill_queue` created (v1, `status='completed'`).**

```sql
statement: SET statement_timeout='58s'; SET idle_session_timeout='58s';
create or replace function public.reconcile_embedding_backfill_queue()
returns integer language plpgsql security definer
set search_path = public, pg_catalog as $fn$
declare v_a integer := 0; v_b integer := 0;
begin
  update embedding_backfill_queue q
     set status='completed', processed_at=now(), updated_at=now(), last_error=null
   where q.status='pending' and q.source_table='question_bank'
     and exists (select 1 from question_bank b where b.id=q.source_id and b.embedding is not null);
  get diagnostics v_a = row_count;

  update embedding_backfill_queue q
     set status='completed', processed_at=now(), updated_at=now(), last_error=null
   where q.status='pending' and q.source_table='rag_content_chunks'
     and exists (select 1 from rag_content_chunks c where c.id=q.source_id and c.embedding is not null);
  get diagnostics v_b = row_count;

  return v_a + v_b;
end; $fn$;

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:45:18.959Z
```

### A-29 · `2026-08-18T13:45:20.181Z` · LOG · `mgmt-api` · `postgres` · pid 998892 · vxid 13/6000

```sql
statement: SET statement_timeout='58s'; SET idle_session_timeout='58s';revoke all on function public.reconcile_embedding_backfill_queue() from public, anon, authenticated

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:45:19.714Z
```

### A-30 · `2026-08-18T13:45:20.857Z` · **ERROR** `23514` · `mgmt-api` · `postgres` · pid 998893

`new row for relation "embedding_backfill_queue" violates check constraint "embedding_backfill_queue_status_check"`

```sql
SET statement_timeout='58s'; SET idle_session_timeout='58s';select public.reconcile_embedding_backfill_queue() as closed

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:45:20.363Z
```

### A-31 · `2026-08-18T13:46:35.646Z` · LOG · `mgmt-api` · `postgres` · pid 998921 · vxid 63/7396

**`reconcile_embedding_backfill_queue` rewrite (v2, `status='done'`)** — fixes A-30.

```sql
statement: SET statement_timeout='58s'; SET idle_session_timeout='58s';
create or replace function public.reconcile_embedding_backfill_queue()
returns integer language plpgsql security definer
set search_path = public, pg_catalog as $fn$
declare v_a integer := 0; v_b integer := 0;
begin
  update embedding_backfill_queue q
     set status='done', processed_at=now(), updated_at=now(), last_error=null
   where q.status='pending' and q.source_table='question_bank'
     and exists (select 1 from question_bank b where b.id=q.source_id and b.embedding is not null);
  get diagnostics v_a = row_count;

  update embedding_backfill_queue q
     set status='done', processed_at=now(), updated_at=now(), last_error=null
   where q.status='pending' and q.source_table='rag_content_chunks'
     and exists (select 1 from rag_content_chunks c where c.id=q.source_id and c.embedding is not null);
  get diagnostics v_b = row_count;

  return v_a + v_b;
end; $fn$;

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:46:35.163Z
```

### A-32 · `2026-08-18T13:46:36.334Z` · LOG · `mgmt-api` · `postgres` · pid 998923 · vxid 7/5654

```sql
statement: SET statement_timeout='58s'; SET idle_session_timeout='58s';revoke all on function public.reconcile_embedding_backfill_queue() from public, anon, authenticated

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:46:35.848Z
```

### A-33 · `2026-08-18T13:48:02.660Z` · LOG · `mgmt-api` · `postgres` · pid 998934 · vxid 43/5746

**`run_embedding_backfill_tick` created.** This function reads two Vault secrets by name and calls an Edge
Function over `pg_net`.

```sql
statement: SET statement_timeout='58s'; SET idle_session_timeout='58s';
create or replace function public.run_embedding_backfill_tick()
returns text language plpgsql security definer
set search_path = public, pg_catalog, extensions as $fn$
declare
  v_remaining bigint; v_admin_key text; v_svc_key text; v_request bigint;
begin
  select count(*) into v_remaining from question_bank where embedding is null;

  if v_remaining = 0 then
    perform public.reconcile_embedding_backfill_queue();
    return 'idle: question_bank fully embedded';
  end if;

  select decrypted_secret into v_admin_key from vault.decrypted_secrets where name='ADMIN_API_KEY' limit 1;
  select decrypted_secret into v_svc_key   from vault.decrypted_secrets where name='projector_runner_service_role_key_v2' limit 1;

  if v_admin_key is null then
    insert into ops_events (occurred_at, environment, category, source, severity, message, context)
    values (now(),'production','learning_loop_stale','cron/embedding-backfill','error',
            'embedding_backfill_misconfigured: vault secret ADMIN_API_KEY is missing',
            jsonb_build_object('remaining', v_remaining));
    return 'error: missing vault secret ADMIN_API_KEY';
  end if;

  select net.http_post(
    url     := 'https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/embed-questions',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || coalesce(v_svc_key,''),
                 'x-admin-key', v_admin_key),
    body    := jsonb_build_object('limit', 2000),
    timeout_milliseconds := 150000
  ) into v_request;

  perform public.reconcile_embedding_backfill_queue();
  return 'dispatched request ' || v_request || '; remaining before tick: ' || v_remaining;
end; $fn$;

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:48:02.166Z
```

> **Secret handling:** the logged text references Vault secrets **by name only**
> (`ADMIN_API_KEY`, `projector_runner_service_role_key_v2`) and binds their values into local variables at
> runtime. **No secret value appears in any log row in this window** — nothing here was redacted for secrecy.
> (The `-- user:` actor identifier above is truncated, as it is throughout this file — see §Redaction note.)

### A-34 · `2026-08-18T13:48:03.336Z` · LOG · `mgmt-api` · `postgres` · pid 998936 · vxid 18/6178

```sql
statement: SET statement_timeout='58s'; SET idle_session_timeout='58s';revoke all on function public.run_embedding_backfill_tick() from public, anon, authenticated

-- source: POST /platform/pg-meta/:ref/query
-- user: session:d7881e43-…[REDACTED]
-- date: 2026-08-18T13:48:02.873Z
```

### A-35 · `2026-08-18T13:54:49.443Z` · LOG · `mgmt-api` · `postgres` · pid 999701 · vxid 54/6828

**`ops_check_learning_loop_health` rewrite #3** — replaces the unconditional `v_emitted := v_emitted + 1` with
`get diagnostics v_n = row_count; v_emitted := v_emitted + v_n;` so the dedup guard is actually reflected in the
return value. Full length 5,742 chars.

```sql
statement: SET statement_timeout='58s'; SET idle_session_timeout='58s';
create or replace function public.ops_check_learning_loop_health()
returns integer language plpgsql security definer
set search_path = public, pg_catalog as $fn$
declare
  v_emitted integer := 0; v_n integer := 0; v_dedup interval := interval '6 hours';
  v_quiz_24h bigint; v_att_total bigint; v_att_24h bigint;
  v_pending bigint; v_done bigint; v_bad_img bigint;
  v_disp_fail bigint; v_disp_ok bigint; r record;
begin
  select count(*) into v_quiz_24h from quiz_responses where created_at > now() - interval '24 hours';
  select count(*) into v_att_total from concept_attempts;
  select count(*) into v_att_24h from concept_attempts where created_at > now() - interval '24 hours';

  if v_att_total = 0 then
    insert into ops_events (occurred_at, environment, category, source, severity, message, context)
    select now(), 'production', 'learning_loop_stale', 'cron/learning-loop-health', 'critical', 'mastery_pipeline_never_ran: concept_attempts is empty',
      jsonb_build_object('quiz_responses_total',(select count(*) from quiz_responses),'concept_attempts_total',0)
    where not exists (select 1 from ops_events where category='learning_loop_stale' and message='mastery_pipeline_never_ran: concept_attempts is empty' and occurred_at > now() - v_dedup); get diagnostics v_n = row_count; v_emitted := v_emitted + v_n;
  elsif v_quiz_24h > 0 and v_att_24h = 0 then
    insert into ops_events (occurred_at, environment, category, source, severity, message, context)
    select now(), 'production', 'learning_loop_stale', 'cron/learning-loop-health', 'critical', 'mastery_pipeline_disconnected: quiz activity with no concept_attempts',
      jsonb_build_object('quiz_responses_24h',v_quiz_24h,'concept_attempts_24h',0)
    where not exists (select 1 from ops_events where category='learning_loop_stale' and message='mastery_pipeline_disconnected: quiz activity with no concept_attempts' and occurred_at > now() - v_dedu
```

`[TRUNCATED — full length 5742 chars]` · trailer `-- source: POST /platform/pg-meta/:ref/query` · `-- date: 2026-08-18T13:54:48.959Z`

> **Row-count reconciliation.** The requested window contains 34 session-attributable rows. This section lists 35
> numbered entries because **A-21 (`pg_cron`) is not one of them** — it carries no session trailer and is
> included as downstream-effect evidence. 35 − 1 = 34. ✔

## A.3 Appendix — same session, 14:30Z → 16:00Z (11 further rows, outside the requested window)

These are preserved because they age out on the same date and are otherwise unrecoverable.

| # | Timestamp (UTC) | sev | app | pid | Summary |
|---|---|---|---|---|---|
| A-a1 | 13:50-authored, logged `14:45:38.525` | LOG | `dashboard-query-editor` | 1003795 | 12,352-char file headed `STATUS AS OF 2026-08-18 13:50 — PARTIALLY APPLIED, THEN STOPPED` |
| A-a2 | `14:45:52.396` | LOG | `dashboard-query-editor` | 1003809 | 10,522-char learning-loop monitor, header now `STATUS: v2 (2026-08-18 13:35). v1 was applied and FAILED on first cron run` |
| A-a3 | `14:48:03.619` | **ERROR** `21000` | `mgmt-api` | 1003859 | `more than one row returned by a subquery used as an expression` — diagnostic read on `alert_rules` |
| A-a4 | `14:48:52.523` | LOG | `mgmt-api` | 1003882 | `create unique index if not exists alert_rules_name_key on public.alert_rules (name)` |
| A-a5 | `14:49:13.046` | LOG | `mgmt-api` | 1003889 | identical statement, re-submitted |
| A-a6 | `14:50:19.877` | LOG | `mgmt-api` | 1003912 | `create unique index if not exists alert_rules_name_uniq on public.alert_rules (name); select …` |
| A-a7 | `14:59:49.392` | LOG | `dashboard-query-editor` | 1004728 | monitor v2 re-run, 10,777 chars |
| A-a8 | `15:00:04.120` | LOG | `dashboard-query-editor` | 1004752 | STATUS file re-run, 12,841 chars |
| A-a9 | `15:01:32.276` | LOG | `mgmt-api` | 1004803 | `reconcile_embedding_backfill_queue` **v3** — adds a third branch for `textbook_chunks`, then `select public.reconcile_embedding_backfill_queue() as closed_now` |
| A-a10 | `15:04:38.870` | LOG | `dashboard-query-editor` | 1004865 | STATUS file re-run, 13,541 chars |
| A-a11 | `15:19:25.224` | LOG | `dashboard-query-editor` | 1006413 | STATUS file re-run, 14,070 chars |

The self-reported status header (verbatim, from A-a1) is the operator's own account of what landed:

```
-- STATUS AS OF 2026-08-18 13:50 — PARTIALLY APPLIED, THEN STOPPED
--
-- APPLIED and working:
--   * public.reconcile_embedding_backfill_queue()  -- created, run once,
--     closed 2,564 stale rag_content_chunks rows (queue: 21,411 -> 18,847).
--     NOTE: the status check constraint allows only
--     ('pending','processing','done','error') -- NOT 'completed'. Fixed below.
--   * public.run_embedding_backfill_tick()         -- created, NOT scheduled.
--
-- BLOCKED — do not schedule the tick until this is resolved:
--   embed-questions rejects pg_net calls. Three probes, three distinct errors:
--     no Authorization header            -> 401 deny_auth "missing authorization header"
--     Bearer projector_runner_service_role_key_v2 -> 401 deny_auth "invalid jwt"
--     Bearer projector_runner_service_role_key    -> 401 deny_signature
--                                                    "missing internal caller signature"
--   So the JWT is accepted with the v1 key, and the remaining gate is the
--   internal-caller HMAC (x-internal-caller / x-internal-timestamp /
--   x-internal-signature, backed by INTERNAL_CALLER_SIGNING_SECRET).
--
--   I did NOT reimplement that signing scheme in Postgres, deliberately.
--   Duplicating a security primitive outside the codeb…
```

By A-a11 (15:19) the same header reads `… closed 2,564 stale rag_content_chunks rows, then 97 stale
textbook_chunks rows (queue: 21,411 -> 18,750 pending, all genuinely question_bank). It is idempotent -- a
second call correctly returns 0.`

> Secret-name references (`projector_runner_service_role_key`, `…_v2`, `INTERNAL_CALLER_SIGNING_SECRET`,
> `ADMIN_API_KEY`) appear as **names**, never as values. Nothing redacted for secrecy — the only shortened
> values anywhere in this file are the two actor identifiers (see §Redaction note).

## A.4 The three feature-flag flips — **explicitly NOT captured as DDL, and here is what the logs do show**

The brief notes that `ff_adaptive_remediation_v1`, `ff_adaptive_loops_bc_v1` and `ff_school_pulse_v1` were set
`is_enabled = true` with `rollout_percentage = NULL`. Those are `UPDATE` statements against
`public.feature_flags`.

**They do not appear in any DDL log, and this file does not capture them.** `log_statement = 'ddl'` emits
nothing for an `UPDATE`, and a successful `UPDATE` that is neither slow nor erroring leaves no log row at all.
Any claim about when, by whom, or through which surface those three flags were flipped **cannot be sourced from
`postgres_logs`** — it must come from `feature_flags.updated_at` / `updated_by`, `audit_logs`, or the
`admin_flip_feature_flag` RPC's own trail.

What the logs **do** contain, on the same day but **outside** the 12:00–14:30 window, is four **blocked**
attempts to flip two of those flags by direct table `UPDATE` through PostgREST:

| Timestamp (UTC) | sev | sqlstate | app / role | Message |
|---|---|---|---|---|
| `2026-08-18T16:11:45.288Z` | ERROR | `42501` | `postgrest` / `authenticator` | `FLAG_PROTECTED: "ff_adaptive_loops_bc_v1" (tier: constitution_pinned) requires the admin_flip_feature_flag RPC with a matching confirm -- direct UPDATE of feature_flags is blocked for this transition.` |
| `2026-08-18T16:11:46.958Z` | ERROR | `42501` | `postgrest` / `authenticator` | same message for `"ff_school_pulse_v1"` |
| `2026-08-18T16:12:23.438Z` | ERROR | `42501` | `postgrest` / `authenticator` | same message for `"ff_adaptive_loops_bc_v1"` |
| `2026-08-18T16:12:24.709Z` | ERROR | `42501` | `postgrest` / `authenticator` | same message for `"ff_school_pulse_v1"` |

The offending statement on all four (identical shape):

```sql
WITH pgrst_source AS (UPDATE "public"."feature_flags" SET "is_enabled" = "pgrst_body"."is_enabled",
  "rollout_percentage" = "pgrst_body"."rollout_percentage",
  "target_environments" = "pgrst_body"."target_environments"
  FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "is_enabled", "rollout_percentage",
  "target_environments" FROM json_to_record(pgrst_payload.json_data) AS _("is_enabled" boolean,
  "rollout_percentage" integer, "target_environments" text[]) ) pgrst_body
  WHERE "public"."feature_flags"."flag_name" = $2 RETURNING "public"."feature_flags".*) SELECT …
```

These rows carry **no session trailer** — they came through PostgREST as `authenticator`, i.e. the application
surface, not the Studio session `d7881e43-…[REDACTED]`. They are **failed** attempts. They are evidence that a guard
exists and fired; they are **not** evidence of how the flags actually reached `is_enabled = true`. Zero rows
matching `ff_adaptive_remediation_v1` exist anywhere in the 2026-08-18 log day.

---

# Incident B — STAGING `gzpxqklxwzishrkiaatd`, 2026-08-20

## B.1 Actor

```
-- source: POST /mcp
-- user: oauth:c36bf53d-…[REDACTED]
```

Note the actor-token shape differs from Incident A: `oauth:` here vs `session:` there.

**Row counts for the requested window 15:00Z → 16:00Z:**

* Total `postgres_logs` rows in window: **258**
* Rows carrying the `oauth:c36bf53d-…[REDACTED]` trailer or `POST /mcp`: **4** (3 in `event_message`, 1 in `parsed.query`)
* ERROR rows in window: **52** — of which **50** are `postgrest`/`authenticator` from an unrelated
  certification-tenant/seat-policy test run (`purge_certification_tenant`, `seat_policy_block`,
  `not authorized for school …`), and exactly **2** are `mgmt-api`, both belonging to this actor.
* **Actor-attributable rows once the untrailered migration bodies are included: 6.**

The untrailered rows matter: the MCP `apply_migration` tool submits **two separate statements on two separate
connections** — a ledger-bootstrap preamble that *does* carry the trailer, and the migration body itself, which
**carries no trailer at all**. Searching only for the trailer finds the preambles and misses every body.

## B.2 Verbatim log — 15:00:00Z → 16:00:00Z

### B-01 · `2026-08-20T15:20:49.180Z` · **ERROR** `25006` · `mgmt-api` · `supabase_read_only_user` · pid 926729

`cannot execute INSERT in a read-only transaction` — an earlier read-only diagnostic probe by the same actor,
~4.5 minutes before the first write. It attempted to seed fixtures and call `select_quiz_questions_rag`, and was
correctly refused by the read-only role.

```sql
begin;
insert into public.subjects (code,name,name_hi,subject_kind,is_active,display_order) values ('zzq_diag_probe','ZZQ Diag Probe','परीक्षण','platform_elective',true,9999);
insert into public.students (id,name,grade,board,is_active,preferred_subject) values ('11111111-2222-3333-4444-555555555555','ZZQ Diag Student','9','CBSE',true,'math');
insert into public.question_bank (subject,grade,chapter_number,question_text,options,correct_answer_index,explanation,question_type_v2,difficulty,is_active,deleted_at,content_status,verification_state,verified_against_ncert,source)
select 'zzq_diag_probe','9',101,'ZZQ diag question '||i||' placeholder text over ten chars','["A","B","C","D"]'::jsonb,0,'expl','mcq',2,true,null,'published','verified',true,'ai_generated_grounded' from generate_series(1,5) i;
insert into public.ff_grounded_ai_enforced_pairs (grade,subject_code,enabled,enabled_at) values ('9','zzq_diag_probe',true, now())
  on conflict (grade,subject_code) do update set enabled=true;
select jsonb_array_length(coalesce(public.select_quiz_questions_rag('11111111-2222-3333-4444-555555555555','zzq_diag_probe','9',101,3,'mixed',array['mcq']::text[],null),'[]'::jsonb)) as rows_returned;
rollback;

-- source: POST /mcp
-- user: oauth:c36bf53d-…[REDACTED]
-- date: 2026-08-20T15:20:47.780Z
```

---

### Call 1 — `apply_migration` at 15:25:16 → ledger row `20260820152519`

#### B-02 · `2026-08-20T15:25:17.572Z` · LOG · `mgmt-api` · `postgres` · pid 927407 (conn `2600:1f18:2a66:6e04:…:39100`)

Ledger-bootstrap preamble. **This is the trailer-bearing half of the call.**

```sql
statement: begin;

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;
alter table supabase_migrations.schema_migrations add column if not exists created_by text;
alter table supabase_migrations.schema_migrations add column if not exists idempotency_key text unique;
alter table supabase_migrations.schema_migrations add column if not exists rollback text[];

commit;

-- source: POST /mcp
-- user: oauth:c36bf53d-…[REDACTED]
-- date: 2026-08-20T15:25:16.181Z
```

Connection lifecycle: `connection received 15:25:16.455` → `connection authenticated: identity="postgres"
method=scram-sha-256` at `15:25:17.384` → statement → `disconnection … session time 0:00:01.370` at `15:25:17.825`.

#### B-03 · `2026-08-20T15:25:19.321Z` · LOG · `mgmt-api` · `postgres` · pid 927410 — **THE MIGRATION BODY, RECOVERED**

**38,516 chars. No `-- source:` trailer of its own.** This is the body of ledger row `20260820152519`, and it
does contain `CREATE OR REPLACE FUNCTION public.select_quiz_questions_rag(…) SECURITY DEFINER` as the brief
expected.

Head (verbatim):

```sql
statement: begin;

-- apply sql from post body
-- Staging-only catch-up. Applies, VERBATIM, the executable bodies of two
-- migrations that are on `main` but were never applied to this project
-- because sync-staging-migrations.yml has failed on every run since
-- 2026-08-16 (ghost ledger versions, then a staging DB password auth
-- failure):
--   supabase/migrations/20260820120000_reassert_select_quiz_questions_rag_staging_drift.sql
--   supabase/migrations/20260820000101_fix_get_learning_source_rpc_hardening.sql
-- Also removes the two orphan ledger rows (20260814000023 / 20260814000024)
-- that abort `supabase db push` pre-flight — the same metadata-only repair
-- sync-staging-migrations.yml's own repair step performs.
-- No ledger rows are inserted for the two migrations above, deliberately:
-- a future `supabase db push --include-all` must still replay the full
-- 26-migration bac
```

The `SECURITY DEFINER` function definition it applied (extracted verbatim from offset 1311 onward):

```sql
CREATE OR REPLACE FUNCTION public.select_quiz_questions_rag(
  p_student_id uuid,
  p_subject text,
  p_grade text,
  p_chapter_number integer DEFAULT NULL,
  p_count integer DEFAULT 10,
  p_difficulty_mode text DEFAULT 'mixed',
  p_question_types text[] DEFAULT ARRAY['mcq']::text[],
  p_query_embedding vector DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_pool   INTEGER;
  v_seen_count   INTEGER;
  v_result       JSONB;
  MIN_POOL_FOR_RESET CONSTANT INTEGER := 10;
  -- ── Verification-gate ladder state (spec §2.2/§2.3/§3) ──────────────────
  v_pair_enforced  BOOLEAN := false;
  v_verified_pool  INTEGER := 0;
  v_use_strict     BOOLEAN := false;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- ── Pool-count query. Tier-0 (spec §2.1) added: deleted_at IS NULL,
  -- content_status = 'published', verification_state != 'failed'. Applied
  -- here identically to the seen-count, reset/delete, and candidate_pool
  -- blocks below (AC-7) so this count never disagrees with what
  -- candidate_pool can actually return.
  SELECT COUNT(*) INTO v_total_pool
  FROM question_bank qb
  WHERE qb.subject = p_subject
    AND qb.grade = p_grade
    AND qb.is_active = true
    AND qb.deleted_at IS NULL
    AND qb.content_status = 'published'
    AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
    AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
    AND (
      qb.question_type_v2 = ANY(p_question_types)
      OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
    );

  IF v_total_pool = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
```

`[TRUNCATED — full statement length 38516 chars; the function body continues with the seen-count block, the
80% pool reset guarded by MIN_POOL_FOR_RESET, and the candidate_pool selection]`

Tail (verbatim — note the second migration's ACL block, the orphan-ledger repair, and the ledger `insert … on
conflict` that the MCP tool appends):

```sql
'note', 'Signed URL must be minted by the loader route (Node.js) using supabaseAdmin.storage.from().createSignedUrl()'
  );

  RETURN v_result;
END;
$$;

-- Revoke from all non-service_role roles
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) FROM postgres;
GRANT EXECUTE ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) TO service_role;

-- ─── Orphan-ledger repair (metadata only; same two hardcoded versions the
--     sync-staging-migrations.yml repair step targets) ───
DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20260814000023', '20260814000024');$kJKNSuPjHrfakglZKhPY$],
  $kJKNSuPjHrfakglZKhPY$alfanumrik@outlook.com$kJKNSuPjHrfakglZKhPY$,
  null,
  null
)
on conflict (idempotency_key) do update set
  version = EXCLUDED.version,
  name = coalesce(EXCLUDED.name, old.name),
  statements = EXCLUDED.statements,
  rollback = EXCLUDED.rollback,
  created_by = EXCLUDED.created_by;

commit
```

> `$kJKNSuPjHrfakglZKhPY$` is a randomly generated **PostgreSQL dollar-quote delimiter**, not a credential.
> It is left verbatim deliberately so a future reader does not mistake it for a redaction candidate.
> `alfanumrik@outlook.com` is the `created_by` value the MCP tool wrote into the ledger — it is the actor
> identity and is retained on purpose (see §Redactions).

Connection lifecycle: `connection authenticated 15:25:18.948` (pid 927410) → statement `15:25:19.321` →
`disconnection … session time 0:00:01.602` at `15:25:19.619`.

---

### Call 2 — `apply_migration` at 15:28:19 → **no ledger row.** Explained: it rolled back.

#### B-04 · `2026-08-20T15:28:20.471Z` · LOG · `mgmt-api` · `postgres` · pid 927441 (conn `…:6e06:…:49880`)

Ledger-bootstrap preamble, byte-identical to B-02 except the date trailer:

```sql
-- source: POST /mcp
-- user: oauth:c36bf53d-…[REDACTED]
-- date: 2026-08-20T15:28:19.059Z
```

Lifecycle: `connection received 15:28:19.335` → `authenticated 15:28:20.283` → statement → `disconnection …
0:00:01.331` at `15:28:20.666`.

#### B-05 · `2026-08-20T15:28:22.707Z` · **ERROR** `P0001` · `mgmt-api` · `postgres` · pid 927443 — **THE BODY, RECOVERED FROM THE ERROR ROW**

```
AC-2 FAILED: telemetry did not fire
```
`parsed.context` = `PL/pgSQL function inline_code_block line 79 at RAISE`
`parsed.query` length = **17,955 chars** — the full migration body, recovered.

Head (verbatim):

```sql
begin;

-- apply sql from post body
-- Transient verification of the catch-up applied in ledger row 20260820152519.
-- Mirrors AC-1/AC-2/AC-3 of
-- apps/host/src/__tests__/migrations/select-quiz-questions-rag-verification-gate.test.ts
-- plus the get_learning_source P0-1 pins, against real seeded rows, then
-- removes every fixture it created. Any assertion RAISEs -> whole migration
-- rolls back.
DELETE FROM public.question_bank WHERE subject = 'zzq_verify_catchup';
DELETE FROM public.ff_grounded_ai_enforced_pairs WHERE subject_code = 'zzq_verify_catchup';
DELETE FROM public.students WHERE name LIKE 'ZZQ Verify Catchup%';
DELETE FROM public.subjects WHERE code = 'zzq_verify_catchup';

DO $verify$
DECLARE
  v_subject text := 'zzq_verify_catchup';
  v_grade   text := '9';
  v_student uuid;
  v_rows    jsonb;
  v_n       integer;
  v_nonverified integer;
  v_distinct    integer;
  v_events      integer;
  v_t0      timestamptz;
BEGIN
  INSERT INTO public.subjects (code, name, name_hi, subject_kind, is_active, display_order)
  VALUES (v_subject, 'ZZQ Verify Catchup', 'test', 'platform_elective', true, 9999);

  INSERT INTO public.students (name, grade, board, is_active, preferred_subject)
  VALUES ('ZZQ Verify Catchup Student', v_grade, 'CBSE', true, 'math')
  RETURNING id INTO v_student;

  INSERT INTO public.question_bank
    (subject, grade, chapter_number, question_text, options, correct_answer_index, explanation,
     question_type_v2, difficulty, is_active, content_status, verification_state,
     verified_against_ncert, source)
  SELECT v_subject, v_grade, 101,
         'ZZQ VerifyCatchup ac1-verified-' || i || ' question placeholder text over ten chars',
         '["Option A","Option B","Option C","Option D"]'::jsonb, 0,
         'ZZQ explanation ac1-verified-' || i,
         'mcq', 2, true, 'published', 'verified', true, 'ai_generated_grounded'
  FROM generate_series(1, 5) i;

  INSERT INTO public.ff_grounded_ai_enforced_pairs (grade, subject_code, enabled, en
```

`[TRUNCATED — full length 17955 chars]`

Lifecycle: `connection authenticated 15:28:21.816` (pid 927443, conn `…:6e0a:…:39994`) → ERROR `15:28:22.707`
→ `disconnection … 0:00:02.027` at `15:28:22.896`.

> **This call is NOT unexplained.** The brief flagged 15:28:20 as producing no ledger row and no DDL line; the
> logs resolve both. It was a **transient verification harness**, not a schema change. It `RAISE`d
> `AC-2 FAILED: telemetry did not fire` at line 79 of its inline `DO` block, which aborted the enclosing
> `begin; … commit`, so **nothing was committed and no ledger row was written**. It produced no `statement:`
> line because its body contains only `DELETE`s and a `DO` block — **no top-level DDL** — and
> `log_statement = 'ddl'` therefore emitted nothing. Its text survives only because it errored.

---

### Call 3 — `apply_migration` at 15:30:04 → ledger row `20260820153007`. **Body NOT retrievable.**

#### B-06 · `2026-08-20T15:30:06.191Z` · LOG · `mgmt-api` · `postgres` · pid 927465 (conn `…:6e07:…:51086`)

Ledger-bootstrap preamble, byte-identical to B-02/B-04 except:

```sql
-- source: POST /mcp
-- user: oauth:c36bf53d-…[REDACTED]
-- date: 2026-08-20T15:30:04.792Z
```

Lifecycle: `authenticated 15:30:06.003` → statement → `disconnection … 0:00:01.316` at `15:30:06.383`.

#### The body — **no log row exists**

pid **927467** (conn `…:6e00:6194:1a07:b661:1619:34948`) shows exactly two rows and nothing between them:

| Timestamp (UTC) | sev | Message |
|---|---|---|
| `2026-08-20T15:30:07.540Z` | LOG | `connection authenticated: identity="postgres" method=scram-sha-256 (/etc/postgresql/pg_hba.conf:94)` |
| `2026-08-20T15:30:09.113Z` | LOG | `disconnection: session time: 0:00:02.517 user=postgres database=postgres host=2600:1f18:2a66:6e00:6194:1a07:b661:1619 port=34948` |

No `statement:` line. No ERROR. No `parsed.query`. A 2.5-second session that committed silently.

**Why it is unrecoverable, and what was tried:**

1. `log_statement = 'ddl'` emitted nothing → the body contained **no top-level DDL**.
2. It succeeded → no ERROR row, so no `parsed.query` copy.
3. `supabase_migrations.schema_migrations` no longer holds it. A read of the staging ledger on 2026-08-21
   returns **zero rows** for `20260820152519`, `20260820153007`, `20260814000023`, and `20260814000024`.
   `20260820153007` was removed by the CI repair step in `.github/workflows/sync-staging-migrations.yml`
   (`supabase migration repair --status reverted 20260820153007`, added in commit #1597); `20260820152519` was
   deleted by `20260820153007`'s own final statement.
4. `pg_stat_statements` is **not installed** on staging (`relation "pg_stat_statements" does not exist`), so
   there is no normalized copy either.

**The only surviving description of that body** is a second-hand one, written into
`.github/workflows/sync-staging-migrations.yml` (lines 52–72) by whoever read the ledger's `statements` column
*before* deleting the row:

```
#   The ledger's `statements` column for 20260820153007 holds a single `DO`
#   block named
#   `verify_quiz_rag_gate_telemetry_ac3_gls_and_collapse_catchup_row`.
#   End to end it: inserts test fixtures, calls `select_quiz_questions_rag`
#   TWICE to assert its telemetry, checks three `get_learning_source`
#   validation pins, then deletes every fixture it created. Verb scan over
#   the full body: ZERO `CREATE`, `ALTER`, `DROP`, `GRANT`, `REVOKE`,
#   `TRUNCATE`. Residual fixtures left behind: 0.
```

That description is **consistent with** the log evidence (a pure `DO` block explains the absent `statement:`
line exactly, and its name matches call 2's failed AC-2/AC-3 theme) — but it is a **human summary, not the
statement text**. The verbatim body of `20260820153007` is gone and cannot be recovered from any source
reachable today.

## B.3 Staging window — what else was in it

The other 254 rows in 15:00–16:00 are unrelated to this actor: pg_cron `evaluate_alert_rules` ticks, checkpoint
records, `postgres_exporter`/`pg_isready`/`salt-grains` connection churn, and a 50-error burst from a
certification-tenant test run through PostgREST (`purge_certification_tenant: refusing to tear down school … —
is_demo is not true`, `seat_policy_block: over_ceiling` / `grace_expired`, `not authorized for school …`). Those
rows contain school UUIDs and are **deliberately not reproduced here** — they are not actor evidence and
reproducing them would copy identifiers into a document that does not need them.

---

# What this file does and does not prove

## It proves

1. **Attribution of the writes to a specific actor token, with wall-clock precision.** Every production write in
   §A.2 carries `-- user: session:d7881e43-…[REDACTED]`; every staging `apply_migration` call in
   §B.2 carries `-- user: oauth:c36bf53d-…[REDACTED]`. Both ran as the `postgres` superuser role.
2. **That production DDL was executed from Supabase Studio, not through CI.** Three distinct surfaces are named
   in the trailers — the pg-meta query endpoint, the Studio SQL editor (`-- source: dashboard`), and an MCP
   client (`-- source: POST /mcp`) — all bound to one Studio session.
3. **That a statement whose own header declared `STATUS: NOT APPLIED … Ship through CI like any other
   migration` was in fact executed against production** (A-20 at 13:28:08), and that a cron job was invoking the
   function it created **112 seconds later** (A-21 at 13:30:00). A self-declared status comment is not evidence
   of what happened; the log is.
4. **That `_rls_policy_backup_20260818` was created at 13:12:02.121Z** and that a project-local guard enabled
   RLS on it 13 ms later with **no policies attached** (A-18, A-19).
5. **The exact create/revoke sequence** for `ops_check_learning_loop_health` (three in-place rewrites: 13:38:07,
   13:40:50, 13:54:49), `reconcile_embedding_backfill_queue` (13:45:19, rewritten 13:46:35, rewritten again
   15:01:32), and `run_embedding_backfill_tick` (13:48:02) — each `SECURITY DEFINER`, each followed within
   ~1 second by `revoke all … from public, anon, authenticated`.
6. **The full body of staging ledger row `20260820152519`**, including its
   `CREATE OR REPLACE FUNCTION public.select_quiz_questions_rag(…) SECURITY DEFINER` and its
   `DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20260814000023','20260814000024')`.
7. **That the 15:28:20 staging call was a rolled-back verification harness, not a lost schema change** — the
   `AC-2 FAILED: telemetry did not fire` RAISE aborted the transaction, which is why no ledger row exists.

## It does not prove

1. **Nothing about the three feature-flag flips.** `UPDATE`s are structurally invisible to DDL logging. This
   file captures four *blocked* PostgREST flip attempts at 16:11–16:12 (a different surface, a different role,
   and failures), and captures **zero** rows for `ff_adaptive_remediation_v1`. How, when, and by whom the flags
   actually reached `is_enabled = true` with `rollout_percentage = NULL` must be established from
   `feature_flags` metadata, `audit_logs`, or the `admin_flip_feature_flag` RPC trail — **not from here**.
2. **Nothing about non-DDL writes generally.** Any successful `INSERT`/`UPDATE`/`DELETE` in either window that
   was neither slow nor erroring left no trace. Absence of a row in this file is **not** evidence that no write
   occurred. A-13 was captured only because a `drop index` rode along in the same transaction.
3. **The verbatim body of staging ledger row `20260820153007`.** See §B.2 Call 3 — four independent recovery
   paths were tried and all are closed. Only a second-hand human summary survives, and it is labelled as such.
4. **Who the human behind the tokens was.** `session:d7881e43-…[REDACTED]` and `oauth:c36bf53d-…[REDACTED]` are opaque identifiers;
   the connection IPs are Supabase management-plane egress addresses, not operator IPs. The staging ledger's
   `created_by` recorded `alfanumrik@outlook.com`, which is an account label, not proof of who held the session.
5. **Whether individual statements' *effects* persisted.** The log records submission and success/failure at
   statement granularity. It does not record row counts, and for A-14/A-15 it does not disambiguate whether the
   `cron.unschedule('synthetic-host-monitor-tick')` in the same target list took effect before the statement
   aborted. Verify current state directly where that matters.
6. **Anything about production between 14:30Z and 16:11Z beyond the 11 rows in §A.3**, or about staging outside
   15:00–16:00. Those windows were not exhaustively swept.

---

# Redactions

**No secret value appeared in any captured row, so nothing was redacted for secrecy.** The only values altered
anywhere in this file are the two **actor identifiers**, truncated to an 8-character prefix after the initial
commit so that Gitleaks' `generic-api-key` rule stops matching the `oauth:`/`session:` + high-entropy shape —
see §Redaction note near the top of this file. Everything else below is verbatim. Recorded explicitly so a
future reader does not assume material was quietly removed:

| Item seen in the logs | Kind | Action |
|---|---|---|
| `ADMIN_API_KEY`, `projector_runner_service_role_key`, `projector_runner_service_role_key_v2`, `INTERNAL_CALLER_SIGNING_SECRET` | Vault secret **names**, referenced by `select … from vault.decrypted_secrets where name = '…'` and bound to local variables at runtime | Kept — names only; no value is present anywhere in the log stream |
| `select string_agg(name, ', ') from vault.secrets` (A-26) | Enumerates secret **names**, not values | Kept |
| `$kJKNSuPjHrfakglZKhPY$` | PostgreSQL dollar-quote delimiter, randomly generated by the MCP tool | Kept verbatim — **not** a credential; flagged inline so it is not mistaken for one |
| `alfanumrik@outlook.com` | `created_by` value written into the staging migration ledger | Kept — it is the actor attribution this audit exists to record |
| Project refs `shktyoxqhundlvkiwguu` / `gzpxqklxwzishrkiaatd`, view/function/table names, `alert_rules` UUIDs | Already present throughout this repo | Kept |
| School UUIDs in the 50 unrelated staging PostgREST errors | Not actor evidence | Not reproduced — see §B.3 |
| `oauth:c36bf53d-…[REDACTED]` (staging MCP actor), `session:d7881e43-…[REDACTED]` (production Studio actor) | Opaque session/user identifiers — **not** credentials | **Truncated to an 8-char prefix — the only alteration in this file.** Done to satisfy Gitleaks `generic-api-key`; the same truncation is used at every occurrence so cross-referencing still works. Full values remain in `postgres_logs` until 2026-11-16 (prod) / 2026-11-18 (staging) — see §Redaction note |

Had any API key, JWT, or password appeared, it would have been replaced with `[REDACTED]` and listed here.
