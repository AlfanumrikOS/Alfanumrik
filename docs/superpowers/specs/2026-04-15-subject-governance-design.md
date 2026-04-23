# Subject Governance — Design Spec

**Date:** 2026-04-15
**Status:** Approved (defaults accepted by user 2026-04-15)
**Owner (design):** orchestrator + architect + backend + frontend + assessment + ops
**Invariants at risk:** P5 (grade format), P7 (bilingual), P8 (RLS boundary), P9 (RBAC), P12 (AI safety), P13 (data privacy). None violated by this change.

---

## 1. Problem

Students on Alfanumrik see subjects that are not valid for their grade or subscription plan. The business rule is that a student must see only `(subjects valid for their grade) ∩ (subjects allowed by their plan) ∩ (stream constraints where applicable)`. The current implementation has no governance layer:

- No DB table encodes grade → subject validity.
- No DB table encodes plan → subject access.
- No RPC or service computes the canonical intersection.
- Every UI surface re-derives "allowed subjects" from one of four incompatible sources.
- Every write path accepts subjects as free-form text with no validation.

Fix: introduce a governance schema, a governance service, DB-level enforcement, and replace all ad-hoc subject lookups with a single shared contract. Clean up legacy data via auditable migration.

## 2. Root cause (from audit)

1. `subjects` master table exists in live Supabase. RLS is enabled but **no policies are committed in git** — the table is readable only because a live permissive policy or a non-RLS copy exists. No `grade_subject_map`, no `plan_subject_access`.
2. `src/lib/constants.ts:GRADE_SUBJECTS` and `mobile/lib/core/constants/grade_subjects.dart` are the de-facto governance. Duplicated, client-side, unenforced.
3. `src/lib/plans.ts` advertises "2 subjects / 4 subjects / All subjects" as marketing strings. Zero code enforces which subjects.
4. `students.preferred_subject TEXT DEFAULT 'Mathematics'` and `students.selected_subjects TEXT[] DEFAULT '{}'` are free-form. No FK, no CHECK, no trigger.
5. `PATCH /api/student/preferences set_selected_subjects` writes the array verbatim — the single worst offender.
6. 17 other API routes and Edge Functions accept subjects as free-form (see §9 list).
7. 7 of 27 student UI surfaces are leakers. 1 (`/learn`) is correctly gated.
8. Grades 11-12 have no stream column. Every senior student sees the 12-subject superset.
9. `getSubjectsForGrade()` silently falls back to Grade 9 on unknown input.
10. `coding` is treated as a CBSE subject. It is an Alfanumrik premium add-on.
11. `parent-portal` Edge Function reads stale `selected_subjects` without re-validation.
12. `/api/concept-engine` `action=chapter` and `action=search` are unauthenticated — content-access bypass unrelated to but entangled with the governance fix.

## 3. Decisions (approved 2026-04-15)

| # | Decision | Choice |
|---|---|---|
| 1 | Plan-subject model | **B (whitelist)** via `plan_subject_access`, with `subscription_plans.max_subjects` column to model A (count cap) as a degenerate case |
| 2 | Stream column on `students` | **Yes** for grades 11-12; nullable for 6-10 |
| 3 | Enrollment storage | **New `student_subject_enrollment` join table**; keep `students.selected_subjects TEXT[]` as denormalized cache backfilled by trigger |
| 4 | Legacy violation handling | **Auto-repair + archive** to `legacy_subjects_archive`, log every correction |
| 5 | `/api/concept-engine` auth bypass | **Fix in this task** |
| 6 | `coding` classification | **`platform_elective`**, entitlement-gated |
| 7 | Sunset of `GRADE_SUBJECTS` / `SUBJECT_META` | **Compat shim for one release**, deprecation warnings on import, removed in a follow-up PR |

## 4. Data model

### 4.1 `subjects` (existing — extend)

