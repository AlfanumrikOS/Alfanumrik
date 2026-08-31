-- M10 (partial, low-risk fix only — see docs/audit/launch-readiness/28-m1-m10-and-h1-h4-remediation.md
-- for why the full guardian/parent consolidation is NOT attempted here):
-- resource_access_rules had 'parent' with 3 rules (student, report, image)
-- but 'guardian' with only 2 (student, report) — missing 'image'. This table
-- is not read by any application code (verified by repo-wide grep), so the
-- asymmetry is dormant, not a live bug — but it's the one confirmed
-- inconsistency between the two roles worth closing cheaply while
-- investigating M10, without touching the auth-critical session/route
-- identity code (proxy.ts, middleware-helpers.ts) that actually gates live
-- parent/guardian traffic.
INSERT INTO public.resource_access_rules (role_id, resource_type, ownership_check, field_restrictions, max_records_per_request)
SELECT id, 'image', 'linked', '[]'::jsonb, 100
FROM public.roles WHERE name = 'guardian'
ON CONFLICT DO NOTHING;
