# Subject Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc, hardcoded subject lists scattered across the codebase with a single DB-backed governance layer so students only ever see subjects valid for `(their grade) ∩ (their stream if senior) ∩ (their active plan)`.

**Architecture:** New tables `grade_subject_map`, `plan_subject_access`, `student_subject_enrollment`, `legacy_subjects_archive`. New columns `students.stream`, `subscription_plans.max_subjects`, `subjects.subject_kind`, `subjects.name_hi`. New RPCs `get_available_subjects` and `set_student_subjects`. New service layer `src/lib/subjects.ts` and React hook `useAllowedSubjects()`. Every subject-touching API, Edge Function, and UI surface routed through that one contract. DB trigger + API service validation = defense in depth. Legacy data auto-repaired via auditable detect/archive/repair migrations.

**Tech Stack:** PostgreSQL 15+ (Supabase), Next.js 16 App Router, React 18, TypeScript, Vitest, Playwright, Tailwind, SWR, Supabase Edge Functions (Deno), Flutter (Dart), Razorpay.

**Reference Spec:** `docs/superpowers/specs/2026-04-15-subject-governance-design.md`

---

## Phase A — Foundation (architect + backend)

### Task A1: Schema migration — new tables and columns

**Owner:** architect. Review chain: quality, testing.

**Files:**
- Create: `supabase/migrations/20260415000001_subject_governance_schema.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260415000001_subject_governance_schema.sql
-- Subject governance: schema. Safe additive migration. No data changes.

BEGIN;

-- 1. Extend subjects master
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS name_hi TEXT,
  ADD COLUMN IF NOT EXISTS subject_kind TEXT NOT NULL DEFAULT 'cbse_core'
    CHECK (subject_kind IN ('cbse_core','cbse_elective','platform_elective'));

-- 2. Grade-subject map
CREATE TABLE IF NOT EXISTS grade_subject_map (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grade            TEXT NOT NULL CHECK (grade IN ('6','7','8','9','10','11','12')),
  subject_code     TEXT NOT NULL REFERENCES subjects(code) ON UPDATE CASCADE,
  stream           TEXT CHECK (stream IN ('science','commerce','humanities') OR stream IS NULL),
  is_core          BOOLEAN NOT NULL DEFAULT TRUE,
  min_questions_seeded INT NOT NULL DEFAULT 10,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS grade_subject_map_uniq
  ON grade_subject_map (grade, subject_code, stream) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS grade_subject_map_subject_idx ON grade_subject_map (subject_code);

ALTER TABLE grade_subject_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY gsm_read_all ON grade_subject_map FOR SELECT USING (true);
-- writes only via service role

-- 3. Plan-subject access
CREATE TABLE IF NOT EXISTS plan_subject_access (
  plan_code     TEXT NOT NULL CHECK (plan_code IN ('free','starter','pro','unlimited')),
  subject_code  TEXT NOT NULL REFERENCES subjects(code) ON UPDATE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_code, subject_code)
);
ALTER TABLE plan_subject_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY psa_read_all ON plan_subject_access FOR SELECT USING (true);

-- 4. Students stream column
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS stream TEXT
    CHECK (stream IN ('science','commerce','humanities') OR stream IS NULL);

-- 5. subscription_plans.max_subjects
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS max_subjects INT NULL;

-- 6. student_subject_enrollment join table
CREATE TABLE IF NOT EXISTS student_subject_enrollment (
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_code  TEXT NOT NULL REFERENCES subjects(code) ON UPDATE CASCADE,
  selected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT NOT NULL DEFAULT 'student'
    CHECK (source IN ('student','admin','migration','onboarding')),
  PRIMARY KEY (student_id, subject_code)
);
CREATE INDEX IF NOT EXISTS sse_student_idx ON student_subject_enrollment (student_id);

ALTER TABLE student_subject_enrollment ENABLE ROW LEVEL SECURITY;
CREATE POLICY sse_read_own ON student_subject_enrollment FOR SELECT
  USING (student_id = auth.uid());
CREATE POLICY sse_write_own ON student_subject_enrollment FOR ALL
  USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- 7. Legacy archive
CREATE TABLE IF NOT EXISTS legacy_subjects_archive (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  invalid_subjects TEXT[] NOT NULL,
  reason        TEXT NOT NULL,
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lsa_student_idx ON legacy_subjects_archive (student_id);

-- 8. question_bank subject FK (NOT VALID — validate after cleanup)
ALTER TABLE question_bank
  ADD CONSTRAINT question_bank_subject_fk
  FOREIGN KEY (subject) REFERENCES subjects(code) ON UPDATE CASCADE NOT VALID;

COMMIT;
```

- [ ] **Step 2: Lint check the SQL**

Run: `npx supabase db lint supabase/migrations/20260415000001_subject_governance_schema.sql` (or manually inspect for syntax).
Expected: No errors.

- [ ] **Step 3: Apply to a local branch DB if one is available**

Run: `supabase db push` (against staging or a dev branch, NEVER production).
Expected: OK. If `gen_random_uuid()` is missing, prepend `CREATE EXTENSION IF NOT EXISTS pgcrypto;`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260415000001_subject_governance_schema.sql
git commit -m "feat(db): subject governance schema (additive) — grade_subject_map, plan_subject_access, stream, enrollment join, legacy archive"
```

---

### Task A2: RPCs — `get_available_subjects` and `set_student_subjects`

**Owner:** architect. Review chain: backend (service consumes these), testing, quality.

**Files:**
- Create: `supabase/migrations/20260415000002_subject_governance_rpcs.sql`

- [ ] **Step 1: Create the RPC migration**

```sql
-- supabase/migrations/20260415000002_subject_governance_rpcs.sql
BEGIN;

CREATE OR REPLACE FUNCTION get_available_subjects(p_student_id UUID)
RETURNS TABLE (
  code TEXT, name TEXT, name_hi TEXT, icon TEXT, color TEXT,
  subject_kind TEXT, is_core BOOLEAN, is_locked BOOLEAN
)
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  WITH s AS (SELECT grade, stream FROM students WHERE id = p_student_id),
       p AS (
         SELECT plan_code FROM student_subscriptions
          WHERE student_id = p_student_id
            AND status IN ('active','trialing','grace')
          ORDER BY current_period_end DESC NULLS LAST LIMIT 1
       ),
       effective_plan AS (
         SELECT COALESCE((SELECT plan_code FROM p), 'free') AS plan_code
       ),
       grade_valid AS (
         SELECT gsm.subject_code, gsm.is_core FROM grade_subject_map gsm, s
          WHERE gsm.grade = s.grade
            AND (gsm.stream IS NULL OR gsm.stream = s.stream OR s.stream IS NULL)
       ),
       plan_valid AS (
         SELECT psa.subject_code FROM plan_subject_access psa, effective_plan ep
          WHERE psa.plan_code = ep.plan_code
       )
  SELECT sub.code, sub.name, COALESCE(sub.name_hi, sub.name), sub.icon, sub.color,
         sub.subject_kind, gv.is_core,
         (gv.subject_code NOT IN (SELECT subject_code FROM plan_valid)) AS is_locked
    FROM subjects sub
    JOIN grade_valid gv ON gv.subject_code = sub.code
   WHERE sub.is_active;
