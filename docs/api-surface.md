# API Surface — PostgREST Auto-REST Endpoints

This document catalogues Supabase PostgREST auto-exposed endpoints derived from database tables.
Every table with RLS enabled is automatically exposed at `GET|POST|PATCH|DELETE /rest/v1/<table>`.
Access is governed by RLS policies — a valid JWT is always required (no anon access on any table below).

Related catalogs:
- API routes (Next.js): `docs/api-catalog.md`
- Edge Functions: `docs/edge-function-catalog.md`

---

## Phase 1: Academic Structure (2026-06-21)
Migration: `20260621000000_phase1_academic_structure_attendance_boards.sql`

### New PostgREST endpoints

#### GET /rest/v1/boards
Reference data for academic boards (CBSE, ICSE, IB, NIOS).
- **Auth**: All authenticated users
- **RLS**: Authenticated SELECT (no anon access)
- **Key filters**: `?is_active=eq.true`, `?code=eq.CBSE`
- **Seeded boards**: CBSE, ICSE, IB, NIOS

#### GET /rest/v1/academic_terms
Academic term registry (Term 1, Term 2 per board per school).
- **Auth**: School-scoped (student enrolled → school; teacher assigned; parent via child; school_admin)
- **Platform defaults**: Rows with `school_id IS NULL` visible to all authenticated users
- **Key filters**: `?is_current=eq.true`, `?board_code=eq.CBSE`, `?academic_year=eq.2025-26`
- **Seeded**: CBSE 2025-26 Term 1 (Apr-Sep), Term 2 (Oct-Mar, is_current=true)

#### GET /rest/v1/student_attendance
Daily attendance records per student per class.
- **Auth**: Teacher (own classes via class_teachers), student (own rows), parent (child rows via guardian_student_links)
- **RLS**: P13 — parents see child only, students see self only
- **Key filters**: Always filter by `class_id` + date range for performance
  - `?class_id=eq.<uuid>&date=gte.2026-04-01&date=lte.2026-06-30`
- **Status values**: `present` | `absent` | `late` | `excused`
- **Prefer**: `mark_attendance` Edge Function action for batch writes (handles validation + conflict resolution)

#### POST /rest/v1/student_attendance
Insert a single attendance record.
- **Auth**: Teacher (own class only, enforced by RLS)
- **Note**: Use `mark_attendance` Edge Function action for batch upsert (up to 200 records per call)

#### PATCH /rest/v1/student_attendance?id=eq.\<uuid\>
Correct a single attendance record.
- **Auth**: Teacher (own class only)
- **Use case**: Post-submission corrections on a single row

#### GET /rest/v1/class_schedule
Timetable periods for classes.
- **Auth**: Teacher (own), student (enrolled), parent (child's), school_admin (school)
- **Key filters**: `?class_id=eq.<uuid>&is_active=eq.true&day_of_week=eq.1` (1=Tuesday)
- **day_of_week**: 0=Monday, 1=Tuesday, ..., 6=Sunday
- **Time versioning**: `effective_from` / `effective_until` allow new timetables without deleting old ones

#### POST /rest/v1/class_schedule
Create a timetable period.
- **Auth**: Teacher (own class only)
- **Use case**: Timetable setup during school onboarding

#### PATCH /rest/v1/class_schedule?id=eq.\<uuid\>
Edit a timetable period.
- **Auth**: Teacher (own class only)
- **Use case**: Timetable corrections or period rescheduling

### New Edge Function actions (teacher-dashboard)

#### mark_attendance
Bulk-upsert daily roll call. Prefer over direct PostgREST inserts.
```json
POST /functions/v1/teacher-dashboard
{
  "action": "mark_attendance",
  "teacher_id": "<uuid>",
  "class_id": "<uuid>",
  "date": "2026-06-21",
  "records": [
    { "student_id": "<uuid>", "status": "present" },
    { "student_id": "<uuid>", "status": "absent", "notes": "Medical leave" }
  ]
}
```
Response: `{ "upserted": 2, "errors": [] }`
Max batch: 200 records. Status must be one of: `present`, `absent`, `late`, `excused`.

#### get_attendance_record
Fetch roster + existing marks for a class on a date (used to pre-fill the roll-call UI).
```json
POST /functions/v1/teacher-dashboard
{
  "action": "get_attendance_record",
  "teacher_id": "<uuid>",
  "class_id": "<uuid>",
  "date": "2026-06-21"
}
```
Response: `{ "date": "2026-06-21", "class_id": "<uuid>", "students": [...], "records": [...] }`
