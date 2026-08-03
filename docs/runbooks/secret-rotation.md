# Secret Rotation Runbook — CRON_SECRET (and the pattern for all multi-store secrets)

**Why this exists:** the 2026-07-09 CRON_SECRET rotation updated some stores and
not others, silently killing pg_cron-driven functions for 17 days
(synthetic-host-monitor: 4,887 consecutive 401s). This runbook is the
choreography that prevents a repeat. Incident detail: drift-report execution
log + `_shared/security/internal-cron-auth.ts` header.

## Where CRON_SECRET lives (verified 2026-07-13 — FIVE stores; AWS SM decommissioned as break-glass source 2026-08-03)

| # | Store | Consumer | How to update |
|---|-------|----------|---------------|
| 1 | ~~AWS Secrets Manager `alfa-prod/app` (key `CRON_SECRET`)~~ **DECOMMISSIONED as break-glass source 2026-08-03** | ~~`production-cron-runner.yml` break-glass workflow~~ — re-homed to the GitHub Actions secret store (see row 5) | n/a — no longer read by any consumer; delete the `alfa-prod/app` `CRON_SECRET` key during AWS Secrets Manager teardown |
| 2 | Vercel env `CRON_SECRET` | Vercel cron → `/api/cron/*` routes (the canonical daily scheduler) | Vercel dashboard → Settings → Env Vars → redeploy |
| 3 | Supabase Edge Function secrets `CRON_SECRET` | `verifyInternalCronRequest` env path in every cron-authed Edge Function | Dashboard → Edge Functions → Secrets (values are WRITE-ONLY — never readable after save) |
| 4 | DB: `public.get_cron_secret()` + vault secret `cron_secret` | pg_cron jobs (send the vault value; functions accept it via the DB-RPC fallback) | One SQL block — see below |
| 5 | GitHub Actions secret `CRON_SECRET` (repo- or `Production`/`production-break-glass`-environment-scoped) | `production-cron-runner.yml` break-glass workflow — **treat as the source of truth**; must equal the Vercel production `CRON_SECRET` (row 2) | repo Settings → Secrets → Actions (or the scoped environment's secrets) |

> **2026-08-03 — AWS SM decommissioned as break-glass source.** AWS Secrets
> Manager `alfa-prod/app` is no longer the `CRON_SECRET` source of truth. Per the
> P2-6 AWS host decommission, `production-cron-runner.yml` now reads `CRON_SECRET`
> directly from the GitHub Actions secret store (row 5), which must equal the
> Vercel production `CRON_SECRET`. The `alfa-prod/app` `CRON_SECRET` key is retired
> and should be removed during the AWS Secrets Manager teardown.

## Rotation procedure (do ALL steps in one sitting)

1. Generate the new value locally: `openssl rand -hex 32`.
2. GitHub Actions secret `CRON_SECRET` (repo- or `Production`/`production-break-glass`-environment-scoped) → update its value; keep it equal to the Vercel production `CRON_SECRET` (step 3). (Was AWS SM `alfa-prod/app`, decommissioned as the break-glass source 2026-08-03.)
3. Vercel env → replace `CRON_SECRET` → trigger a redeploy (env changes don't
   hot-reload).
4. Supabase Edge Function secrets → replace `CRON_SECRET`.
5. DB (single block — updates the function AND vault atomically, value never
   leaves your clipboard for these two):

   ```sql
   DO $$
   DECLARE s text := 'PASTE_NEW_VALUE';
   BEGIN
     EXECUTE format('CREATE OR REPLACE FUNCTION public.get_cron_secret() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS $f$ BEGIN RETURN %L::text; END $f$;', s);
     PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name='cron_secret'), s);
   END $$;
   ```
6. Verify within 10 minutes (do not skip):
   ```sql
   -- pg_cron path: expect allow_cron_secret rows newer than the rotation
   SELECT max(timestamp) FROM security_request_audit
    WHERE route='synthetic-host-monitor' AND quota_decision='allow_cron_secret';
   -- Vercel path: expect the next /api/cron tick to appear as allow_cron_secret on route daily-cron
   ```
7. If step 6 shows deny_auth after the rotation window, roll back store-by-store
   to the previous value (keep it until verification passes).

## Rules

- **Never** commit a secret value to a migration or any tracked file. The
  retired pre-2026-07-13 value is permanently leaked in
  `baseline_from_prod.sql:8919` git history — that value must never be reused.
- `get_cron_secret()` grants: `service_role` + `postgres` EXECUTE only. Re-check
  after any CREATE OR REPLACE (privileges are preserved, but verify).
- Rotating only SOME stores is worse than not rotating: the desynced consumers
  fail silently. If you can't finish all steps, don't start.
- The DB-RPC fallback (`internal-cron-auth.ts`) means stores 3 and 4 may hold
  DIFFERENT values without breakage (either is accepted) — but keep them equal
  anyway so reasoning stays simple.
