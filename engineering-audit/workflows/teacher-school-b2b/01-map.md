# Teacher / School-Admin (B2B) Workflow — End-to-End MAP

Audit Cycle 5 · Architect (RLS / RBAC / auth boundaries) · ANALYSIS ONLY
Repo: `D:\Alfa_local\Alfanumrik` · Date: 2026-06-29

Governing invariants: **P8** (RLS boundary), **P9** (RBAC enforcement), **P13**
(data privacy — a teacher sees ONLY assigned students; a school-admin ONLY their
school), **P7** (bilingual).

Legend for the "Boundary" column:
- **API-only** = enforced solely in application code over the service-role client
  (RLS bypassed).
- **API + RLS** = enforced in app code AND backed by a row-level policy at the DB.
- **RLS-bound** = the client respects RLS (anon/SSR client).

---

## A. Teacher journey

### A1. Login → role gate
- Auth via Supabase (email/PKCE), session cookie refreshed in `src/proxy.ts`
  (middleware). Teacher pages live under `src/app/teacher/**` (20 files incl. 8
  primary portal pages).
- Client role guard: `src/app/teacher/students/page.tsx:502-506`
  redirects to `/login` when `activeRole !== 'teacher' && !teacher`. This is
  **UX-only** (P9 — `usePermissions()` / `activeRole` are not a security boundary).
- Real enforcement is server-side per route (below).

### A2. Two parallel data backends (KEY ARCHITECTURAL FACT)
The teacher portal reads student data through **two different backends with two
different boundary implementations**:

1. **`/api/pulse/*` Next.js routes** → funnel through the strict, class-roster-only
   `canAccessStudent` (`src/lib/rbac.ts:243-346`). This is what the constitution
   calls "the single cross-role data boundary."
2. **`teacher-dashboard` Supabase Edge Function**
   (`supabase/functions/teacher-dashboard/index.ts`, 3722 LOC) → its OWN boundary
   logic (`assertTeacherOwnsClass` + `resolveStudentsForTeacher`), which includes a
   **looser grade-based fallback** that `canAccessStudent` does NOT have.

The students page (`students/page.tsx`) calls BOTH: `get_dashboard` / `get_heatmap`
via the Edge Function (`students/page.tsx:514-527`) for the roster grid, and
`/api/pulse/student/[id]` via `usePulse` (`students/page.tsx:105`) for the
per-student Pulse panel.

### A3. Class / student list (scoped to assignment)

| Surface | Entry | authorizeRequest / gate | Boundary check | Boundary type | Evidence |
|---|---|---|---|---|---|
| Roster grid | `teacher-dashboard` `get_dashboard` | JWT→`teacher_id` bind (overrides body) | classes via `class_teachers.eq(teacher_id)`; roster via `class_students` | API-only (service role) | `index.ts:3597-3624` (bind), `:182-187` (classes), `:196-203` (roster) |
| Heatmap | `get_heatmap` | JWT bind | `assertTeacherOwnsClass` | API-only | `index.ts:360-362`, `:75-110` |
| At-risk alerts | `get_alerts` | JWT bind | `assertTeacherOwnsClass` | API-only | `index.ts:479-481` |
| Class Pulse list | `GET /api/pulse/class/[classId]` | `authorizeRequest(req,'class.view_analytics')` | teacher row + `class_teachers`(active) ownership | API + RLS-adjacent | `class/[classId]/route.ts:52`, `:99-130` |
| Lab leaderboard | `GET /api/teacher/lab-leaderboard` | `authorizeRequest(req,'class.manage')` | `class_teachers`→`class_enrollments` | API-only | `lab-leaderboard/route.ts:83`, `:108-160` |
| School student list | `GET /api/school-admin/students` | `authorizeSchoolAdmin(req,'institution.manage_students')` | `.eq('school_id', auth.schoolId)` | API-only | `school-admin/students/route.ts:37`, `:66` |

### A4. Per-student drill-down (Pulse / reports)

| Surface | Entry | Gate | Boundary check | Boundary type | Evidence |
|---|---|---|---|---|---|
| Single-student Pulse | `GET /api/pulse/student/[id]` | `authorizeRequest(req)` (auth only) → `canAccessStudent` HARD gate → `hasAnyPermission(VIEW_PERMISSIONS)` | `canAccessStudent` (own/linked/assigned/institution/admin) | **API-only** (no RLS on `students` for teachers) | `student/[id]/route.ts:61-104`; `rbac.ts:243-346` |
| Student report | `get_student_report` | JWT bind | `resolveStudentsForTeacher` then `owned.find(id)` | API-only + **grade fallback** | `index.ts:1047-1051`, `:810-886` |
| Student mastery report | `get_student_mastery_report` | JWT bind | `resolveStudentsForTeacher` then `owned.find(id)` | API-only + grade fallback | `index.ts:3002-3005` |
| Class overview/trends | `get_class_overview` / `get_class_trends` | JWT bind | aggregate over `resolveStudentsForTeacher` | API-only + grade fallback | `index.ts:908`, `:1135` |

Pulse single-student boundary is the strongest in the codebase: triple gate
(authenticate → `canAccessStudent` hard boundary → viewing-permission), audit on
every deny, no student payload on any deny path
(`student/[id]/route.ts:76-104,144-149`). The `canAccessStudent` teacher branch is
class-roster-only: `teachers`→`class_teachers`(active)→`class_students`(active),
fail-closed on any error (`rbac.ts:310-343`).

### A5. Teacher actions (mutations)

