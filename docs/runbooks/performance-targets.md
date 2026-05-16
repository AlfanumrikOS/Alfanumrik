# Runbook — Performance targets

**Type:** operator + engineer runbook (targets, measurement methodology, mitigations).
**Pairs with:** [`docs/architecture/SLO.md`](../architecture/SLO.md) — source of truth for SLO numbers. **SLO.md wins** in any disagreement; this file extends SLO.md with measurement, pagination contract, and index inventory the SLO doc deliberately keeps out of scope.
**Owner:** ops (alerts) + B12 (BFF latency) + B9 (assessment / tutor latency) + B2 (tenant resolution latency).
**Updated:** 2026-05-16 (Phase D.6).

## 1. Scope

This document is the single page an engineer or operator can read to answer:

1. What latency / availability target does each surface have?
2. How is it measured today, and where are we failing?
3. How is pagination supposed to work on a list route?
4. Which database indexes were added in Phase D.6 and why?
5. What did we do to keep Edge-Function cold-starts under control?
6. What are the current Supabase / pgbouncer connection-pool settings, and when do we scale up?

It deliberately does NOT duplicate the SLO numbers themselves — those live in `docs/architecture/SLO.md` so there is exactly one place to update them when they shift.

## 2. SLO summary (cross-link)

The full per-route SLO table is in [`SLO.md` §"Latency"](../architecture/SLO.md#latency). Below is the high-level shape the team commits to.

| Tier | p50 | p95 | p99 | Notes |
|---|---|---|---|---|
| **API "fast"** (`/api/tutor/next`, `/api/v1/health`) | < 100 ms | < 300 ms | < 600 ms | Pure DB read; one round-trip max |
| **API "default"** (`/api/v1/quiz/submit`, `/api/teacher/messages/*`) | < 200 ms | < 1000 ms | < 3000 ms | Mixed read+write; may publish event |
| **API "AI-bound"** (`/api/foxy`, `/api/tutor/answer`) | < 1500 ms | < 5000 ms | < 8000 ms | Anthropic call dominates; tracked separately |
| **Dashboard SSR** | < 300 ms | < 800 ms | < 1500 ms | Vercel Speed Insights |
| **Projector lag** | < 2 s | < 5 s | < 30 s | `subscriber_lag` view |

A route on the "default" tier that runs above p95 = 1000 ms for 5 minutes is a Sentry alert (see [`sentry-alert-setup.md`](sentry-alert-setup.md) §3). The "AI-bound" tier inherits its alert thresholds from [`SLO.md`](../architecture/SLO.md) row "Foxy first-token / full response".

## 3. How to measure

### 3.1 In-flight (Sentry Performance)

Every API route ships with `Sentry.startSpan` via the wrapper in `src/lib/observability/with-spans.ts`. Configure rules per [`sentry-alert-setup.md`](sentry-alert-setup.md). Sentry uses `tracesSampleRate=0.1` (per R16 in `RISK_REGISTER.md`) so absolute numbers are 10× the sampled count — keep that in mind when reading dashboards.

### 3.2 Synthetic checks

- `GET /api/v1/health` — Vercel Analytics uptime monitor, 1-minute interval.
- `/api/cron/reverify-domains` — runs nightly; emits `tenant.custom_domain_drift_detected` on regression.

### 3.3 Per-route benchmark (manual)

Use `wrk` or `bombardier` against a staging endpoint with a known fixture:

```bash
# 50 concurrent users, 1 minute, with a service-role bearer
bombardier -c 50 -d 60s \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  "https://staging.alfanumrik.com/api/parent/notifications?limit=20"
```

Record p50 / p95 / p99 in a sibling `docs/perf/<date>-<route>.md` file when running an ad-hoc check.

### 3.4 What's currently failing

As of 2026-05-16 the team is meeting SLO on every route in [`SLO.md`](../architecture/SLO.md) **based on Sentry Performance dashboards**. The known-soft spots that informed Phase D.6 are:

- `/api/parent/notifications` would have degraded above 50 K notifications in a single guardian's inbox without the existing `idx_notifications_unread` / `idx_notifications_recipient_created`. No regression — but a real growth-driven risk.
- `school_admins` lookups during RLS subqueries were on a partial-cardinality index (only the leftmost column of the UNIQUE constraint). At >100 schools this would have started showing in p95 of every admin API call.

## 4. Pagination contract

**Standardized in Phase D.6.** Every list-style route follows the same surface:

### 4.1 Query params (request)

| Param | Type | Default | Cap | Meaning |
|---|---|---|---|---|
| `limit` | int | 20 (most routes; messages = 100, notifications = 50 — set per-route based on payload size) | 100 | Page size cap |
| `cursor` *(preferred)* | ISO-8601 timestamp | none | n/a | Opaque cursor returned by the previous page's `nextCursor` |
| `before` *(alias, Phase D.6)* | ISO-8601 timestamp | none | n/a | Identical semantics to `cursor`. The standardized name; older callers should migrate as they touch the code |

Cursor semantics depend on the route's natural ordering:

- **Newest-first surfaces** (notifications, threads list): cursor is the `created_at` of the LAST row of the current page; the next page returns rows with `created_at < cursor`.
- **Oldest-first surfaces** (chat-style message lists): cursor is the `created_at` of the LAST row of the current page; the next page returns rows with `created_at > cursor`.

The query is always `LIMIT n+1` so the route can compute `hasMore` without a separate count.

### 4.2 Response shape

```jsonc
{
  "success": true,
  "items":      [/* or "messages" / "threads" — per the route */],
  "nextCursor": "2026-05-13T08:14:55.123Z" | null,
  "hasMore":    true
}
```

- `nextCursor === null` ⇔ `hasMore === false`.
- `hasMore` is redundant but explicit — it keeps the UI from interpreting `null` as a missing field.

### 4.3 Routes that ship the contract

| Route | Default `limit` | Cap | Cursor direction | Notes |
|---|---|---|---|---|
| `GET /api/parent/notifications` | 50 | 50 | `< cursor` (newest-first) | Returns `unreadCount` for badge |
| `GET /api/teacher/messages/threads/[id]/messages` | 100 | 100 | `> cursor` (oldest-first chat) | Marks guardian-sent unread as read |
| `GET /api/parent/messages/threads/[id]/messages` | 100 | 100 | `> cursor` (oldest-first chat) | Marks teacher-sent unread as read |
| `GET /api/teacher/messages/threads` | 50 | 50 | (no cursor; thread counts are low — single-page) | Bundled with `unread_count` per thread |
| `GET /api/school-admin/students` | 20 | 100 | offset-paginated (`page`/`limit`) | Uses `?page=` because admin UI needs total pages for jumping |

### 4.4 Why messages default to 100, not 20

Chat-style screens load enough history to scroll up two viewport heights without an extra round-trip. 100 messages per page averages ~40-60 KB on the wire — still well under the Vercel function-response cap (4.5 MB) and round-trips faster than two separate 50-message pages.

## 5. Index inventory — Phase D.6 additions

See `supabase/migrations/20260527000008_perf_index_audit_phase_d6.sql` for the actual SQL and inline rationale. Summary:

| Index | Table | Why |
|---|---|---|
| `idx_school_admins_school_id_active` | `school_admins` | RLS subqueries on classes / audit_logs / announcements filter by `school_id`; the existing UNIQUE constraint leads with `auth_user_id` so a school_id-only scan would be sequential |
| `idx_school_admins_auth_user_active` | `school_admins` | Every school-admin API request resolves `auth_user_id + is_active = true`; the partial keeps the index working set warm |
| `idx_subscriber_dead_letters_subscriber_unresolved` | `subscriber_dead_letters` | Observability surface enumerates by subscriber; PK is `event_id`-first so subscriber-only scans miss |
| `idx_subscriber_retry_state_subscriber` | `subscriber_retry_state` | Same shape — retry-state listing by subscriber for dashboards / `docs/runbooks/dead-letter-inspection.md` |

### 5.1 Operator note: index creation locks

`CREATE INDEX` (without `CONCURRENTLY`) takes an `ACCESS EXCLUSIVE` lock for the duration of the build. Supabase wraps every migration file in a transaction, so we cannot use `CONCURRENTLY` from a migration. The four tables touched in this migration are all small in production (<10 K rows expected on every tenant), so an in-migration build is safe.

**If a future audit needs an index on a >5 M-row table**:

1. Open a psql shell against staging (`psql $STAGING_DATABASE_URL`).
2. Run `CREATE INDEX CONCURRENTLY ...` interactively. Verify with `\d <table>`.
3. After it lands in staging, paste the same `CREATE INDEX IF NOT EXISTS ...` (without `CONCURRENTLY`) into the migration so the next environment that runs the pipeline is a no-op.
4. Do the same on production, with the on-call present.

## 6. Edge Function cold-start

### 6.1 Current cost

Cold-start budget per Edge Function (Deno):

| Source | Approximate cost |
|---|---|
| `import` resolution (esm.sh) | 100-300 ms first-call |
| `createClient(SUPABASE_URL, SERVICE_ROLE, ...)` | 30-80 ms |
| Static state setup (env reads, regex precompile) | <5 ms |
| Total cold-start | 200-500 ms typical |

Warm requests reuse module-scope state and pay ~5-15 ms above the actual handler time.

### 6.2 Mitigations applied (Phase D.6)

| Function | Before | After |
|---|---|---|
| `supabase/functions/teacher-dashboard/index.ts` | `getServiceClient()` constructed inside 23 call sites — each pay constructor cost on the first call after cold-start | Singleton at module scope; `getServiceClient()` returns the same client. Saves ~50-150 ms cold-start, trims warm-request allocator pressure |
| `supabase/functions/projector-runner/index.ts` | Constructed `createClient(...)` inside `Deno.serve` handler — every minute the cron tick paid the cost | Module-scope `SB`, handler reuses. Saves ~30-80 ms per cold tick |
| `supabase/functions/send-transactional-email/index.ts` | `btoa()` of API key + URL string concat per `sendMailgunEmail` call | Precomputed `MAILGUN_API_URL` + `MAILGUN_AUTH_HEADER` at module scope |

### 6.3 What's left

These are out of scope for Phase D.6 but tracked for a future pass:

- Replace `https://esm.sh/@supabase/supabase-js@2` with a self-hosted ESM bundle to remove the import-graph round-trip on cold-start (saves 100-300 ms).
- Migrate the largest helper modules in `supabase/functions/_shared/` to `lazy-load` for handlers that don't need them on every code path.

## 7. Connection pooling (pgbouncer)

Supabase Postgres runs pgbouncer in **transaction-pooling** mode on port 6543. Our connection strings hit that port (`postgres.<project>.supabase.co:6543/postgres`) so:

- One serverless function invocation = one transaction = one pooler connection.
- `pgbouncer.max_client_conn` is tuned by Supabase per project tier. At the current "small" tier we have ~200 client connections and ~25 backend connections.
- `pool_mode = transaction` means **PREPARED statements cannot be re-used across requests** — supabase-js does not emit them for the operations we run, but if anyone adds a raw `pg`-based caller they MUST disable prepared statements (`statement_cache_size=0` or equivalent) or switch to the session-mode port (5432).
- Long-running transactions (>30 s) starve the pool. We have no such queries today; the longest single-statement query is the dashboard's heatmap RPC at ~500 ms.

### 7.1 When to scale up

| Signal | Threshold | Action |
|---|---|---|
| Vercel function "Concurrent invocations" | >100 sustained for 5 min | Verify pgbouncer pool isn't saturated (Supabase Studio → Database → Pool); if it is, request pool-size bump from Supabase support |
| `pg_stat_activity` rows with `state='active'` | >50 sustained | Same as above |
| Sentry: spike in `503` from API routes citing "too many connections" | any | Page the on-call. Upgrading Supabase tier moves both client and backend conn limits up the curve |

The decision document for tier upgrades lives in `docs/architecture/scaling-plan.md` (Phase F).

## 8. Change log

- **2026-05-16 (Phase D.6)** — initial runbook. Pagination contract codified. Index inventory + Edge-Function cold-start mitigations from PR #800 (Phase D.6 / perf-audit) recorded.