```sql
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS name_hi TEXT,
  ADD COLUMN IF NOT EXISTS subject_kind TEXT NOT NULL DEFAULT 'cbse_core'
    CHECK (subject_kind IN ('cbse_core','cbse_elective','platform_elective'));
```

Canonical codes (snake_case):
`math, science, english, hindi, social_studies, physics, chemistry, biology, economics, accountancy, business_studies, history_sr, geography, political_science, computer_science, sanskrit, coding`.

### 4.2 `grade_subject_map` (new)

```sql
CREATE TABLE grade_subject_map (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grade            TEXT NOT NULL CHECK (grade IN ('6','7','8','9','10','11','12')),
  subject_code     TEXT NOT NULL REFERENCES subjects(code) ON UPDATE CASCADE,
  stream           TEXT CHECK (stream IN ('science','commerce','humanities') OR stream IS NULL),
  is_core          BOOLEAN NOT NULL DEFAULT TRUE,
  min_questions_seeded INT NOT NULL DEFAULT 10,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- NULLS NOT DISTINCT (PG15+) makes (grade, subject_code, NULL) collide uniquely
CREATE UNIQUE INDEX grade_subject_map_uniq
  ON grade_subject_map (grade, subject_code, stream) NULLS NOT DISTINCT;
CREATE INDEX ON grade_subject_map (subject_code);
ALTER TABLE grade_subject_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY gsm_read_all ON grade_subject_map FOR SELECT USING (true);
CREATE POLICY gsm_write_service ON grade_subject_map FOR ALL USING (false) WITH CHECK (false);
-- writes only via service role or super-admin RPC
```

Seed content (from assessment audit):

| Grade | Stream | Subjects |
|---|---|---|
| 6,7,8 | NULL | math, science, english, hindi, social_studies, sanskrit(optional, is_core=false) |
| 9,10 | NULL | math, science, english, hindi, social_studies, sanskrit(opt), computer_science(opt) |
| 11,12 | science | math, physics, chemistry, biology, english, computer_science(opt), hindi(opt), sanskrit(opt) |
| 11,12 | commerce | math(opt), accountancy, business_studies, economics, english, computer_science(opt), hindi(opt) |
| 11,12 | humanities | history_sr, geography, political_science, economics, english, hindi(opt), sanskrit(opt) |

`coding` is NOT in `grade_subject_map`. It is an entitlement (§4.5).

### 4.3 `plan_subject_access` (new)

```sql
CREATE TABLE plan_subject_access (
  plan_code     TEXT NOT NULL CHECK (plan_code IN ('free','starter','pro','unlimited')),
  subject_code  TEXT NOT NULL REFERENCES subjects(code) ON UPDATE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_code, subject_code)
);
ALTER TABLE plan_subject_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY psa_read_all ON plan_subject_access FOR SELECT USING (true);
CREATE POLICY psa_write_service ON plan_subject_access FOR ALL USING (false) WITH CHECK (false);
```

Seed content:
- **free**: `math, science, english, hindi, social_studies` (5 universal cores; `max_subjects=2` caps selection)
- **starter**: all `free` + `sanskrit, computer_science, history_sr, geography, political_science` (no `max_subjects`, stream-gated)
- **pro**: all CBSE subjects (all `grade_subject_map` rows)
- **unlimited**: all CBSE subjects + `coding`

### 4.4 `subscription_plans` (existing — extend)

```sql
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS max_subjects INT NULL;
-- NULL = unlimited within allowlist. free = 2.
UPDATE subscription_plans SET max_subjects = 2 WHERE plan_code = 'free';
UPDATE subscription_plans SET max_subjects = 4 WHERE plan_code = 'starter';
UPDATE subscription_plans SET max_subjects = NULL WHERE plan_code IN ('pro','unlimited');
```

Matches current `plans.ts` marketing copy ("2 subjects", "4 subjects", "All subjects") as data.

### 4.5 Platform entitlements

Kept orthogonal to grade × plan subjects:

