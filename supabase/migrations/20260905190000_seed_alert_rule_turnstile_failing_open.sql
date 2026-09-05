-- Page ops the moment Turnstile fails open.
--
-- Companion to the 2026-09-05 change in apps/host/src/app/api/auth/pre-check/route.ts:
-- a wrong TURNSTILE_SECRET (Cloudflare `invalid-input-secret`) or an unreachable
-- siteverify endpoint no longer 503-blocks every login and signup. Instead the
-- route fails OPEN and writes a `critical` ops_events row with category `auth`.
--
-- Failing open is only acceptable if it is LOUD. Before this file there was no
-- alert_rules row for category `auth` at all (verified 2026-09-05:
--   select * from alert_rules where category in ('auth','security') -> 0 rows),
-- so the ops_events row alone would have been as silent as the 672 failed
-- learning-loop-health runs nobody saw. This rule delivers it through the same
-- channel every existing rule uses.
--
-- Idempotent: guarded on name so re-running db push is a no-op.

insert into public.alert_rules
  (name, description, enabled, category, source, min_severity,
   count_threshold, window_minutes, cooldown_minutes, channel_ids)
select
  'Turnstile failing open (bad secret or siteverify outage)',
  'api/auth/pre-check is letting login/signup through WITHOUT bot verification because '
  'Cloudflare rejected TURNSTILE_SECRET (invalid-input-secret) or siteverify was unreachable. '
  'Login still works — fix the secret in Vercel and redeploy. Every minute open is a minute unprotected.',
  true,
  'auth',
  'api/auth/pre-check',
  'critical',
  1,      -- one event is enough: this is a config/outage state, not a rate
  60,
  60,     -- re-page hourly until it is fixed
  array['9a8e9894-a56e-4d63-b11e-f1128ace31fc']::uuid[]
where not exists (
  select 1 from public.alert_rules
   where name = 'Turnstile failing open (bad secret or siteverify outage)'
);