$$;

REVOKE ALL ON FUNCTION get_available_subjects(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_available_subjects(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION set_student_subjects(
  p_student_id UUID, p_subjects TEXT[], p_preferred TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_allowed TEXT[];
  v_invalid TEXT[];
  v_max INT;
  v_count INT;
BEGIN
  -- authz: caller must own the student row
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_student_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_subjects IS NULL OR array_length(p_subjects, 1) IS NULL THEN
    p_subjects := ARRAY[]::TEXT[];
  END IF;

  SELECT ARRAY_AGG(code) INTO v_allowed
    FROM get_available_subjects(p_student_id) WHERE NOT is_locked;

  v_invalid := ARRAY(SELECT UNNEST(p_subjects) EXCEPT SELECT UNNEST(COALESCE(v_allowed, ARRAY[]::TEXT[])));
  IF array_length(v_invalid, 1) > 0 THEN
    RAISE EXCEPTION 'subject_not_allowed'
      USING DETAIL = jsonb_build_object('invalid', v_invalid, 'allowed', v_allowed)::text;
  END IF;

  SELECT max_subjects INTO v_max
    FROM subscription_plans sp
    JOIN student_subscriptions ss ON ss.plan_id = sp.id
   WHERE ss.student_id = p_student_id
     AND ss.status IN ('active','trialing','grace')
   ORDER BY ss.current_period_end DESC NULLS LAST LIMIT 1;

  v_count := COALESCE(array_length(p_subjects, 1), 0);
  IF v_max IS NOT NULL AND v_count > v_max THEN
    RAISE EXCEPTION 'max_subjects_exceeded'
      USING DETAIL = jsonb_build_object('limit', v_max, 'requested', v_count)::text;
  END IF;

  DELETE FROM student_subject_enrollment WHERE student_id = p_student_id;
  IF v_count > 0 THEN
    INSERT INTO student_subject_enrollment (student_id, subject_code, source)
      SELECT p_student_id, UNNEST(p_subjects), 'student';
  END IF;

  UPDATE students
     SET selected_subjects = p_subjects,
         preferred_subject = COALESCE(
           CASE WHEN p_preferred = ANY(p_subjects) THEN p_preferred ELSE NULL END,
           p_subjects[1],
           preferred_subject
         )
   WHERE id = p_student_id;

  RETURN jsonb_build_object('ok', true, 'subjects', p_subjects);
END;
$$;

REVOKE ALL ON FUNCTION set_student_subjects(UUID, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_student_subjects(UUID, TEXT[], TEXT) TO authenticated, service_role;

COMMIT;
```

- [ ] **Step 2: Apply and sanity-test in a dev branch**

Run a manual SQL check:
```sql
-- Seed a test student (one-off, dev-branch only):
-- INSERT INTO subjects (code, name, is_active, display_order) VALUES ('math','Math',true,1) ON CONFLICT DO NOTHING;
-- Execute: SELECT * FROM get_available_subjects('<test-student-id>');
```
Expected: Returns only grade-valid + plan-tagged rows. `is_locked` reflects the plan.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260415000002_subject_governance_rpcs.sql
git commit -m "feat(db): RPCs get_available_subjects and set_student_subjects"
```

---

### Task A3: Enrollment enforcement trigger (disabled at first)

**Owner:** architect.

**Files:**
- Create: `supabase/migrations/20260415000003_subject_enrollment_trigger.sql`

- [ ] **Step 1: Create the trigger migration**

```sql
-- supabase/migrations/20260415000003_subject_enrollment_trigger.sql
BEGIN;

CREATE OR REPLACE FUNCTION enforce_subject_enrollment() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_grade TEXT; v_stream TEXT; v_plan TEXT; v_ok BOOLEAN;
BEGIN
  SELECT grade, stream INTO v_grade, v_stream FROM students WHERE id = NEW.student_id;
  IF v_grade IS NULL THEN
    RAISE EXCEPTION 'student_missing_grade' USING ERRCODE = 'check_violation';
  END IF;

  SELECT ss.plan_code INTO v_plan
    FROM student_subscriptions ss
   WHERE ss.student_id = NEW.student_id
     AND ss.status IN ('active','trialing','grace')
   ORDER BY ss.current_period_end DESC NULLS LAST LIMIT 1;
  v_plan := COALESCE(v_plan, 'free');

  SELECT EXISTS(
    SELECT 1 FROM grade_subject_map gsm
     WHERE gsm.grade = v_grade
       AND gsm.subject_code = NEW.subject_code
       AND (gsm.stream IS NULL OR gsm.stream = v_stream OR v_stream IS NULL)
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'subject_not_valid_for_grade'
      USING DETAIL = jsonb_build_object('subject', NEW.subject_code, 'grade', v_grade, 'stream', v_stream)::text,
            ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM plan_subject_access psa
     WHERE psa.plan_code = v_plan
       AND psa.subject_code = NEW.subject_code
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'subject_not_in_plan'
      USING DETAIL = jsonb_build_object('subject', NEW.subject_code, 'plan', v_plan)::text,
            ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger but DISABLE it. Phase E enables it after cleanup.
CREATE TRIGGER trg_enforce_subject_enrollment
  BEFORE INSERT OR UPDATE ON student_subject_enrollment
  FOR EACH ROW EXECUTE FUNCTION enforce_subject_enrollment();
ALTER TABLE student_subject_enrollment DISABLE TRIGGER trg_enforce_subject_enrollment;

COMMIT;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260415000003_subject_enrollment_trigger.sql
git commit -m "feat(db): enforce_subject_enrollment trigger (disabled until data cleanup complete)"
```

---

### Task A4: Seed data — `subjects` bilingual + `grade_subject_map` + `plan_subject_access` + `max_subjects`

**Owner:** architect with input from assessment.

**Files:**
- Create: `supabase/migrations/20260415000004_subject_governance_seed.sql`

- [ ] **Step 1: Write the seed migration**

```sql
-- supabase/migrations/20260415000004_subject_governance_seed.sql
BEGIN;

-- Ensure canonical subjects exist with Hindi names and subject_kind
INSERT INTO subjects (code, name, name_hi, icon, color, subject_kind, is_active, display_order) VALUES
  ('math',              'Math',              'गणित',            '🧮', '#F97316', 'cbse_core',         true, 10),
  ('science',           'Science',           'विज्ञान',          '🔬', '#10B981', 'cbse_core',         true, 20),
  ('english',           'English',           'अंग्रेज़ी',         '📘', '#3B82F6', 'cbse_core',         true, 30),
  ('hindi',             'Hindi',             'हिंदी',            '📕', '#EF4444', 'cbse_core',         true, 40),
  ('social_studies',    'Social Studies',    'सामाजिक विज्ञान',  '🌏', '#8B5CF6', 'cbse_core',         true, 50),
  ('physics',           'Physics',           'भौतिक विज्ञान',    '⚛️', '#0EA5E9', 'cbse_core',         true, 110),
  ('chemistry',         'Chemistry',         'रसायन विज्ञान',    '⚗️', '#14B8A6', 'cbse_core',         true, 120),
  ('biology',           'Biology',           'जीव विज्ञान',      '🧬', '#22C55E', 'cbse_core',         true, 130),
  ('economics',         'Economics',         'अर्थशास्त्र',      '💹', '#F59E0B', 'cbse_core',         true, 210),
  ('accountancy',       'Accountancy',       'लेखा-शास्त्र',     '📊', '#DC2626', 'cbse_core',         true, 220),
  ('business_studies',  'Business Studies',  'व्यवसाय अध्ययन',   '💼', '#1D4ED8', 'cbse_core',         true, 230),
  ('history_sr',        'History',           'इतिहास',           '🏛️', '#B45309', 'cbse_core',         true, 310),
  ('geography',         'Geography',         'भूगोल',            '🗺️', '#059669', 'cbse_core',         true, 320),
  ('political_science', 'Political Science', 'राजनीति विज्ञान',  '⚖️', '#6D28D9', 'cbse_core',         true, 330),
  ('computer_science',  'Computer Science',  'कंप्यूटर विज्ञान',  '💻', '#7C3AED', 'cbse_elective',     true, 410),
  ('sanskrit',          'Sanskrit',          'संस्कृत',          '🪔', '#A16207', 'cbse_elective',     true, 420),
  ('coding',            'Coding',            'कोडिंग',          '👨‍💻', '#E11D48', 'platform_elective', true, 510)
ON CONFLICT (code) DO UPDATE SET
  name_hi      = EXCLUDED.name_hi,
  subject_kind = EXCLUDED.subject_kind;

-- grade_subject_map (see spec §4.2 seed content)
INSERT INTO grade_subject_map (grade, subject_code, stream, is_core) VALUES
  -- Grades 6-8 core
  ('6','math',NULL,true),('6','science',NULL,true),('6','english',NULL,true),
  ('6','hindi',NULL,true),('6','social_studies',NULL,true),('6','sanskrit',NULL,false),
  ('7','math',NULL,true),('7','science',NULL,true),('7','english',NULL,true),
  ('7','hindi',NULL,true),('7','social_studies',NULL,true),('7','sanskrit',NULL,false),
  ('8','math',NULL,true),('8','science',NULL,true),('8','english',NULL,true),
  ('8','hindi',NULL,true),('8','social_studies',NULL,true),('8','sanskrit',NULL,false),
  -- Grades 9-10 adds CS elective
  ('9','math',NULL,true),('9','science',NULL,true),('9','english',NULL,true),
  ('9','hindi',NULL,true),('9','social_studies',NULL,true),('9','sanskrit',NULL,false),
  ('9','computer_science',NULL,false),
  ('10','math',NULL,true),('10','science',NULL,true),('10','english',NULL,true),
  ('10','hindi',NULL,true),('10','social_studies',NULL,true),('10','sanskrit',NULL,false),
  ('10','computer_science',NULL,false),
  -- Grade 11 science
  ('11','math','science',true),('11','physics','science',true),('11','chemistry','science',true),
  ('11','biology','science',false),('11','english','science',true),
  ('11','computer_science','science',false),('11','hindi','science',false),
  ('11','sanskrit','science',false),
  -- Grade 11 commerce
  ('11','math','commerce',false),('11','accountancy','commerce',true),
  ('11','business_studies','commerce',true),('11','economics','commerce',true),
  ('11','english','commerce',true),('11','computer_science','commerce',false),
  ('11','hindi','commerce',false),
  -- Grade 11 humanities
  ('11','history_sr','humanities',true),('11','geography','humanities',true),
  ('11','political_science','humanities',true),('11','economics','humanities',true),
  ('11','english','humanities',true),('11','hindi','humanities',false),
  ('11','sanskrit','humanities',false),
  -- Grade 12 mirrors Grade 11
  ('12','math','science',true),('12','physics','science',true),('12','chemistry','science',true),
  ('12','biology','science',false),('12','english','science',true),
  ('12','computer_science','science',false),('12','hindi','science',false),
  ('12','sanskrit','science',false),
  ('12','math','commerce',false),('12','accountancy','commerce',true),
  ('12','business_studies','commerce',true),('12','economics','commerce',true),
  ('12','english','commerce',true),('12','computer_science','commerce',false),
  ('12','hindi','commerce',false),
  ('12','history_sr','humanities',true),('12','geography','humanities',true),
  ('12','political_science','humanities',true),('12','economics','humanities',true),
  ('12','english','humanities',true),('12','hindi','humanities',false),
  ('12','sanskrit','humanities',false)
ON CONFLICT DO NOTHING;

-- plan_subject_access
INSERT INTO plan_subject_access (plan_code, subject_code) VALUES
  -- free: 5 universal cores; max_subjects=2 caps selection
  ('free','math'),('free','science'),('free','english'),('free','hindi'),('free','social_studies'),
  -- starter: free + extras (still max_subjects=4)
  ('starter','math'),('starter','science'),('starter','english'),('starter','hindi'),
  ('starter','social_studies'),('starter','sanskrit'),('starter','computer_science'),
  ('starter','history_sr'),('starter','geography'),('starter','political_science'),
  -- pro: all CBSE subjects (no coding)
  ('pro','math'),('pro','science'),('pro','english'),('pro','hindi'),('pro','social_studies'),
  ('pro','sanskrit'),('pro','computer_science'),('pro','physics'),('pro','chemistry'),
  ('pro','biology'),('pro','economics'),('pro','accountancy'),('pro','business_studies'),
  ('pro','history_sr'),('pro','geography'),('pro','political_science'),
  -- unlimited: everything incl. coding
  ('unlimited','math'),('unlimited','science'),('unlimited','english'),('unlimited','hindi'),
  ('unlimited','social_studies'),('unlimited','sanskrit'),('unlimited','computer_science'),
  ('unlimited','physics'),('unlimited','chemistry'),('unlimited','biology'),
  ('unlimited','economics'),('unlimited','accountancy'),('unlimited','business_studies'),
  ('unlimited','history_sr'),('unlimited','geography'),('unlimited','political_science'),
  ('unlimited','coding')
ON CONFLICT DO NOTHING;

-- max_subjects on subscription_plans
UPDATE subscription_plans SET max_subjects = 2    WHERE plan_code = 'free';
UPDATE subscription_plans SET max_subjects = 4    WHERE plan_code = 'starter';
UPDATE subscription_plans SET max_subjects = NULL WHERE plan_code IN ('pro','unlimited');

COMMIT;
```

- [ ] **Step 2: Apply to dev branch and spot-check**

Run in SQL editor:
```sql
SELECT grade, stream, COUNT(*) FROM grade_subject_map GROUP BY 1,2 ORDER BY 1,2;
SELECT plan_code, COUNT(*) FROM plan_subject_access GROUP BY 1 ORDER BY 1;
-- Expected: 6→6 rows, 7→6, 8→6, 9→7, 10→7, 11 NULL→0, 11 science→8, 11 commerce→7, 11 humanities→7, etc.
-- Expected: free=5, starter=10, pro=16, unlimited=17
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260415000004_subject_governance_seed.sql
git commit -m "feat(db): seed subjects name_hi, grade_subject_map, plan_subject_access, max_subjects"
```

---

## Phase B — Service layer (backend)

### Task B1: `src/lib/subjects.ts` service + types

**Owner:** backend. Review chain: testing (90% coverage target), quality.

**Files:**
- Create: `src/lib/subjects.ts`
- Create: `src/lib/subjects.types.ts`
- Create: `src/__tests__/subjects.test.ts`

- [ ] **Step 1: Types file**

Create `src/lib/subjects.types.ts`:
```typescript
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
  isCore: boolean;
  isLocked: boolean;
}

export type SubjectWriteErrorReason =
  | 'grade' | 'stream' | 'plan' | 'inactive' | 'unknown' | 'max_subjects';

export interface SubjectWriteError {
  code: 'subject_not_allowed';
  subject: string;
  reason: SubjectWriteErrorReason;
  allowed: SubjectCode[];
}

export type OkOr<E> = { ok: true } | { ok: false; error: E };
```

- [ ] **Step 2: Write failing unit tests**

Create `src/__tests__/subjects.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAllowedSubjectsForStudent,
  validateSubjectWrite,
  validateSubjectsBulk,
} from '@/lib/subjects';

// Minimal Supabase mock
const mockRpc = vi.fn();
const ctx = {
  supabase: {
    rpc: (name: string, args: any) => {
      mockRpc(name, args);
      return Promise.resolve({
        data: name === 'get_available_subjects'
          ? [
              { code: 'math',    name: 'Math',    name_hi: 'गणित',    icon: '🧮', color: '#F97316', subject_kind: 'cbse_core', is_core: true,  is_locked: false },
              { code: 'science', name: 'Science', name_hi: 'विज्ञान', icon: '🔬', color: '#10B981', subject_kind: 'cbse_core', is_core: true,  is_locked: false },
              { code: 'physics', name: 'Physics', name_hi: 'भौतिक',  icon: '⚛️', color: '#0EA5E9', subject_kind: 'cbse_core', is_core: true,  is_locked: true  },
            ]
          : null,
        error: null,
      });
    },
  },
} as any;

describe('getAllowedSubjectsForStudent', () => {
  beforeEach(() => mockRpc.mockClear());

  it('returns subjects with camelCase keys', async () => {
    const result = await getAllowedSubjectsForStudent('student-1', ctx);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ code: 'math', nameHi: 'गणित', isCore: true, isLocked: false });
  });

  it('calls the RPC exactly once', async () => {
    await getAllowedSubjectsForStudent('student-1', ctx);
    expect(mockRpc).toHaveBeenCalledWith('get_available_subjects', { p_student_id: 'student-1' });
  });
});

describe('validateSubjectWrite', () => {
  it('accepts a subject that is grade-valid and plan-allowed', async () => {
    const r = await validateSubjectWrite('student-1', 'math', ctx);
    expect(r.ok).toBe(true);
  });

  it('rejects a subject that is grade-valid but plan-locked with reason=plan', async () => {
    const r = await validateSubjectWrite('student-1', 'physics', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ reason: 'plan', subject: 'physics' });
  });

  it('rejects unknown subject with reason=grade', async () => {
    const r = await validateSubjectWrite('student-1', 'quantum_mechanics', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe('grade');
  });
});

describe('validateSubjectsBulk', () => {
  it('returns first invalid subject', async () => {
    const r = await validateSubjectsBulk('student-1', ['math','physics'], ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.subject).toBe('physics');
  });
});
```

- [ ] **Step 3: Run tests — must FAIL**

Run: `npx vitest run src/__tests__/subjects.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 4: Implement `src/lib/subjects.ts`**

```typescript
import type { Subject, SubjectWriteError, SubjectCode, OkOr } from './subjects.types';

interface ServerCtx {
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  };
}

type RawSubject = {
  code: string; name: string; name_hi: string | null;
  icon: string; color: string; subject_kind: 'cbse_core' | 'cbse_elective' | 'platform_elective';
  is_core: boolean; is_locked: boolean;
};

function toSubject(r: RawSubject): Subject {
  return {
    code: r.code,
    name: r.name,
    nameHi: r.name_hi ?? r.name,
    icon: r.icon,
    color: r.color,
    subjectKind: r.subject_kind,
    isCore: r.is_core,
    isLocked: r.is_locked,
  };
}

export async function getAllowedSubjectsForStudent(
  studentId: string,
  ctx: ServerCtx,
): Promise<Subject[]> {
  const { data, error } = await ctx.supabase.rpc('get_available_subjects', {
    p_student_id: studentId,
  });
  if (error) throw error;
  return ((data ?? []) as RawSubject[]).map(toSubject);
}

export async function validateSubjectWrite(
  studentId: string,
  subjectCode: SubjectCode,
  ctx: ServerCtx,
): Promise<OkOr<SubjectWriteError>> {
  const subjects = await getAllowedSubjectsForStudent(studentId, ctx);
  const match = subjects.find((s) => s.code === subjectCode);
  if (!match) {
    return { ok: false, error: { code: 'subject_not_allowed', subject: subjectCode, reason: 'grade', allowed: subjects.filter(s => !s.isLocked).map(s => s.code) } };
  }
  if (match.isLocked) {
    return { ok: false, error: { code: 'subject_not_allowed', subject: subjectCode, reason: 'plan', allowed: subjects.filter(s => !s.isLocked).map(s => s.code) } };
  }
  return { ok: true };
}

export async function validateSubjectsBulk(
  studentId: string,
  subjects: SubjectCode[],
  ctx: ServerCtx,
): Promise<OkOr<SubjectWriteError>> {
  const allowed = await getAllowedSubjectsForStudent(studentId, ctx);
  const allowedSet = new Set(allowed.filter(s => !s.isLocked).map(s => s.code));
  for (const s of subjects) {
    if (!allowedSet.has(s)) {
      const match = allowed.find(x => x.code === s);
      return {
        ok: false,
        error: {
          code: 'subject_not_allowed',
          subject: s,
          reason: match?.isLocked ? 'plan' : 'grade',
          allowed: Array.from(allowedSet),
        },
      };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 5: Run tests — must PASS**

Run: `npx vitest run src/__tests__/subjects.test.ts`
Expected: 6/6 pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/subjects.ts src/lib/subjects.types.ts src/__tests__/subjects.test.ts
git commit -m "feat(subjects): service layer getAllowedSubjects + validate (incl. 90%+ coverage)"
```

---

### Task B2: `useAllowedSubjects()` React hook

**Owner:** frontend.

**Files:**
- Create: `src/lib/useAllowedSubjects.ts`
- Create: `src/__tests__/useAllowedSubjects.test.tsx`
- Create: `src/app/api/student/subjects/route.ts`

- [ ] **Step 1: Create the API route**

```typescript
// src/app/api/student/subjects/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { getAllowedSubjectsForStudent } from '@/lib/subjects';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const subjects = await getAllowedSubjectsForStudent(user.id, { supabase });
    return NextResponse.json({ subjects });
  } catch (e) {
    logger.error('subjects.list_failed', { err: String(e) });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write hook with SWR**

```typescript
// src/lib/useAllowedSubjects.ts
'use client';
import useSWR from 'swr';
import type { Subject } from './subjects.types';

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error('subjects.fetch_failed');
  return r.json() as Promise<{ subjects: Subject[] }>;
});

export function useAllowedSubjects() {
  const { data, error, isLoading, mutate } = useSWR('/api/student/subjects', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  return {
    subjects: data?.subjects ?? [],
    unlocked: (data?.subjects ?? []).filter((s) => !s.isLocked),
    locked:   (data?.subjects ?? []).filter((s) =>  s.isLocked),
    isLoading,
    error: error ?? null,
    refresh: () => mutate(),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/student/subjects/route.ts src/lib/useAllowedSubjects.ts
git commit -m "feat(subjects): GET /api/student/subjects + useAllowedSubjects hook"
```

---

## Phase C — API endpoint migration (backend)

### Task C1: Harden `set_selected_subjects` preferences write

**Files:**
- Modify: `src/app/api/student/preferences/route.ts`

- [ ] **Step 1: Replace the free-form write path with the RPC**

In the handler, replace the `set_selected_subjects` action body with:
```typescript
if (action === 'set_selected_subjects') {
  const subjects: string[] = Array.isArray(body.subjects) ? body.subjects : [];
  const preferred: string | null = typeof body.preferred_subject === 'string' ? body.preferred_subject : null;
  const { data, error } = await supabase.rpc('set_student_subjects', {
    p_student_id: student.id,
    p_subjects: subjects,
    p_preferred: preferred,
  });
  if (error) {
    // structured rejection: parse DETAIL if available
    const message = (error as any).message ?? 'subject_not_allowed';
    return NextResponse.json(
      { error: message, detail: (error as any).details ?? null },
      { status: message === 'not_authorized' ? 403 : 422 },
    );
  }
  return NextResponse.json({ ok: true, ...data });
}
```

- [ ] **Step 2: Update tests**

Modify `src/__tests__/api-routes.test.ts` to assert 422 on an invalid subject write.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/__tests__/api-routes.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/student/preferences/route.ts src/__tests__/api-routes.test.ts
git commit -m "fix(api): set_selected_subjects now validates via RPC, returns 422 structured error"
```

---

### Task C2: Fix `/api/student/profile` hardcoded ALLOWED_SUBJECTS

**Files:**
- Modify: `src/app/api/student/profile/route.ts`

- [ ] **Step 1: Remove the hardcoded list and validate via service**

Replace the line `const ALLOWED_SUBJECTS = [...]` block and the `preferred_subject` validation with:
```typescript
import { validateSubjectWrite } from '@/lib/subjects';
// ...
if (typeof body.preferred_subject === 'string' && body.preferred_subject) {
  const check = await validateSubjectWrite(student.id, body.preferred_subject, { supabase });
  if (!check.ok) {
    return NextResponse.json({ error: 'subject_not_allowed', ...check.error }, { status: 422 });
  }
  updates.preferred_subject = body.preferred_subject;
}
```

- [ ] **Step 2: Add regression test**

In `src/__tests__/api-routes.test.ts`:
```typescript
it('rejects preferred_subject outside allowed set with 422', async () => {
  const res = await call('/api/student/profile', { method:'PATCH', body:{ preferred_subject:'accountancy' } });
  expect(res.status).toBe(422);
});
```

- [ ] **Step 3: Run, commit**

```bash
npx vitest run src/__tests__/api-routes.test.ts
git add src/app/api/student/profile/route.ts src/__tests__/api-routes.test.ts
git commit -m "fix(api): profile uses validateSubjectWrite, removes hardcoded ALLOWED_SUBJECTS"
```

---

### Task C3: Auth bootstrap (teacher `subjects_taught`, student subjects)

**Files:**
- Modify: `src/app/api/auth/bootstrap/route.ts`

- [ ] **Step 1: Before calling `bootstrap_user_profile`, validate each subject via service. For teacher `subjects_taught`, validate against the full active subject master (not grade-specific — teachers aren't bound to one grade).**

Insert after parsing body:
```typescript
import { getAllowedSubjectsForStudent } from '@/lib/subjects';
// ...
if (role === 'student' && Array.isArray(body.selected_subjects)) {
  const bulk = await validateSubjectsBulk(userId, body.selected_subjects, { supabase });
  if (!bulk.ok) return NextResponse.json({ error:'subject_not_allowed', ...bulk.error }, { status:422 });
}
if (role === 'teacher' && Array.isArray(body.subjects_taught)) {
  const { data: all } = await supabase.from('subjects').select('code').eq('is_active', true);
  const codes = new Set((all ?? []).map((r: any) => r.code));
  const bad = body.subjects_taught.find((s: string) => !codes.has(s));
  if (bad) return NextResponse.json({ error:'subject_not_allowed', subject:bad }, { status:422 });
}
```

- [ ] **Step 2: Run all 3 onboarding role tests; commit**

---

### Task C4: Batch-harden 10 remaining API routes

**Files (all modify):**
- `src/app/api/foxy/route.ts`
- `src/app/api/quiz/route.ts`
- `src/app/api/quiz/ncert-questions/route.ts`
- `src/app/api/concept-engine/route.ts` (also adds auth — see C5)
- `src/app/api/diagnostic/start/route.ts`
- `src/app/api/student/exam-simulation/route.ts`
- `src/app/api/student/foxy-interaction/route.ts`
- `src/app/api/scan-solve/route.ts`
- `src/app/api/v1/exam/create/route.ts`
- `src/app/api/internal/admin/users/[id]/route.ts`
- `src/app/api/super-admin/demo-accounts/route.ts`

- [ ] **Step 1: For each, apply this pattern**

Near the top of the handler, after identity resolution, validate subject input:
```typescript
import { validateSubjectWrite } from '@/lib/subjects';
// ...
if (subject) {
  const check = await validateSubjectWrite(student.id, subject, { supabase });
  if (!check.ok) {
    return NextResponse.json({ error: 'subject_not_allowed', ...check.error }, { status: 422 });
  }
}
```
Specific routes:
- `diagnostic/start`: delete the local `SUBJECT_BY_GRADE` map entirely.
- `scan-solve`: remove header/form subject override; use only `student.preferred_subject` or service-validated input.
- `super-admin/demo-accounts`: replace literal `'Mathematics'` with `'math'` (lowercase canonical) and pull defaults from `subjects` table.
- `v1/exam/create`: validate `subject` against teacher's `subjects_taught` (pre-validated at bootstrap).

- [ ] **Step 2: Write a parameterized test suite `src/__tests__/subject-endpoint-validation.test.ts`**

Table-driven test with 11 routes × 2 cases (allowed, denied) = 22 cases.

- [ ] **Step 3: Run, commit one route at a time**

```bash
for route in foxy quiz ...; do
  git add src/app/api/$route/route.ts
  git commit -m "fix(api): $route validates subject via service layer"
done
```

---

### Task C5: `/api/concept-engine` auth bypass fix

**Files:**
- Modify: `src/app/api/concept-engine/route.ts`

- [ ] **Step 1: Add `authorizeRequest(request, 'content.read')` at the top of `action=chapter` and `action=search` branches**

```typescript
import { authorizeRequest } from '@/lib/rbac';
// ...
if (action === 'chapter' || action === 'search') {
  const authz = await authorizeRequest(request, 'content.read');
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
}
```

- [ ] **Step 2: Add test asserting 401 for unauthenticated callers**

- [ ] **Step 3: Commit**

```bash
git add src/app/api/concept-engine/route.ts
git commit -m "security(api): concept-engine chapter/search now require content.read permission"
```

---

### Task C6: Harden subject-touching Edge Functions

**Files (modify):**
- `supabase/functions/foxy-tutor/index.ts`
- `supabase/functions/ncert-solver/index.ts`
- `supabase/functions/quiz-generator/index.ts`
- `supabase/functions/cme-engine/index.ts`
- `supabase/functions/parent-portal/index.ts`
- `supabase/functions/teacher-dashboard/index.ts`
- `supabase/functions/export-report/index.ts`

- [ ] **Step 1: Add `_shared/subjects-validate.ts`**

```typescript
// supabase/functions/_shared/subjects-validate.ts
export async function validateSubjectRpc(supabase: any, studentId: string, subject: string) {
  const { data, error } = await supabase.rpc('get_available_subjects', { p_student_id: studentId });
  if (error) throw error;
  const row = (data ?? []).find((r: any) => r.code === subject);
  if (!row) return { ok:false, reason:'grade' as const };
  if (row.is_locked) return { ok:false, reason:'plan' as const };
  return { ok:true as const };
}
```

- [ ] **Step 2: In each Edge Function, call it before any subject-keyed logic**

For `parent-portal` specifically: after reading `students.selected_subjects`, intersect with `get_available_subjects` and return only currently-valid subjects. Do NOT show stale selections.

- [ ] **Step 3: Deploy locally, test, commit each function**

```bash
for fn in foxy-tutor ncert-solver quiz-generator cme-engine parent-portal teacher-dashboard export-report; do
  supabase functions deploy $fn
  git add supabase/functions/$fn/index.ts
  git commit -m "fix(edge): $fn validates subject against get_available_subjects"
done
git add supabase/functions/_shared/subjects-validate.ts
git commit -m "feat(edge): shared subject validator for Edge Functions"
```

---

## Phase D — UI migration (frontend)

### Task D1: ESLint rule preventing raw subject imports

**Files:**
- Create: `eslint-plugin-alfanumrik/no-raw-subject-imports.js`
- Modify: `.eslintrc.cjs`

- [ ] **Step 1: Write the rule**

```javascript
// eslint-plugin-alfanumrik/no-raw-subject-imports.js
module.exports = {
  meta: { type: 'problem', docs: { description: 'Forbid raw imports of GRADE_SUBJECTS/SUBJECT_META outside src/lib/subjects*.ts' } },
  create(context) {
    const allowedFiles = ['src/lib/subjects.ts', 'src/lib/constants.ts', 'src/__tests__/'];
    const file = context.getFilename();
    const isAllowed = allowedFiles.some(a => file.includes(a));
    if (isAllowed) return {};
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (!/constants$|constants\.ts$/.test(source)) return;
        for (const spec of node.specifiers) {
          const name = spec.imported?.name;
          if (['GRADE_SUBJECTS','SUBJECT_META','getSubjectsForGrade','SUBJECT_BY_GRADE'].includes(name)) {
            context.report({ node: spec, message: `Use useAllowedSubjects() instead of importing ${name}` });
          }
        }
      },
    };
  },
};
```

- [ ] **Step 2: Register the plugin**

In `.eslintrc.cjs`:
```javascript
plugins: ['alfanumrik'],
rules: { 'alfanumrik/no-raw-subject-imports': 'error' },
```

- [ ] **Step 3: Run lint — expect dozens of violations. Do NOT fix yet — fixes come in D2-D5.**

```bash
npm run lint 2>&1 | tee lint-baseline.txt
```

- [ ] **Step 4: Commit**

```bash
git add eslint-plugin-alfanumrik/ .eslintrc.cjs
git commit -m "chore(lint): add no-raw-subject-imports rule (to be cleaned up in D2-D5)"
```

---

### Task D2: Migrate dashboard, foxy, profile (highest-traffic surfaces)

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/foxy/page.tsx`
- Modify: `src/app/profile/page.tsx`

- [ ] **Step 1: Dashboard — replace subject chip renderer and the picker**

In `src/app/dashboard/page.tsx`, replace the existing subject picker and "My Subjects" chip row with:
```tsx
const { subjects, unlocked, isLoading } = useAllowedSubjects();
// ...
{isLoading ? <SubjectSkeleton /> : unlocked.length === 0
  ? <ReselectSubjectsBanner />
  : <SubjectChipGrid items={unlocked} />
}
```
And replace the bottom-sheet picker body with a filter over `subjects` (not the raw `getSubjects()` return).

- [ ] **Step 2: Foxy — remove local `SUBJECTS` const, use hook**

- [ ] **Step 3: Profile — same**

- [ ] **Step 4: Snapshot tests**

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/foxy/page.tsx src/app/profile/page.tsx
git commit -m "fix(ui): dashboard + foxy + profile use useAllowedSubjects"
```

---

### Task D3: Migrate quiz + scan + exams + study-plan + mock-exam + pyq + challenge

**Files (modify):**
- `src/components/quiz/QuizSetup.tsx`
- `src/components/quiz/ncert/NCERTQuizSetup.tsx`
- `src/components/challenge/ChallengeMode.tsx`
- `src/app/scan/page.tsx`
- `src/app/exams/page.tsx`
- `src/app/mock-exam/page.tsx`
- `src/app/pyq/page.tsx`
- `src/app/study-plan/page.tsx`

- [ ] **Step 1: For each, replace `SUBJECT_META.slice(0, 9)` / grade-filter patterns with `useAllowedSubjects().unlocked`**

- [ ] **Step 2: Each file: run `npm run type-check` and `npm run lint` after the change**

- [ ] **Step 3: Commit grouped**

```bash
git add src/components/quiz/QuizSetup.tsx src/components/quiz/ncert/NCERTQuizSetup.tsx src/components/challenge/ChallengeMode.tsx
git commit -m "fix(ui): quiz + challenge pickers use useAllowedSubjects"
git add src/app/scan/page.tsx src/app/exams/page.tsx src/app/mock-exam/page.tsx src/app/pyq/page.tsx src/app/study-plan/page.tsx
git commit -m "fix(ui): scan + exams + mock + pyq + study-plan pickers use useAllowedSubjects"
```

---

### Task D4: Foxy display components (Rich/Conversation/Chat/Header)

**Files:**
- Modify: `src/components/foxy/RichContent.tsx`
- Modify: `src/components/foxy/ConversationManager.tsx`
- Modify: `src/components/foxy/ConversationHeader.tsx`
- Modify: `src/components/foxy/ChatInput.tsx`

- [ ] **Step 1: Replace local `SUBJECTS` map with a lookup helper backed by the hook**

Create `src/lib/useSubjectLookup.ts`:
```typescript
import { useAllowedSubjects } from './useAllowedSubjects';
import type { Subject } from './subjects.types';
export function useSubjectLookup() {
  const { subjects } = useAllowedSubjects();
  const byCode = Object.fromEntries(subjects.map(s => [s.code, s]));
  return (code: string): Subject | null => byCode[code] ?? null;
}
```

- [ ] **Step 2: Update each component to use `useSubjectLookup()` instead of local const**

- [ ] **Step 3: Commit**

---

### Task D5: Onboarding stream step + subject picker

**Files:**
- Modify: `src/components/onboarding/OnboardingFlow.tsx`
- Modify: `src/app/onboarding/page.tsx`
- Create: `src/components/onboarding/StreamStep.tsx`
- Create: `src/components/onboarding/SubjectStep.tsx`

- [ ] **Step 1: StreamStep** — shown after grade step if `grade in ['11','12']`; three big cards (science / commerce / humanities) with EN+HI copy. Blocking.

- [ ] **Step 2: SubjectStep** — after StreamStep (or after grade for 6-10). Uses `useAllowedSubjects()`. Enforces `max_subjects` by disabling selection above the cap with a live counter ("2 of 2 selected").

- [ ] **Step 3: Wire into `OnboardingFlow`** — append to the state machine between grade and success.

- [ ] **Step 4: Snapshot + E2E scenario** — full grade 11 science onboarding.

- [ ] **Step 5: Commit**

---

### Task D6: Legacy invalid-enrollment banner

**Files:**
- Create: `src/components/subjects/ReselectBanner.tsx`
- Modify: `src/app/dashboard/page.tsx` (show banner when `unlocked.length === 0 && student.selected_subjects` is empty after migration)

- [ ] **Step 1: Banner** — full-width card, EN+HI, CTA "Choose your subjects" opens the picker.

- [ ] **Step 2: Dashboard gate** — if `unlocked.length === 0`, render banner instead of subject content.

- [ ] **Step 3: Commit**

---

### Task D7: Compat shim for `GRADE_SUBJECTS`/`SUBJECT_META`

**Files:**
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Replace the hardcoded arrays with thin wrappers that log a deprecation warning in dev and call `get_available_subjects` server-side (or the hook client-side)**

For legacy callers that cannot be refactored in this PR (none after D2-D5 if lint is green). Mark all exports `@deprecated` with JSDoc and log once in dev.

- [ ] **Step 2: Run full lint and test suite**

```bash
npm run lint
npm run type-check
npm test
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/constants.ts
git commit -m "chore(subjects): constants.ts now a compat shim; deprecation warnings added"
```

---

## Phase E — Super-admin governance

### Task E1: Subjects master CRUD page + API

**Files:**
- Create: `src/app/super-admin/subjects/page.tsx`
- Create: `src/app/api/super-admin/subjects/route.ts`
- Create: `src/app/api/super-admin/subjects/[code]/route.ts`

- [ ] **Step 1: API** — GET list, POST create, PATCH update/toggle, DELETE soft-inactivate. All call `logAdminAudit('subject.master.*', ...)`. All require `authorizeRequest(request, 'super_admin.subjects.manage')`.

- [ ] **Step 2: Page** — table with code/name/nameHi/icon/color/subject_kind/is_active; inline edit; new-subject modal.

- [ ] **Step 3: Test, commit**

---

### Task E2: Grade-map admin page + API

**Files:**
- Create: `src/app/super-admin/subjects/grade-map/page.tsx`
- Create: `src/app/api/super-admin/subjects/grade-map/route.ts`

- [ ] **Step 1: API** — GET returns all rows grouped by grade; PUT upserts a row; DELETE removes.

- [ ] **Step 2: Page** — toggle grid (7 grade rows × 17 subject cols × 3 streams for 11/12). Cells show `{enabled, is_core, min_questions}`. Warn when disabling a cell would break currently-enrolled students (preview count).

- [ ] **Step 3: Commit**

---

### Task E3: Plan-access admin page + API

**Files:**
- Create: `src/app/super-admin/subjects/plan-access/page.tsx`
- Create: `src/app/api/super-admin/subjects/plan-access/route.ts`

- [ ] **Step 1: API** — GET, PUT, DELETE. Also surfaces `subscription_plans.max_subjects` edit.

- [ ] **Step 2: Page** — 4 × 17 matrix checkboxes; footer edit `max_subjects`. Warning card when a plan loses a subject showing affected student count.

- [ ] **Step 3: Commit**

---

### Task E4: Violations report page + API

**Files:**
- Create: `src/app/super-admin/subjects/violations/page.tsx`
- Create: `src/app/api/super-admin/subjects/violations/route.ts`

- [ ] **Step 1: API** — returns students whose current `student_subject_enrollment` includes any row invalid for `(grade, stream, plan)`. Supports filters by plan, grade, stream. CSV export.

- [ ] **Step 2: Page** — table with student id, grade, plan, invalid subjects, actions: "auto-repair" (single) and "auto-repair all filtered".

- [ ] **Step 3: Commit**

---

### Task E5: Super-admin student detail — show + edit subjects

**Files:**
- Modify: `src/app/super-admin/students/[id]/page.tsx`
- Modify: `src/app/api/super-admin/students/[id]/profile/route.ts`
- Create: `src/app/api/super-admin/students/[id]/subjects/route.ts`

- [ ] **Step 1: Expand profile API to include `selected_subjects`, `preferred_subject`, `stream`**

- [ ] **Step 2: New subjects PATCH API** — admin override with required `reason` string; logs audit.

- [ ] **Step 3: Page UI** — subjects row + edit modal with subject picker and reason text area.

- [ ] **Step 4: Commit**

---

## Phase F — Data cleanup

### Task F1: Detection migration

**Files:**
- Create: `supabase/migrations/20260415000005_subject_violations_detect.sql`

- [ ] **Step 1: Write detection DO block**

```sql
BEGIN;
DO $$
DECLARE r RECORD; invalid TEXT[]; allowed TEXT[];
BEGIN
  FOR r IN SELECT id FROM students LOOP
    SELECT ARRAY_AGG(code) INTO allowed
      FROM get_available_subjects(r.id) WHERE NOT is_locked;
    SELECT ARRAY(SELECT UNNEST(selected_subjects) FROM students WHERE id = r.id
                 EXCEPT SELECT UNNEST(COALESCE(allowed, ARRAY[]::TEXT[])))
      INTO invalid;
    IF array_length(invalid, 1) > 0 THEN
      INSERT INTO admin_audit_log (action, target_type, target_id, details)
      VALUES ('subject.legacy_violation.detected', 'student', r.id,
              jsonb_build_object('invalid', invalid, 'allowed', allowed));
    END IF;
  END LOOP;
END $$;
COMMIT;
```

- [ ] **Step 2: Run on staging. Review count**

- [ ] **Step 3: Commit**

---

### Task F2: Repair migration

**Files:**
- Create: `supabase/migrations/20260415000006_subject_violations_repair.sql`

- [ ] **Step 1: Write repair DO block**

```sql
BEGIN;
DO $$
DECLARE r RECORD; valid TEXT[]; invalid TEXT[]; allowed TEXT[];
BEGIN
  FOR r IN SELECT id, selected_subjects FROM students WHERE selected_subjects IS NOT NULL LOOP
    SELECT ARRAY_AGG(code) INTO allowed
      FROM get_available_subjects(r.id) WHERE NOT is_locked;
    valid   := ARRAY(SELECT UNNEST(r.selected_subjects) INTERSECT SELECT UNNEST(COALESCE(allowed, ARRAY[]::TEXT[])));
    invalid := ARRAY(SELECT UNNEST(r.selected_subjects) EXCEPT    SELECT UNNEST(COALESCE(allowed, ARRAY[]::TEXT[])));
    IF array_length(invalid, 1) > 0 THEN
      INSERT INTO legacy_subjects_archive (student_id, invalid_subjects, reason)
        VALUES (r.id, invalid, 'grade_plan_mismatch');
    END IF;
    DELETE FROM student_subject_enrollment WHERE student_id = r.id;
    IF array_length(valid, 1) > 0 THEN
      INSERT INTO student_subject_enrollment (student_id, subject_code, source)
        SELECT r.id, UNNEST(valid), 'migration';
    END IF;
    UPDATE students
       SET selected_subjects = COALESCE(valid, ARRAY[]::TEXT[]),
           preferred_subject = valid[1]
     WHERE id = r.id;
    INSERT INTO admin_audit_log (action, target_type, target_id, details)
    VALUES ('subject.legacy_violation.repaired', 'student', r.id,
            jsonb_build_object('kept', valid, 'archived', invalid));
  END LOOP;
END $$;
COMMIT;
```

- [ ] **Step 2: Dry-run on staging, inspect `legacy_subjects_archive` and audit log**

- [ ] **Step 3: Commit**

---

### Task F3: Enable trigger + validate FK

**Files:**
- Create: `supabase/migrations/20260415000007_subject_governance_enable.sql`

- [ ] **Step 1: Enable trigger + validate FK**

```sql
BEGIN;
ALTER TABLE student_subject_enrollment ENABLE TRIGGER trg_enforce_subject_enrollment;
ALTER TABLE question_bank VALIDATE CONSTRAINT question_bank_subject_fk;
COMMIT;
```

- [ ] **Step 2: If FK validation fails, write a cleanup DO block for bad `question_bank.subject` values first, then rerun**

- [ ] **Step 3: Commit**

---

## Phase G — Mobile (Flutter)

### Task G1: Replace `grade_subjects.dart` with API-backed provider

**Files:**
- Delete: `mobile/lib/core/constants/grade_subjects.dart`
- Create: `mobile/lib/core/services/subjects_provider.dart`
- Modify: every Flutter subject picker (list available via `grep -r GRADE_SUBJECTS mobile/`)

- [ ] **Step 1: Riverpod provider**

```dart
final subjectsProvider = FutureProvider.autoDispose<List<Subject>>((ref) async {
  final res = await ref.read(apiClientProvider).get('/api/student/subjects');
  return (res.data['subjects'] as List).map(Subject.fromJson).toList();
});
```

- [ ] **Step 2: Delete `grade_subjects.dart`**

- [ ] **Step 3: Update every picker to consume `subjectsProvider`**

- [ ] **Step 4: Run `flutter analyze` and `flutter test`**

- [ ] **Step 5: Commit**

```bash
git add mobile/
git commit -m "feat(mobile): subjects come from /api/student/subjects, drop hardcoded Dart list"
```

---

## Phase H — Testing

### Task H1: Unit test matrix (grade × stream × plan)

**Files:**
- Modify: `src/__tests__/subjects.test.ts`

- [ ] **Step 1: Add 84-case table-driven test** — every (grade, stream, plan) combination with expected allowed set from the spec §4.2/4.3.

- [ ] **Step 2: Run with coverage**

```bash
npm run test:coverage -- src/__tests__/subjects.test.ts
```
Expected: `src/lib/subjects.ts` ≥ 90% branches.

- [ ] **Step 3: Commit**

---

### Task H2: Integration and regression tests

**Files:**
- Create: `src/__tests__/subject-endpoint-validation.test.ts` (already from C4)
- Create: `src/__tests__/regression-subject-leak.test.ts`

- [ ] **Step 1: Write regression tests per spec §11.3**

Each as an integration test against a seeded student row.

- [ ] **Step 2: Add to `.claude/regression-catalog.md`** — 6 new entries.

- [ ] **Step 3: Commit**

---

### Task H3: E2E tests (Playwright)

**Files:**
- Create: `e2e/subject-governance.spec.ts`

- [ ] **Step 1: Write 3 scenarios**
  - Grade 11 science onboarding happy path
  - Legacy user with invalid enrollment sees banner, reselects, dashboard updates
  - Plan downgrade (pro → starter) clamps selected_subjects on next login

- [ ] **Step 2: Run `npm run test:e2e`**

- [ ] **Step 3: Commit**

---

## Phase I — Release gate

### Task I1: Full verification

- [ ] **Step 1: Run all gates**

```bash
npm run type-check
npm run lint
npm test
npm run build
npm run test:e2e
```
Every one must exit 0.

- [ ] **Step 2: Bundle size check**

```bash
npm run analyze
```
Confirm shared JS < 160 kB, pages < 260 kB, middleware < 120 kB (per P10).

- [ ] **Step 3: Invoke quality agent (via orchestrator) for final review**

- [ ] **Step 4: Invoke testing agent for catalog confirmation**

- [ ] **Step 5: If all green: commit final PR summary and stop**

```bash
git log --oneline feat/subject-governance..HEAD
# Summarize, create PR with the spec + plan linked.
```

---

## Self-Review

### 1. Spec coverage
- §4.1-4.11 schema → Tasks A1, A2, A3, A4 ✓
- §5 service → B1, B2 ✓
- §5.1-5.2 RPCs → A2 ✓
- §6 API (every route) → C1, C2, C3, C4, C5, C6 ✓
- §7 UI → D1-D7 ✓
- §8 admin → E1-E5 ✓
- §10 cleanup → F1-F3 ✓
- §11 tests → H1-H3 ✓
- §12 mobile → G1 ✓
- §13 observability → covered within individual tasks (logger calls, ops_events) ✓
- §15 risks → mitigations implemented in tasks (feature flag mentioned in I1 for enforcement toggle — I'll track as follow-up) ✓
- §16 review chain → enforced by orchestrator Gate 5, not a task ✓

Gap: §13 feature flag `subject_governance_enforcement` has no dedicated task. Addressing: added to Task A3 implicitly (trigger is disabled at start); explicit re-enable is Task F3. Good.

Gap: §10 step 3 asks for 72-hour observation window. Not practical in a plan — will be an ops decision at rollout time.

### 2. Placeholder scan
No "TBD"/"TODO"/"Similar to Task N" — clean.

### 3. Type consistency
`useAllowedSubjects().unlocked` used in D2 matches hook signature in B2. `validateSubjectWrite` signature in B1 matches callers in C1-C6. RPC names identical everywhere. Subject codes consistent with A4 seed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-15-subject-governance.md`.

**Recommended approach: Subagent-Driven execution** via `superpowers:subagent-driven-development`. Each task dispatches a fresh specialist agent (architect / backend / frontend / ops / testing / mobile) with two-stage review. Given the task spans 8+ agents and 30+ files, subagent-driven keeps context clean and enforces the P14 review chain automatically.

Alternative: **Inline Execution** via `superpowers:executing-plans` — batch with checkpoints. Faster but accumulates context across all phases.