```sql
-- already exists: subscription_plans features json column or equivalent
-- we use plan_subject_access for subject entitlement
-- 'coding' is in plan_subject_access only for plan_code='unlimited'
-- (and 'pro' if product decides — flip via admin UI, not migration)
```

### 4.6 `students` (existing — extend)

```sql
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS stream TEXT
    CHECK (stream IN ('science','commerce','humanities') OR stream IS NULL);
-- grades 11-12 must capture during onboarding (enforced in service layer + UI)
-- grades 6-10 leave NULL
```

Grade stays TEXT per P5. `subscription_plan` stays as denormalized cache. Service layer always reads authoritative plan from `student_subscriptions.plan_code` where `status IN ('active','trialing','grace')`.

### 4.7 `student_subject_enrollment` (new)

```sql
CREATE TABLE student_subject_enrollment (
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_code  TEXT NOT NULL REFERENCES subjects(code) ON UPDATE CASCADE,
  selected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT NOT NULL DEFAULT 'student'
    CHECK (source IN ('student','admin','migration','onboarding')),
  PRIMARY KEY (student_id, subject_code)
);
CREATE INDEX ON student_subject_enrollment (student_id);
ALTER TABLE student_subject_enrollment ENABLE ROW LEVEL SECURITY;
CREATE POLICY sse_read_own ON student_subject_enrollment FOR SELECT
  USING (student_id = auth.uid());
CREATE POLICY sse_write_own ON student_subject_enrollment FOR ALL
  USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());
-- admin writes via service role only
```

Trigger `enforce_subject_enrollment` BEFORE INSERT OR UPDATE:
```
1. Load student.grade, student.stream, active plan_code.
2. Check (grade, subject_code, stream) exists in grade_subject_map.
3. Check (plan_code, subject_code) exists in plan_subject_access.
4. On INSERT: check COUNT(*) < subscription_plans.max_subjects (if not NULL).
5. On success, mirror to students.selected_subjects TEXT[] (denormalized cache).
6. On reject: RAISE EXCEPTION with structured detail {code, reason}.
```

### 4.8 `students.preferred_subject`

Keep column. Add service-layer guard: must be in `student_subject_enrollment`. Add CHECK constraint referencing the enrollment set via trigger (cannot CHECK a subquery in Postgres; enforced by trigger).

### 4.9 `legacy_subjects_archive` (new)

```sql
CREATE TABLE legacy_subjects_archive (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  invalid_subjects TEXT[] NOT NULL,
  reason        TEXT NOT NULL,
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON legacy_subjects_archive (student_id);
```

### 4.10 Audit logging

Reuse `admin_audit_log`. Action codes:
- `subject.master.created|updated|toggled`
- `grade_subject_map.upserted|deleted`
- `plan_subject_access.upserted|deleted`
- `subject_enrollment.admin_edit`
- `subject.legacy_violation.detected`
- `subject.legacy_violation.repaired`

### 4.11 `question_bank.subject` integrity

```sql
ALTER TABLE question_bank
  ADD CONSTRAINT question_bank_subject_fk
  FOREIGN KEY (subject) REFERENCES subjects(code) ON UPDATE CASCADE
  NOT VALID;
-- NOT VALID so existing bad rows don't block the migration;
-- validate in a separate step after data cleanup.
```

## 5. Service layer — `src/lib/subjects.ts` (new, single source)

