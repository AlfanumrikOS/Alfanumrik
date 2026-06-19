# Attendance Feature — Rollout Runbook
Migration: `20260621000000_phase1_academic_structure_attendance_boards.sql`
Added: 2026-06-21

## Verification after migration apply

1. **Table + RLS active**:
```sql
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('boards','academic_terms','student_attendance','class_schedule')
  AND relkind = 'r';
-- all rows: relrowsecurity = t
```

2. **Seed data present**:
```sql
SELECT code, name FROM public.boards ORDER BY display_order;
-- expect: CBSE, ICSE, IB, NIOS

SELECT academic_year, term_name, is_current FROM public.academic_terms
WHERE school_id IS NULL ORDER BY term_number;
-- expect: Term 1 (is_current=false), Term 2 (is_current=true)
```

3. **Teacher can mark attendance (smoke test)**:
Call `mark_attendance` with a valid teacher_id + class_id + today's date + 1 student record.
Verify the row appears in `student_attendance` and the `get_grade_book` attendance column now shows a computed % rather than `null`.

4. **Parent can read child's attendance (smoke test)**:
With a parent JWT, query `GET /rest/v1/student_attendance?student_id=eq.<child_uuid>`.
Verify rows are returned.
With a different (unlinked) parent JWT, verify zero rows returned.

## Rollback
The migration is ADDITIVE ONLY. To rollback:
- Drop tables: `DROP TABLE IF EXISTS student_attendance, class_schedule, academic_terms, boards;`
- Remove additive RLS policies on: assignments, assignment_submissions, chapters, subjects, classes, assessment_schedule
- Redeploy previous teacher-dashboard Edge Function version

No existing data is affected (no existing columns/tables were modified).

## Health monitoring
No new health check endpoints required. Monitor:
- `student_attendance` write volume (expect: ~30 rows per class per day when active)
- `get_attendance_record` p95 latency (should be <200ms with class_id + date index)
- Error rate on `mark_attendance` action in Edge Function logs
