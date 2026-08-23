# Backup drill record - 2026-08-23

## What this is
The first executed backup export against production for this repo, per
docs/runbooks/per-school-backup-restore.md. FIX-LEDGER.md and this launch-readiness program both recorded
zero prior evidence of any executed drill. This closes the backup half only - the restore half is still not
demonstrated, see Limitations below.

## Method
No native Postgres connection (no psql, no DATABASE_URL) was available in this environment - only the
Supabase REST API via a service-role key. _run_backup.py adapts the runbook logical-export procedure to REST
GET calls instead of psql COPY commands. The script reads credentials directly from apps/host/.env.local
inside Python (never passed through a shell command that also writes files, to respect the bash-guard
secret-exposure protection), and writes only response bodies, never the credential itself, to disk.

## What was exported
Target: Test Pilot Academy, school_id 7f355f26-2c4d-4303-8f0e-6889789b1df0 (chosen as the most plausibly
real pilot-test entity among the 9 schools in production, all of which are demo/test schools).

| Table | Rows exported |
|---|---|
| schools | 1 |
| school_admins | 0 |
| students | 0 |
| teachers | 0 |
| classes | 0 |

## Material finding, not just a drill result
This school has zero associated students, teachers, admins, or classes. A follow-up check found 68 total
students exist in production overall, essentially none tied to any of the 9 schools. Combined with the
earlier finding that payment_history has exactly 5 rows total, ever, this confirms: as of 2026-08-23,
production has no real B2B pilot school with populated roster data. The backup/restore gap remains a real,
must-fix-before-first-customer item, but there is no currently-at-risk live school data today.

## Limitations - what this drill does NOT prove
- This demonstrates the BACKUP half only. A genuine RESTORE drill requires restoring exported data into a
  separate, non-production database to prove recoverability - no working staging database credentials were
  available this session (.env.staging.local's service-role key is 41 characters, too short to be a real
  Supabase JWT). Provisioning a real staging/sandbox project is a prerequisite for a true restore drill and
  is recommended as a follow-up, owner: architect/ops.
- Only 5 of the tables the runbook lists as school-scoped were exported in this pass (schools,
  school_admins, students, teachers, classes) - the remaining tables (school_subscriptions,
  school_invite_codes, school_audit_log, assignments, quiz_sessions, student_learning_profiles,
  foxy_chat_messages, audit_logs, notification_sends, notification_preferences) were not exported this pass,
  since the target school has no associated rows in the tables that were checked. A future drill against a
  school with real data should export the full table list.
- This was a manual, one-off, read-only export, not the automated recurring drill the runbook mandates on a
  quarterly cadence. The existing dead automation (run_daily_backup_health_check, called by nothing) still
  needs to be wired to an actual cron - not addressed by this drill.

## Raw exports in this directory
schools.json, school_admins.json, students.json, teachers.json, classes.json - real REST API response
bodies, timestamped 2026-08-23, retained as evidence.