```typescript
// Pure types
export type SubjectCode = string;
export type Stream = 'science' | 'commerce' | 'humanities' | null;
export type PlanCode = 'free' | 'starter' | 'pro' | 'unlimited';

export interface Subject {
  code: SubjectCode;
  name: string;
  nameHi: string;
  icon: string;
  color: string;
  subjectKind: 'cbse_core' | 'cbse_elective' | 'platform_elective';
  isCore: boolean;      // derived from grade_subject_map for the calling grade
  isLocked: boolean;    // true if grade-valid but not plan-allowed
}

// Server-side (Node or Edge)
export async function getAllowedSubjectsForStudent(
  studentId: string,
  ctx: ServerCtx
): Promise<Subject[]>;

// Called by every write path
export async function validateSubjectWrite(
  studentId: string,
  subjectCode: SubjectCode,
  ctx: ServerCtx
): Promise<OkOr<SubjectWriteError>>;

export async function validateSubjectsBulk(
  studentId: string,
  subjectCodes: SubjectCode[],
  ctx: ServerCtx
): Promise<OkOr<SubjectWriteError>>;

export interface SubjectWriteError {
  code: 'subject_not_allowed';
  subject: string;
  reason: 'grade' | 'stream' | 'plan' | 'inactive' | 'unknown' | 'max_subjects';
  allowed: SubjectCode[];  // for client repair UX
}

// Client-side React hook
export function useAllowedSubjects(): {
  subjects: Subject[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};
```

Service layer is the ONLY place that reads `grade_subject_map`, `plan_subject_access`, or `student_subject_enrollment`. Callers never construct queries against those tables directly.

### 5.1 RPC

```sql
CREATE FUNCTION get_available_subjects(p_student_id UUID)
RETURNS TABLE (code TEXT, name TEXT, name_hi TEXT, icon TEXT, color TEXT,
               subject_kind TEXT, is_core BOOLEAN, is_locked BOOLEAN)
LANGUAGE SQL SECURITY DEFINER AS $$
  WITH s AS (SELECT grade, stream FROM students WHERE id = p_student_id),
       p AS (SELECT plan_code FROM student_subscriptions
             WHERE student_id = p_student_id
               AND status IN ('active','trialing','grace')
             ORDER BY current_period_end DESC LIMIT 1),
       grade_valid AS (
         SELECT gsm.subject_code, gsm.is_core FROM grade_subject_map gsm, s
         WHERE gsm.grade = s.grade
           AND (gsm.stream IS NULL OR gsm.stream = s.stream)
       ),
       plan_valid AS (
         SELECT psa.subject_code FROM plan_subject_access psa, p
         WHERE psa.plan_code = COALESCE(p.plan_code, 'free')
       )
  SELECT sub.code, sub.name, sub.name_hi, sub.icon, sub.color,
         sub.subject_kind, gv.is_core,
         (gv.subject_code NOT IN (SELECT subject_code FROM plan_valid)) AS is_locked
  FROM subjects sub
  JOIN grade_valid gv ON gv.subject_code = sub.code
  WHERE sub.is_active;
$$;
```

### 5.2 `set_student_subjects` RPC (replaces free-form preference write)

```sql
CREATE FUNCTION set_student_subjects(
  p_student_id UUID, p_subjects TEXT[], p_preferred TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_allowed TEXT[];
  v_invalid TEXT[];
BEGIN
  SELECT ARRAY_AGG(code) INTO v_allowed FROM get_available_subjects(p_student_id)
    WHERE NOT is_locked;
  v_invalid := ARRAY(SELECT UNNEST(p_subjects) EXCEPT SELECT UNNEST(v_allowed));
  IF array_length(v_invalid, 1) > 0 THEN
    RAISE EXCEPTION 'subject_not_allowed'
      USING DETAIL = jsonb_build_object('invalid', v_invalid, 'allowed', v_allowed)::text;
  END IF;
  -- replace enrollment atomically
  DELETE FROM student_subject_enrollment WHERE student_id = p_student_id;
  INSERT INTO student_subject_enrollment (student_id, subject_code, source)
    SELECT p_student_id, UNNEST(p_subjects), 'student';
  UPDATE students
    SET selected_subjects = p_subjects,
        preferred_subject = COALESCE(p_preferred, p_subjects[1])
    WHERE id = p_student_id;
  RETURN jsonb_build_object('ok', true, 'subjects', p_subjects);
END;
$$;
```

### 5.3 Cached reads

`students.selected_subjects` remains a denormalized cache, trigger-maintained. Existing readers do not break. New code should prefer `getAllowedSubjectsForStudent` for display and `student_subject_enrollment` for enrollment truth.

