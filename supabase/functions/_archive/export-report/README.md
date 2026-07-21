# export-report (archived)

**Archived 2026-07-20** (Teacher Dashboard RCA, task T4).

Was a fully-built, tested Edge Function (`report_type: class_performance |
student_hpc | parent_weekly`, JSON/CSV) that had **zero callers** anywhere in
the frontend, mobile app, or cron code — confirmed by a repo-wide grep on the
day of archival (`apps/`, `packages/`, `supabase/functions/`, `scripts/`,
`.github/`). Every hit outside this directory was either documentation or a
stray code *comment* referencing the function's name/pattern, never an actual
`supabase.functions.invoke('export-report', …)` call or fetch to an
`export-report` URL.

The teacher UI's real CSV export (grade-book, student reports) goes through a
separate, already-wired implementation: the `export_grade_book_csv` /
`export_student_report` actions inside
`supabase/functions/teacher-dashboard/index.ts`. That path is unaffected by
this archival.

Do not confuse this with `parent-report-generator/`, which is a different,
live, parent-facing PDF function — it was not touched.

Restore from git history if needed (the file was moved here via `git mv`, so
`git log --follow` retains the full history, including its own Deno-lane
`__tests__/tenant-isolation.test.ts`, which was removed as part of the
archival to match the `quiz-generator-v2` archival convention).
