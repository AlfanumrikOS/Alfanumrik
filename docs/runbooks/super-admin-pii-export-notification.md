# RCA-14 Lower-Tier PII Export Notification

Owner: ops

Purpose: notify lower-tier exporters that PII report exports now require `super_admin`, and review audit evidence after deploy so RCA-14 does not silently break a legitimate workflow.

## Notify Lower-Tier Exporters

Send before or at deploy to every `support` or non-`super_admin` operator who previously used Super Admin reports.

Template:

> Super Admin report export access has changed for data-sensitivity reasons. The `students`, `teachers`, `parents`, and `audit` report types contain PII and now require the `super_admin` tier. Lower-tier exporters will receive HTTP 403 for those four report types. UUID-only `quizzes` and `chats` exports remain available at the support floor.

Ask recipients to reply with a business reason if they still need a PII export path. Do not grant ad hoc access from support accounts.

## Post-Deploy Audit Review

Run this read-only query after deploy and again after the first business day:

```sql
SELECT
  created_at,
  actor_email,
  action,
  target_type,
  target_id,
  details
FROM admin_audit_log
WHERE created_at >= now() - interval '24 hours'
  AND (
    action ILIKE '%report%'
    OR action ILIKE '%export%'
    OR target_type ILIKE '%super-admin/reports%'
    OR details::text ILIKE '%super-admin/reports%'
  )
ORDER BY created_at DESC
LIMIT 200;
```

Review for repeated failed attempts from lower-tier users and for any reported business workflow that depended on the old PII export tier.

## No-Loosening Guard

Do not loosen `students`, `teachers`, `parents`, or `audit` below `super_admin` unless there is a reviewed access decision and a replacement role or permission model. Any loosening must update `REPORT_CONFIG`, the RCA-14 readiness manifest, and the regression tests that pin PII report tiering.