## 6. API layer

All changes validate via the service. Every subject-touching route is listed with its required change.

### 6.1 Next.js routes (change)

| Route | Change |
|---|---|
| `GET /api/student/subjects` (NEW) | Wraps `get_available_subjects`. Used by web + mobile + Flutter. Response: `{ subjects: Subject[] }`. |
| `PATCH /api/student/preferences` action `set_selected_subjects` | Route through `set_student_subjects` RPC. On error, return 422 with structured body. |
| `PATCH /api/student/profile` | Drop hardcoded `ALLOWED_SUBJECTS`. Validate `preferred_subject` via service. |
| `POST /api/auth/bootstrap` | Validate `subjects_taught` (teacher) / student subjects against service before calling `bootstrap_user_profile`. |
| `POST /api/foxy/route.ts` | Service validation on subject param; reject with 422 if not allowed. Same for `/api/foxy/interact`. |
| `GET/POST /api/quiz/route.ts` | Validate subject param via service. Reject invalid. |
| `GET /api/quiz/ncert-questions` | Same. |
| `GET /api/concept-engine` | (a) Add `authorizeRequest(request, 'content.read')` on `chapter` and `search` actions. (b) Validate subject via service. |
| `POST /api/diagnostic/start` | Delete local `SUBJECT_BY_GRADE`; call service. |
| `POST /api/student/exam-simulation` | Validate grade + subject via service. |
| `POST /api/student/foxy-interaction` | Service validation. |
| `POST /api/scan-solve` | Remove header/form subject override; force `student.preferred_subject` or service-validated input. |
| `POST /api/v1/exam/create` | Validate `subject` against teacher's `subjects_taught` (after those are validated). |
| `PATCH /api/internal/admin/users/[id]` | Validate `preferred_subject`. |
| `POST /api/super-admin/demo-accounts` | Use `'math'` (lowercase), pull from subject master, not literal. |

### 6.2 Supabase Edge Functions (change)

| Function | Change |
|---|---|
| `foxy-tutor` | Subject check against `get_available_subjects(student.id)`; 422 if not allowed. |
| `ncert-solver` | Same. |
| `quiz-generator` | Filter `question_bank` by service-validated subject; reject if outside. |
| `cme-engine` | `subject_id` validated against enrollment. |
| `parent-portal` | Read enrollment (not `selected_subjects`) and re-intersect with current grade/plan before returning to parent. |
| `teacher-dashboard` | Filter displayed student subjects via service. |
| `export-report` | Same. |

### 6.3 New super-admin endpoints

```
POST   /api/super-admin/subjects                 — create subject
PATCH  /api/super-admin/subjects/:code            — update / toggle active
GET    /api/super-admin/subjects/grade-map        — list grade_subject_map
PUT    /api/super-admin/subjects/grade-map        — upsert rows
DELETE /api/super-admin/subjects/grade-map        — remove row
GET    /api/super-admin/subjects/plan-access      — list plan_subject_access
PUT    /api/super-admin/subjects/plan-access      — upsert rows
DELETE /api/super-admin/subjects/plan-access      — remove row
GET    /api/super-admin/subjects/violations       — report of students whose current
                                                    enrollment violates their plan or grade
PATCH  /api/super-admin/students/:id/subjects     — admin override; logged, bypasses
                                                    trigger only if `force=true` AND
                                                    reason provided (audited)
```

Every mutation calls `logAdminAudit()`. Every route uses `authorizeRequest(request, 'super_admin.subjects.manage')`.

## 7. UI layer

### 7.1 Hook adoption

Every one of the 27 picker surfaces is migrated to `useAllowedSubjects()`. Direct imports of `GRADE_SUBJECTS`, `SUBJECT_META`, `SUBJECT_BY_GRADE`, and local `const SUBJECTS` maps are forbidden. An ESLint rule (`alfanumrik/no-raw-subject-imports`) enforces this.

### 7.2 Per-surface outcomes

