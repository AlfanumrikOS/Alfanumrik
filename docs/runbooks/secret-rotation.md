# Secret Rotation Runbook — CRON_SECRET (and the pattern for all multi-store secrets)

**Why this exists:** the 2026-07-09 CRON_SECRET rotation updated some stores and
not others, silently killing pg_cron-driven functions for 17 days
(synthetic-host-monitor: 4,887 consecutive 401s). This runbook is the
choreography that prevents a repeat. Incident detail: drift-report execution
log + `_shared/security/internal-cron-auth.ts` header.

## Where CRON_SECRET lives (verified 2026-07-13 — FIVE stores)

| # | Store | Consumer | How to update |
|---|-------|----------|---------------|
| 1 | AWS Secrets Manager `alfa-prod/app` (key `CRON_SECRET`) | `production-cron-runner.yml` break-glass workflow — **treat as the source of truth** | AWS console / CLI |
| 2 | Vercel env `CRON_SECRET` | Vercel cron → `/api/cron/*` routes (the canonical daily scheduler) | Vercel dashboard → Settings → Env Vars → redeploy |
| 3 | Supabase Edge Function secrets `CRON_SECRET` | `verifyInternalCronRequest` env path in every cron-authed Edge Function | Dashboard → Edge Functions → Secrets (values are WRITE-ONLY — never readable after save) |
| 4 | DB: `public.get_cron_secret()` + vault secret `cron_secret` | pg_cron jobs (send the vault value; functions accept it via the DB-RPC fallback) | One SQL block — see below |
| 5 | GitHub Actions secret (if any workflow still holds a copy) | legacy workflows | repo Settings → Secrets → Actions |

## Rotation procedure (do ALL steps in one sitting)

1. Generate the new value locally: `openssl rand -hex 32`.
2. AWS SM `alfa-prod/app` → update key `CRON_SECRET`.
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