| Action | Route | authorizeRequest (BEFORE I/O?) | Ownership / scope | RLS backstop | Evidence |
|---|---|---|---|---|---|
| Save note + goal | `PUT /api/teacher/students/[id]/notes` | `class.manage` ✅ | `canAccessStudent` | none on `teacher_student_notes` | `notes/route.ts:38`, `:56-57` |
| Assign remediation | `POST /api/teacher/remediation` | `class.assign_remediation` ✅ | `rosterClassId` (`class_teachers`×`class_students`) + 23505 dedupe | **YES** — full RLS on `teacher_remediation_assignments` | `remediation/route.ts:137`, `:99-133`; migration `20260613000004:113-202` |
| Message parent | `POST /api/teacher/parent-notify` | `class.manage` ✅ | `rosterClassId` + `guardian_student_links` | none new | `parent-notify/route.ts:203`, `:225-232` |
| Create assignment | `POST /api/teacher/assignments` | `class.manage` ✅ | `class_teachers` ownership | RLS on `assignments` (`Teachers can manage own assignments`) | `assignments/route.ts:42`, `:69-82`; baseline `:20204` |
| Create class | `POST /api/teacher/classes` | `class.manage` ✅ | teacher.id from auth.uid; SECURITY DEFINER RPC | RLS on `classes` | `classes/route.ts:50`, `:64-88` |
| Join class | `POST /api/teacher/join-class` | `class.manage` ✅ | tenant derived from class code (never body) | UNIQUE(class_id,teacher_id) | `join-class/route.ts:47`, `:50-59,122-127` |
| Thread messages | `GET /api/teacher/messages/threads/[id]/messages` | `class.manage` ✅ | `thread.teacher_id === teacher.id` | — | `messages/.../route.ts:42`, `:76` |
| Grade / attendance / grade-book | `teacher-dashboard` various | JWT bind | `assertTeacherOwnsClass` on every handler | API-only | `index.ts:2058,2305,2504,3044,3466` |

Every mutating teacher route resolves the internal `teachers.id` from `auth.uid()`
and NEVER trusts a body-supplied teacher_id. All call `authorizeRequest` (or the
Edge Function JWT bind) BEFORE the first DB write.

---

## B. School-admin (institution) journey

### B1. Role gate
- All `/api/school-admin/*` routes gate via `authorizeSchoolAdmin(request,
  '<institution permission>')` and derive `schoolId` from the caller's
  `school_admins` row — NEVER from the request body
  (`school-admin/students/route.ts:37-40`).

### B2. School lens
- `GET /api/pulse/school` → `resolveCommandCenterContext` does P9
  (`authorizeRequest('institution.view_analytics')`) + builds a **JWT-bound**
  (RLS-respecting) client + resolves `school_id` from `school_admins`
  (`pulse/school/route.ts:44-49`). Read models `get_school_overview` /
  `get_classes_at_risk` are SECURITY DEFINER and internally school-scope-guarded;
  payload is **aggregate counts only — no per-student PII** (`school/route.ts:51-89`).
  Boundary type: **API + RLS** (JWT-bound client is the boundary).

### B3. School student list / mutations
- `GET/PATCH/POST /api/school-admin/students` → every query carries
  `.eq('school_id', schoolId)`; PATCH double-checks tenant on the UPDATE
  (`students/route.ts:66,154,210`). `class_id` cross-tenant rejection on create
  (`students/route.ts:510-522`). Boundary type: **API-only** (service-role), with
  RLS backstop `"School admins can view school students"` on `public.students`
  (baseline `:19906`).

### B4. Cross-role student drill-down
- A school-admin (`institution_admin`) reaching a single student goes through the
  SAME `/api/pulse/student/[id]` route; `canAccessStudent` institution branch:
  `students.school_id` matched against `school_admins(auth_user_id, school_id,
  is_active)` (`rbac.ts:254-272`). Boundary type: **API-only**.

---

## C. Adaptive B2B escalation attribution (REG-128 / REG-133)
- The cron worker `src/app/api/cron/adaptive-remediation/route.ts` attributes a
  remediation/escalation to the correct ASSIGNED teacher using tiered subject
  matching `_lib/subject-match.ts` (`subjectMatchTier`, tier 2 exact > tier 1
  token-boundary > tier 0). Token-boundary anchoring at token 0 prevents
  `'science' ⊂ 'Social Science'` false positives (`subject-match.ts:60-87`).
- Cross-teacher idempotency: the partial unique index
  `uq_teacher_remediation_assignments_open_dedupe` (migration `20260619000400`)
  turns a duplicate open row into a 23505 handled as idempotent success
  (`remediation/route.ts:229-258`). Boundary type: **API + RLS**.

---

## D. Where the cross-role boundary is enforced (summary)

| Boundary | Enforced at | RLS-backed? | Single funnel? |
|---|---|---|---|
| Teacher → single student (Pulse) | `canAccessStudent` (app, service role) | **NO** (no teacher SELECT policy on `students`) | Yes — for `/api/pulse/*` only |
| Teacher → class roster (Pulse) | `class_teachers` ownership (app) | partial (`class_students`/`class_teachers` have teacher SELECT policies) | No |
| Teacher → students (teacher-dashboard) | `assertTeacherOwnsClass` + `resolveStudentsForTeacher` **incl. grade fallback** | NO (service role) | **No — diverges from canAccessStudent** |
| Teacher → remediation rows | app roster check + **full RLS** | **YES** | Yes |
| School-admin → school students | `.eq(school_id)` (app) + RLS | **YES** | No |
| School-admin → school aggregate | JWT-bound SECURITY DEFINER RPCs | **YES** | Yes |

The headline: the strict `canAccessStudent` funnel is real for `/api/pulse/*`, but
the **primary teacher analytics surface (teacher-dashboard Edge Function) bypasses
it** and applies a looser, grade-based, tenant-unscoped resolution. See
`02-gap-analysis.md` (TSB-1, TSB-3).