| File | Before | After |
|---|---|---|
| `src/app/dashboard/page.tsx` picker + chips | All active DB subjects | `useAllowedSubjects()`; locked subjects hidden (except in `/learn`) |
| `src/app/foxy/page.tsx` | Local `SUBJECTS` map | Hook |
| `src/components/quiz/QuizSetup.tsx` | `SUBJECT_META.slice(0,9)` | Hook |
| `src/components/quiz/ncert/NCERTQuizSetup.tsx` | 9-item literal | Hook |
| `src/app/scan/page.tsx` | `SUBJECT_META.slice(0,9)` | Hook |
| `src/app/exams/page.tsx` | Same | Hook |
| `src/app/mock-exam/page.tsx` | Grade filter, no plan | Hook |
| `src/app/pyq/page.tsx` | Same | Hook |
| `src/app/study-plan/page.tsx` | `SUBJECT_META.slice(0,9)` | Hook |
| `src/components/challenge/ChallengeMode.tsx` | Grade filter, no plan | Hook |
| `src/app/profile/page.tsx` | Grade filter, no plan | Hook; invalid preferred shows migration banner |
| `src/app/learn/page.tsx` | Already correctly gated | Hook (simplifies code); locked state stays |
| `src/components/foxy/*.tsx` display maps | Local maps | Hook (display-only, but source unified) |
| `src/components/onboarding/OnboardingFlow.tsx` | Dead-code import | Hook; wire into new stream capture step |

### 7.3 Onboarding additions

- Add a "Stream" step for grades 11-12 (science / commerce / humanities). Blocking; cannot proceed without selection.
- After grade (and stream if applicable), show subject picker with `useAllowedSubjects()`. Enforce `max_subjects` on free plan (cap at 2).
- Backward compat: existing users without stream on grade 11-12 are intercepted at dashboard with a blocking modal on next login.

### 7.4 Legacy-data banner

Any student whose enrollment is empty after repair sees a blocking card: "Select your subjects to continue" with the allowed picker. Copy in EN + HI.

### 7.5 Bilingual

All subject `name_hi` seeded in migration. No hand-written Hindi labels in UI — always `isHi ? subject.nameHi : subject.name`.

## 8. Admin surfaces (super-admin)

New pages:

| Page | Purpose |
|---|---|
| `/super-admin/subjects` | Subject master CRUD. Toggle active, reorder, edit names/icons/colors, set `subject_kind`. |
| `/super-admin/subjects/grade-map` | Toggle grid: rows grades 6–12, cols subjects, cells `{enabled, stream?, is_core, min_questions_seeded}`. |
| `/super-admin/subjects/plan-access` | Rows plans (free/starter/pro/unlimited), cols subjects, cells checkbox. Shows `max_subjects` per plan. |
| `/super-admin/subjects/violations` | Table: students whose enrollment violates plan or grade. Filters by plan, grade, stream. CTA: auto-repair. |
| `/super-admin/students/:id` (extended) | Show `selected_subjects`, `preferred_subject`, `stream`; admin edit with confirmation and audit log. |

Behavior:
- Saves use the dedicated admin APIs; every mutation calls `logAdminAudit()`.
- Changes to `grade_subject_map` or `plan_subject_access` auto-trigger a re-check: students whose enrollment is now invalid get flagged in the Violations report (no auto-delete of their enrollment; ops runs repair explicitly).

## 9. Enforcement matrix

| Layer | Enforcement |
|---|---|
| DB | Trigger on `student_subject_enrollment`; FK on `question_bank.subject` (NOT VALID then validated post-cleanup); RLS policies on new tables; RPCs use `SECURITY DEFINER` with auth checks. |
| RPC | `set_student_subjects` is the single write path. Free-form writes to `selected_subjects` are no longer made from client code. |
| API | Every subject-touching route wraps the service; structured 422 errors include `allowed` set. |
| Edge Function | Every subject-touching function validates via RPC before processing. |
| UI | `useAllowedSubjects()` everywhere; ESLint rule prevents raw imports. |
| Admin | All writes via dedicated APIs, all audit-logged; every super-admin action requires `super_admin.subjects.manage` permission. |

