# Feature Inventory — Teacher

Target users: teachers in B2B/school contexts. Multi-tenant; RLS/RBAC + cross-tenant
isolation critical (P8/P9/P13). Routes confirmed under `src/app/teacher/` on 2026-06-28.
DB tables / APIs best-effort — **to be verified per cycle**.

---

### Dashboard
- **Business purpose:** teacher home; class overview, alerts, pending actions.
- **Key files:** `src/app/teacher/page.tsx`.
- **DB tables (best-effort):** `teachers`, `classes`, `class_enrollments`, `students`.
- **APIs:** teacher-dashboard reads; `supabase/functions/teacher-dashboard/`.
- **Status:** partial — empty-state (no class assigned) to verify.
- **Known gaps:** at-risk/Pulse surfacing gated by `ff_school_pulse_v1`.

### Classes
- **Business purpose:** view/manage assigned classes and rosters.
- **Key files:** `src/app/teacher/classes/page.tsx`.
- **DB tables (best-effort):** `classes`, `class_enrollments`.
- **APIs:** `/api/school-admin/classes` (shared), teacher-scoped reads (to verify).
- **Status:** partial — teacher sees only own classes (boundary to verify).
- **Known gaps:** roster pagination; cross-class leakage check.

### Students
- **Business purpose:** per-student view for a teacher's roster.
- **Key files:** `src/app/teacher/students/page.tsx`.
- **DB tables (best-effort):** `students`, `student_learning_profiles`.
- **APIs:** teacher-scoped student reads (to verify); `canAccessStudent` boundary.
- **Status:** partial — single cross-role data boundary must hold (P13).
- **Known gaps:** student PII scope; assigned-only enforcement.

### Assignments / Worksheets
- **Business purpose:** create/assign work; worksheet generation.
- **Key files:** `src/app/teacher/assignments/page.tsx`, `src/app/teacher/worksheets/page.tsx`.
- **DB tables (best-effort):** `assignments`, `worksheets`.
- **APIs:** to verify.
- **Status:** partial — generation source and assignment delivery to verify.
- **Known gaps:** content QA (assessment) on generated worksheets.

### Grade-book / Submissions
- **Business purpose:** record/view grades; review student submissions.
- **Key files:** `src/app/teacher/grade-book/page.tsx`, `src/app/teacher/submissions/page.tsx`.
- **DB tables (best-effort):** `grades`, `submissions`.
- **APIs:** to verify.
- **Status:** partial — grade write path + scoring parity to verify.
- **Known gaps:** atomic grade writes; empty-submission state.

### Attendance
- **Business purpose:** mark/track class attendance.
- **Key files:** `src/app/teacher/attendance/page.tsx`.
- **DB tables (best-effort):** `attendance`.
- **APIs:** to verify.
- **Status:** partial — date-scoped writes and duplicate-prevention to verify.
- **Known gaps:** bulk-mark; correction/audit trail.

### Reports
- **Business purpose:** class/student performance reports for teachers.
- **Key files:** `src/app/teacher/reports/page.tsx`.
- **DB tables (best-effort):** `quiz_sessions`, `student_learning_profiles`.
- **APIs:** `/api/school-admin/reports/*` (shared mastery/bloom), teacher-scoped (verify).
- **Status:** partial — learner-metric definitions need assessment sign-off.
- **Known gaps:** export PII scope (P13); empty-data handling.

### Messages
- **Business purpose:** teacher↔parent/student messaging.
- **Key files:** `src/app/teacher/messages/page.tsx`.
- **APIs:** to verify (shared messaging substrate with parent).
- **Status:** partial — thread authorization boundary to verify.
- **Known gaps:** unread counts; notification linkage.

### Onboarding / Profile / Lab-leaderboard (to verify)
- `src/app/teacher/onboarding/page.tsx` (P15 — teacher: school/subjects),
  `src/app/teacher/profile/page.tsx`, `src/app/teacher/lab-leaderboard/page.tsx`.
- **Status:** to verify — teacher onboarding is part of the P15 cycle; confirm 3-role parity.