## 10. Data cleanup plan

Migration chain:

1. `0xxx_subject_governance_schema.sql` — create tables, columns, indexes, RLS policies, RPCs, triggers (disabled at first).
2. `0xxx_subject_governance_seed.sql` — seed `subjects.name_hi` for all 17 codes; seed `grade_subject_map` from approved matrix; seed `plan_subject_access` from approved matrix; set `subscription_plans.max_subjects`.
3. `0xxx_subject_governance_detect.sql` — for each student, compute `invalid = selected_subjects − get_available_subjects(student)`. Write to `admin_audit_log` with action `subject.legacy_violation.detected`. Produces a count report in `ops_events`.
4. `0xxx_subject_governance_repair.sql` — for each violation:
   - Insert valid subjects into `student_subject_enrollment(source='migration')`.
   - Archive invalid into `legacy_subjects_archive`.
   - Update `students.selected_subjects` and `preferred_subject` (fall back to first valid, else NULL).
   - Write `subject.legacy_violation.repaired` with before/after.
5. `0xxx_subject_governance_enable.sql` — enable trigger; validate `question_bank.subject` FK (NOT VALID → VALID).
6. `0xxx_subject_governance_compat_shim.sql` — no-op SQL; corresponding code-side compat: `src/lib/constants.ts` exports `GRADE_SUBJECTS`, `SUBJECT_META`, `getSubjectsForGrade` as thin wrappers around the service with a `console.warn` deprecation (removed in next release).

Rollback: each migration has a `down` equivalent that drops new constraints/triggers only. Data backfills are idempotent (re-running repair is safe — archive entries dedupe on `(student_id, invalid_subjects, archived_at::date)`).

## 11. Tests

### 11.1 Unit
- `subjects.test.ts`: `getAllowedSubjectsForStudent` across grade × stream × plan matrix (7 grades × 3 streams × 4 plans = 84 combinations; table-driven).
- `subjects.test.ts`: `validateSubjectWrite` accepts plan-allowed, rejects plan-excluded (`reason='plan'`), rejects grade-invalid (`reason='grade'`), rejects stream-invalid (`reason='stream'`), rejects above `max_subjects` (`reason='max_subjects'`).
- RPC tests: `set_student_subjects` rejects invalid batch atomically (all or nothing).

### 11.2 Integration (API)
- Onboarding happy paths for all 3 roles (student/teacher/parent) × grades 6, 8, 10, 11-sci, 11-com, 11-hum, 12-sci.
- `PATCH /api/student/preferences set_selected_subjects` rejects unauthorized subject with 422 and `allowed` array.
- `PATCH /api/student/profile` rejects invalid `preferred_subject` with 422.
- `GET /api/student/subjects` returns correct intersection for every sample student.
- Plan change (free→starter) refreshes allowed subjects for the same student.
- Admin change to `plan_subject_access` flips a subject to locked for affected students.

### 11.3 Regression
Added to the catalog:
- "Class 6 free-plan student never sees Physics/Chemistry/Biology/Accountancy anywhere (dashboard, quiz, scan, exam, foxy, profile)."
- "API never returns global subject list from an authenticated student endpoint."
- "Grade 11 commerce student never sees Physics."
- "Grade 11 science student never sees Accountancy."
- "Downgrading pro→starter clamps selected_subjects and surfaces a re-selection banner."
- "Admin removing a subject from `plan_subject_access` flags but does not delete enrollments; ops repair removes them with audit."

### 11.4 Edge cases
- Expired subscription → falls back to `free` plan entitlements.
- Missing profile / stream on grade 11 → blocking modal, enrollment empty until resolved.
- Student on `grade_subject_map` row with `min_questions_seeded` threshold not met → subject listed but disabled with reason `seed_threshold`.
- Race: simultaneous onboarding writes are serialized by the RPC's transaction.
- Super-admin force-override with `reason` creates audit trail and bypasses trigger.

### 11.5 E2E (Playwright)
- Full onboarding for grade 11 science: stream capture → subject picker → enrollment → dashboard shows only science stream subjects.
- Legacy user with invalid enrollment: on first login post-migration, sees banner; reselects; dashboard updates.

### 11.6 Coverage targets
`src/lib/subjects.ts`: 90%. Service layer is safety-critical.

## 12. Mobile contract

- `mobile/lib/core/constants/grade_subjects.dart` — **deleted**.
- New Dart provider `subjectsProvider` hits `GET /api/student/subjects`. Cached for session. Refreshed on plan change webhook (or polling on app resume).
- Flutter subject picker uses provider. No hardcoded lists.
- `XP sync is unchanged` — this task does not touch XP or scoring.
- Mobile agent reviews: API contract parity, offline behavior (cache per plan), Play Store compliance (no subjects advertised that can't be purchased).

## 13. Observability and rollout

- Structured logger: every service validation emits `subject.validate { studentId, subject, result, reason }` at info level; rejections at warn.
- Metrics (`ops_events`): `subject.violation.detected`, `subject.violation.repaired`, `subject.admin.change`, `subject.plan.change.affected_students`.
- Feature flag `subject_governance_enforcement` (default OFF initially, then per-environment ON). Used ONLY to disable the DB trigger and the 422 responses in emergency; UI always uses the hook.
- Rollout: staging full → production compat-shim ON, enforcement OFF 24h → enable enforcement → remove compat shim in +1 release.
- Rollback plan: feature flag off restores previous write behavior; trigger drop migration is prepared.

## 14. Out of scope (explicitly)

- XP/scoring changes (P1, P2).
- Anti-cheat changes (P3).
- Atomic quiz RPC (P4).
- Payment flow changes (P11).
- New subjects beyond the canonical 17.
- Multi-board support (ICSE/IB) — architecture permits it (add `board` to `grade_subject_map` later), but not shipped now.

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Migration mis-detects violations and archives good data | Idempotent archive; dry-run mode logs to `admin_audit_log` without mutation; 72-hour observation window before repair |
| Live `subjects` table has a permissive RLS policy not in git that we overwrite | Before enforcement, architect queries live policies and reconciles |
| Grade 11-12 legacy users have no `stream` | Blocking modal on next login; not auto-assigned |
| Service layer becomes a hot path | `get_available_subjects` result cached per (grade, stream, plan) for 5 min in edge KV; cache bust on admin change |
| ESLint rule blocks legitimate edge cases | Allowlist in `src/lib/subjects.ts` and its tests only |
| `coding` removal from grade_subject_map surprises users | Grandfather existing enrollment for 60 days; admin notification |
| `/api/concept-engine` auth fix breaks unauthenticated clients | Audit callers; gate behind feature flag `concept_engine_auth` for 1 release |

## 16. Review chain (P14)

architect → backend → frontend → assessment → ai-engineer → ops → mobile → testing → quality. Mandatory. Orchestrator validates at Gate 5.

## 17. Success criteria

- Every student-facing subject surface calls `useAllowedSubjects()`; zero raw imports of `GRADE_SUBJECTS`/`SUBJECT_META`.
- Every subject-writing endpoint validates via service; 422 with `allowed` on rejection.
- DB trigger rejects invalid enrollment insertions.
- Every legacy-invalid student either has valid enrollment or is blocked with a banner; no silent corruption.
- Admin can add/remove a subject from a plan without a code deploy.
- Regression tests cover: Class 6 free, Class 8 premium, Class 10 limited, Grade 11 sci/com/hum, legacy bad-data user.
- Type-check, lint, unit, integration, E2E, build all PASS.
- Quality review: APPROVE.

---

End of spec. Ready for writing-plans to produce the step-by-step implementation plan.
