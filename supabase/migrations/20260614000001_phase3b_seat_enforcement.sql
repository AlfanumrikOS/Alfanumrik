-- Migration: 20260614000001_phase3b_seat_enforcement.sql
-- Purpose: Phase 3B (School Command Center) Wave B — seat-aware provisioning
--          ENFORCEMENT. Ships the CEO-approved HYBRID SEAT POLICY as
--          server-authoritative, race-safe, idempotent SQL primitives:
--            1. seat_grace_started_at column on school_subscriptions (grace state)
--            2. _school_active_student_ids(school)       → THE source-of-truth set
--            3. evaluate_seat_policy(school, add)        → READ-ONLY jsonb verdict
--            4. enroll_students_with_seat_check(...)     → ATOMIC class_students path
--            5. enroll_section_students_with_seat_check  → ATOMIC class_enrollments path
--            6. refresh_school_seat_usage(school)        → snapshot UPSERT + grace mgmt
--            7. covering indexes for the active-student count (BOTH roster tables)
--
-- ─── WAVE B STABILITY FIX (this revision) — HONEST, UNIFIED ACTIVE COUNT ──────
-- The original Wave B canonical count counted only class_students. But the
-- school-admin enroll PAGE's bulk import posts to /api/schools/enroll, which
-- writes the SIBLING roster table class_enrollments (route line ~214). Students
-- enrolled via that primary bulk path were therefore INVISIBLE to the seat
-- count, so the cap could silently never trigger on the main path. The CEO
-- demanded a STABLE + CLEAN model: the count MUST be honest. This revision
-- unifies "active students of a school" to a DISTINCT UNION of BOTH roster
-- tables (class_students OR class_enrollments), each scoped to the school's
-- active, non-deleted classes and to active students. A student present in both
-- tables counts ONCE (DISTINCT). This is a CONTAINED fix — the full
-- roster-table convergence (collapsing class_students + class_enrollments into
-- one table) remains a DOCUMENTED FOLLOW-UP (see report), out of scope here.
--
-- ─── PAYMENT-ADJACENT (P11) — atomicity / race-safety / idempotency are MANDATORY ──
-- Seat grants are monetisable: every active student on a school roster is a
-- billable seat. The enforcement RPC therefore mirrors the EXACT P11 locking
-- discipline used by the school billing path (atomic_school_plan_change,
-- 20260507000003) and the student payment path (activate_subscription /
-- atomic_subscription_activation): a per-school pg_advisory_xact_lock taken
-- BEFORE the policy is re-evaluated and BEFORE any insert, so concurrent
-- imports for the same school SERIALISE and can never both pass the check at
-- the same count. The lock key namespace is DISTINCT from the billing lock so
-- a seat reservation does NOT block a concurrent plan change (different rows).
--
-- ─── CEO-APPROVED HYBRID SEAT POLICY (implemented EXACTLY) ───────────────────
--   S            = school's contractual seats = active school_subscriptions.seats_purchased
--   GRACE_PCT    = 0.10  → grace_ceiling = floor(S * 1.10)
--   GRACE_WINDOW = 14 days, measured from the first moment active > S
--   active(N)    = projected active student count after the add (current + add)
--
--   1) N <= S                                            → ALLOW  within_plan
--   2) S < N <= grace_ceiling AND grace window OPEN      → ALLOW  grace_warn
--        (soft-warn: caller flags school admin + super-admin; grace_started_at
--         is set if null; grace_expires_at returned)
--   3) S < N <= grace_ceiling AND grace window EXPIRED   → BLOCK  grace_expired
--   4) N > grace_ceiling                                 → BLOCK  over_ceiling
--        (hard block regardless of window)
--
--   - When active students return to <= S, grace_started_at RESETS to null
--     (the grace clock restarts for any future overage).
--   - NEVER auto-deactivate students (no data loss). Blocking only prevents
--     NEW additions. Deactivating a student frees a seat.
--
-- ─── "ACTIVE STUDENTS OF A SCHOOL" — single canonical definition ─────────────
-- ONE source of truth, factored into the set-returning helper
-- _school_active_student_ids(p_school_id uuid) → SETOF uuid:
--
--     -- via class_students (the section-roster table)
--     SELECT DISTINCT cs.student_id
--     FROM class_students cs
--     JOIN classes  c  ON c.id = cs.class_id
--                     AND c.school_id = p_school_id
--                     AND c.is_active AND c.deleted_at IS NULL
--     JOIN students st ON st.id = cs.student_id AND st.is_active
--     WHERE cs.is_active
--     UNION                       -- set UNION ⇒ a student in BOTH counts ONCE
--     -- via class_enrollments (the bulk-import / enroll-PAGE table)
--     SELECT DISTINCT ce.student_id
--     FROM class_enrollments ce
--     JOIN classes  c  ON c.id = ce.class_id
--                     AND c.school_id = p_school_id
--                     AND c.is_active AND c.deleted_at IS NULL
--     JOIN students st ON st.id = ce.student_id AND st.is_active
--     WHERE ce.is_active
--
-- _count_active_school_students(uuid) is now just count(*) over that set. Every
-- consumer — the policy evaluator, BOTH enrollment guards, the snapshot refresh,
-- AND the Wave A read models (get_school_overview, get_classes_at_risk) — derives
-- "active students" from this ONE definition, so they CANNOT drift apart. Wave B
-- unifies the definition BECAUSE enforcement requires an honest count: a seat cap
-- that ignores half the rosters is not enforcement.
--
-- This is STILL the ROSTER definition (a student with no active roster row on
-- EITHER table consumes no seat), which is STRICTER than the older
-- `COUNT(students WHERE school_id=X AND is_active)` definition the existing API
-- routes use. Wave B standardises on the unified roster definition per the CEO
-- directive; backend wiring must converge on these RPCs (see report).
--
-- ─── GRACE STATE LIVES ON school_subscriptions ──────────────────────────────
-- A single nullable column seat_grace_started_at on the contractual-seats table
-- (school_subscriptions) — one grace clock per school subscription, co-located
-- with S (seats_purchased). No new table needed; RLS is unchanged (the table is
-- RLS-enabled-no-policy by design, service-role-only — migration 20260516030000;
-- all four functions below are SECURITY DEFINER and read it directly).
--
-- ─── SECURITY DEFINER + scope guard ─────────────────────────────────────────
-- evaluate_seat_policy is EXECUTE-able by `authenticated` (it powers the UI +
-- import preview) but opens with the SAME inline active-school_admin scope guard
-- used by every Wave A function (raises 42501 cross-tenant). The mutating RPCs
-- (enroll_students_with_seat_check, refresh_school_seat_usage) are service_role
-- ONLY — they run behind authorizeSchoolAdmin in the backend, which already
-- proved the caller's school membership, exactly like atomic_school_plan_change.
-- search_path is pinned `public, pg_temp` on every function (no mutable path).
--
-- ─── FEATURE-FLAG GATE (caller responsibility) ──────────────────────────────
-- ENFORCEMENT is applied by CALLERS ONLY when ff_school_provisioning is ON.
-- Flag OFF ⇒ today's no-enforcement behaviour, byte-identical (callers simply do
-- not invoke enroll_students_with_seat_check / evaluate_seat_policy). These SQL
-- objects existing is inert until wired. See report for backend wiring.
--
-- ─── IDEMPOTENT + SELF-CONTAINED ────────────────────────────────────────────
--   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE FUNCTION;
--     CREATE INDEX IF NOT EXISTS; DO-block-guarded GRANT/REVOKE. Safe to replay.
--   - References ONLY baseline tables (00000000000000_baseline_from_prod.sql)
--     plus the column this migration itself adds. No forward-refs to _legacy/.
--     Does NOT depend on enqueue_event (absent from baseline): auditing is the
--     caller's job (backend already does logSchoolAudit + PostHog).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Grace-state storage — one nullable column on the contractual-seats table.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.school_subscriptions
  ADD COLUMN IF NOT EXISTS seat_grace_started_at timestamptz;

COMMENT ON COLUMN public.school_subscriptions.seat_grace_started_at IS
  'Phase 3B Wave B hybrid seat policy: the first moment this school''s active '
  'student count exceeded seats_purchased (S). NULL = not in overage. The 14-day '
  'grace window is measured from this timestamp; resets to NULL when active '
  'students return to <= S. Managed by refresh_school_seat_usage / '
  'enroll_students_with_seat_check. RLS unchanged (service-role-only table).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Covering indexes (idempotent; only those the baseline lacks).
-- ─────────────────────────────────────────────────────────────────────────────
-- The unified active-roster count walks BOTH roster tables, each is_active JOIN
-- classes (active, not deleted) of the school JOIN students (is_active). Baseline
-- already has idx_classes_school (school_id), idx_class_students_class (class_id),
-- idx_class_students_student (student_id), school_subscriptions_school_idx
-- (school_id), and — for class_enrollments — idx_class_enrollments_class
-- ((class_id) WHERE is_active) and idx_class_enrollments_student ((student_id)
-- WHERE is_active). Wave A (20260614000000) added idx_classes_school_active
-- (school_id WHERE is_active). We add only the partial active-scoped
-- class_students index (class_enrollments already has the equivalent partial
-- indexes in the baseline, so nothing to add there) + the partial active-students
-- index.

-- class_students filtered by class + active (roster membership probe). The
-- class_enrollments equivalents (idx_class_enrollments_class /
-- idx_class_enrollments_student, both WHERE is_active) already exist in the
-- baseline (00000000000000_baseline_from_prod.sql), so they are NOT re-created.
CREATE INDEX IF NOT EXISTS idx_class_students_class_active
  ON public.class_students (class_id)
  WHERE is_active;

-- class_students by student + active (the per-student NOT EXISTS membership probe
-- in the enroll guard, and the union de-dup, both filter by student + is_active).
CREATE INDEX IF NOT EXISTS idx_class_students_student_active
  ON public.class_students (student_id)
  WHERE is_active;

-- students filtered by school + active (fast active-membership confirmation and
-- the older school_id-scoped count some callers still use during transition).
CREATE INDEX IF NOT EXISTS idx_students_school_active
  ON public.students (school_id)
  WHERE is_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3a. _school_active_student_ids — THE source of truth: the DISTINCT UNION of
--     active students across BOTH roster tables for a school. Every count, every
--     guard, every read model derives from THIS set so they cannot drift.
--     SECURITY DEFINER (reads concept-independent roster tables across a tenant),
--     NO scope guard here (internal helper; every caller below guards first or is
--     service-role-only). Pinned search_path. Set is EMPTY when no rosters.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._school_active_student_ids(p_school_id uuid)
RETURNS TABLE(student_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- via class_students (section-roster table)
  SELECT cs.student_id
  FROM public.class_students cs
  JOIN public.classes  c  ON c.id = cs.class_id
                          AND c.school_id = p_school_id
                          AND c.is_active
                          AND c.deleted_at IS NULL
  JOIN public.students st ON st.id = cs.student_id
                          AND st.is_active
  WHERE cs.is_active
  UNION                       -- set UNION ⇒ a student in BOTH tables counts ONCE
  -- via class_enrollments (bulk-import / enroll-PAGE table)
  SELECT ce.student_id
  FROM public.class_enrollments ce
  JOIN public.classes  c  ON c.id = ce.class_id
                          AND c.school_id = p_school_id
                          AND c.is_active
                          AND c.deleted_at IS NULL
  JOIN public.students st ON st.id = ce.student_id
                          AND st.is_active
  WHERE ce.is_active;
$$;

COMMENT ON FUNCTION public._school_active_student_ids(uuid) IS
  'Phase 3B Wave B SOURCE OF TRUTH: the DISTINCT set of student_ids that are '
  'active on a school''s active, non-deleted class rosters via EITHER '
  'class_students OR class_enrollments (SQL UNION ⇒ deduped; a student in both '
  'counts once), joined to active students. Wave B unifies the definition here '
  'because enforcement requires an honest count — /api/schools/enroll writes '
  'class_enrollments, /api/schools setup writes class_students, and the seat cap '
  'must see both. Every count / guard / read model below derives from THIS set so '
  'they cannot drift. NOT scope-guarded (internal; callers guard). SECURITY '
  'DEFINER + pinned search_path. Read-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. _count_active_school_students — the ONE canonical roster count, now just
--     count(*) over the unified source-of-truth set above.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._count_active_school_students(p_school_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int
  FROM public._school_active_student_ids(p_school_id);
$$;

COMMENT ON FUNCTION public._count_active_school_students(uuid) IS
  'Phase 3B Wave B internal helper: the single canonical "active students of a '
  'school" count = count(*) over _school_active_student_ids (DISTINCT UNION of '
  'class_students + class_enrollments active rosters JOIN active non-deleted '
  'classes JOIN active students). Equals get_school_overview.student_count (Wave A, '
  'now also unified). NOT scope-guarded (internal; callers guard). SECURITY '
  'DEFINER + pinned search_path. Read-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. _eval_seat_policy_unchecked — pure policy math, NO scope guard, NO mutation.
--    Shared by the public evaluator (which guards first) and the enrollment
--    guard (which holds the advisory lock first). Takes the grace timestamp as a
--    parameter so the caller controls whether it reads it locked or unlocked.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._eval_seat_policy_unchecked(
  p_seats_purchased  integer,
  p_current_active   integer,
  p_add_count        integer,
  p_grace_started_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  c_grace_pct      numeric  := 0.10;
  c_grace_days     integer  := 14;
  v_seats          integer  := COALESCE(p_seats_purchased, 0);
  v_current        integer  := GREATEST(COALESCE(p_current_active, 0), 0);
  v_add            integer  := GREATEST(COALESCE(p_add_count, 1), 1);
  v_projected      integer;
  v_ceiling        integer;
  v_grace_open     boolean;
  v_grace_expires  timestamptz;
  v_status         text;
  v_allowed        boolean;
BEGIN
  v_projected := v_current + v_add;
  v_ceiling   := floor(v_seats * (1 + c_grace_pct))::int;  -- grace_ceiling = floor(S*1.10)

  -- grace_expires_at is only meaningful once a grace clock has started.
  v_grace_expires := CASE
    WHEN p_grace_started_at IS NOT NULL
      THEN p_grace_started_at + make_interval(days => c_grace_days)
    ELSE NULL
  END;

  -- Grace window is OPEN when no clock has started yet (overage just beginning)
  -- OR now() is still before the 14-day expiry.
  v_grace_open := (p_grace_started_at IS NULL) OR (now() < v_grace_expires);

  IF v_projected <= v_seats THEN
    v_status  := 'within_plan';
    v_allowed := true;
  ELSIF v_projected <= v_ceiling AND v_grace_open THEN
    v_status  := 'grace_warn';
    v_allowed := true;
  ELSIF v_projected <= v_ceiling AND NOT v_grace_open THEN
    v_status  := 'grace_expired';
    v_allowed := false;
  ELSE
    v_status  := 'over_ceiling';   -- N > grace_ceiling: hard block, any window
    v_allowed := false;
  END IF;

  RETURN jsonb_build_object(
    'allowed',          v_allowed,
    'status',           v_status,
    'seats_purchased',  v_seats,
    'grace_ceiling',    v_ceiling,
    'current_active',   v_current,
    'projected',        v_projected,
    'grace_started_at', p_grace_started_at,
    'grace_expires_at', v_grace_expires
  );
END;
$$;

COMMENT ON FUNCTION public._eval_seat_policy_unchecked(integer, integer, integer, timestamptz) IS
  'Phase 3B Wave B internal helper: pure hybrid-seat-policy math (no table I/O, no '
  'mutation, no scope guard). grace_ceiling = floor(S*1.10); 14-day window from '
  'grace_started_at. Returns the verdict jsonb. STABLE (reads now() for the window '
  'check). Callers MUST supply the grace timestamp so the verdict is consistent '
  'with the locked read in the enrollment guard.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. evaluate_seat_policy — PUBLIC, READ-ONLY verdict for UI + import preview.
--    SECURITY DEFINER + active-school_admin scope guard. EXECUTE to authenticated.
--    Does NOT mutate (does NOT set grace_started_at — that is the enroll path's
--    job, atomically). Reads the live active count + S + grace clock unlocked.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evaluate_seat_policy(
  p_school_id  uuid,
  p_add_count  integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seats    integer;
  v_grace    timestamptz;
  v_current  integer;
BEGIN
  -- School-scope guard (mirrors Wave A): caller must be an ACTIVE admin of THIS school.
  IF NOT EXISTS (
    SELECT 1 FROM public.school_admins sa
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active
  ) THEN
    RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
  END IF;

  -- Read the school's active subscription row: S (seats_purchased) + grace clock.
  -- No unique constraint on school_id exists, so pick the active row
  -- deterministically (active first, then highest seats, then newest).
  SELECT ss.seats_purchased, ss.seat_grace_started_at
    INTO v_seats, v_grace
  FROM public.school_subscriptions ss
  WHERE ss.school_id = p_school_id
    AND ss.status IN ('active', 'trial')
  ORDER BY ss.seats_purchased DESC NULLS LAST, ss.created_at DESC NULLS LAST
  LIMIT 1;

  -- No active subscription row ⇒ treat as 0 seats (policy will warn/block per math).
  v_seats := COALESCE(v_seats, 0);

  v_current := public._count_active_school_students(p_school_id);

  RETURN public._eval_seat_policy_unchecked(v_seats, v_current, p_add_count, v_grace);
END;
$$;

COMMENT ON FUNCTION public.evaluate_seat_policy(uuid, integer) IS
  'Phase 3B Wave B PUBLIC read-only seat-policy evaluator for UI + import preview. '
  'Returns {allowed, status(within_plan|grace_warn|grace_expired|over_ceiling), '
  'seats_purchased, grace_ceiling, current_active, projected, grace_started_at, '
  'grace_expires_at}. SECURITY DEFINER + active-school_admin scope guard; EXECUTE '
  'to authenticated. DOES NOT MUTATE (never sets grace_started_at). active count = '
  'canonical roster definition (_count_active_school_students). Apply only when '
  'ff_school_provisioning is ON.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. refresh_school_seat_usage — recompute snapshot + manage the grace clock.
--    Idempotent (derived from live counts; safe to call repeatedly). Called by
--    the backend after every enroll / deactivate. service_role ONLY.
--    Grace clock: SET when entering overage (active > S and clock null); RESET to
--    NULL when active returns to <= S.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_school_seat_usage(p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active        integer;
  v_seats         integer;
  v_grace         timestamptz;
  v_sub_id        uuid;
  v_util          numeric;
  v_now           timestamptz := now();
  v_new_grace     timestamptz;
BEGIN
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'p_school_id is required' USING ERRCODE = '22023';
  END IF;

  -- Per-school advisory lock so a concurrent enroll guard and a refresh agree on
  -- the grace-clock transition. Same key namespace as the enroll guard below.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('school_seat:' || p_school_id::text, 0)
  );

  -- Active subscription row → its id + S + current grace clock (locked for update).
  -- school_subscriptions has NO unique on school_id, so pick the active row
  -- deterministically (active first, then highest seats, then newest) and pin the
  -- grace-clock write to THAT row's id — never a blanket multi-row update.
  SELECT ss.id, ss.seats_purchased, ss.seat_grace_started_at
    INTO v_sub_id, v_seats, v_grace
  FROM public.school_subscriptions ss
  WHERE ss.school_id = p_school_id
    AND ss.status IN ('active', 'trial')
  ORDER BY ss.seats_purchased DESC NULLS LAST, ss.created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  v_seats  := COALESCE(v_seats, 0);
  v_active := public._count_active_school_students(p_school_id);

  -- Grace-clock state machine:
  --   active > S and no clock  → start the clock now
  --   active <= S              → reset the clock to null
  --   active > S and clock set → leave the clock untouched (window keeps running)
  IF v_active > v_seats THEN
    v_new_grace := COALESCE(v_grace, v_now);
  ELSE
    v_new_grace := NULL;
  END IF;

  -- Only write the subscription row when the grace clock actually changes
  -- (keeps the call idempotent and avoids needless updated_at churn). Pinned to
  -- the single row id we read+locked above (v_sub_id is NULL iff no active row).
  IF v_sub_id IS NOT NULL AND v_new_grace IS DISTINCT FROM v_grace THEN
    UPDATE public.school_subscriptions
       SET seat_grace_started_at = v_new_grace,
           updated_at            = v_now
     WHERE id = v_sub_id;
  END IF;

  v_util := CASE
    WHEN v_seats > 0 THEN round((v_active::numeric / v_seats::numeric) * 100, 2)
    ELSE 0
  END;

  -- UPSERT the maintained daily snapshot (UNIQUE(school_id, snapshot_date)).
  INSERT INTO public.school_seat_usage
    (school_id, snapshot_date, active_students, seats_purchased, utilization_pct)
  VALUES
    (p_school_id, CURRENT_DATE, v_active, v_seats, v_util)
  ON CONFLICT (school_id, snapshot_date) DO UPDATE
    SET active_students = EXCLUDED.active_students,
        seats_purchased = EXCLUDED.seats_purchased,
        utilization_pct = EXCLUDED.utilization_pct;

  RETURN jsonb_build_object(
    'school_id',        p_school_id,
    'active_students',  v_active,
    'seats_purchased',  v_seats,
    'utilization_pct',  v_util,
    'grace_started_at', v_new_grace,
    'grace_expires_at', CASE WHEN v_new_grace IS NOT NULL
                             THEN v_new_grace + make_interval(days => 14)
                             ELSE NULL END,
    'snapshot_date',    CURRENT_DATE
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_school_seat_usage(uuid) IS
  'Phase 3B Wave B: recompute the canonical active-student count, UPSERT the '
  'school_seat_usage daily snapshot (active_students, seats_purchased, '
  'utilization_pct on UNIQUE(school_id, snapshot_date)), and manage the grace '
  'clock (set seat_grace_started_at when entering overage if null; reset to null '
  'when active <= S). Idempotent (derived from counts). Advisory-locked on '
  '''school_seat:''||school_id. service_role-only EXECUTE. Call after enroll/deactivate.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. enroll_students_with_seat_check — the ATOMIC, race-safe enforcement RPC.
--    ONE transaction: take the per-school advisory lock → re-evaluate the policy
--    UNDER the lock against the LIVE count → if allowed, insert the roster rows +
--    set the grace clock + refresh the snapshot; if blocked, RAISE a structured
--    exception (custom SQLSTATE 'P3B01') WITHOUT inserting anything.
--    service_role ONLY (runs behind authorizeSchoolAdmin in the backend).
--
--    Payload shape (jsonb array of objects):
--      [ { "student_id": "<uuid>", "class_id": "<uuid>" }, ... ]
--    Each entry adds the student to a class roster (class_students). class_id is
--    REQUIRED because the canonical active count is roster-based — a student with
--    no active class-roster row does not consume a seat, so a seat reservation
--    that did not place the student on a roster would be meaningless. The backend
--    creates/derives the student rows + classes first (auth user, students row,
--    class lookup) and passes the resolved (student_id, class_id) pairs here; this
--    RPC owns ONLY the seat-gated roster write so the check and the insert share
--    one transaction and one lock.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enroll_students_with_seat_check(
  p_school_id uuid,
  p_payload   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seats        integer;
  v_grace        timestamptz;
  v_current      integer;
  v_add          integer;
  v_verdict      jsonb;
  v_now          timestamptz := now();
  v_inserted     integer := 0;
  v_distinct_new integer;
  v_refresh      jsonb;
BEGIN
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'p_school_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'array' OR jsonb_array_length(p_payload) = 0 THEN
    RAISE EXCEPTION 'p_payload must be a non-empty jsonb array' USING ERRCODE = '22023';
  END IF;

  -- Validate every entry has the required uuids BEFORE touching any seats. A
  -- malformed payload must fail loudly, not silently under-count the add.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload) e
    WHERE (e->>'student_id') IS NULL
       OR (e->>'class_id')   IS NULL
  ) THEN
    RAISE EXCEPTION 'every payload entry needs student_id and class_id' USING ERRCODE = '22023';
  END IF;

  -- ── Stage the requested (student_id, class_id) pairs (de-duplicated). ──────
  CREATE TEMP TABLE _enroll_req ON COMMIT DROP AS
  SELECT DISTINCT
         (e->>'student_id')::uuid AS student_id,
         (e->>'class_id')::uuid   AS class_id
  FROM jsonb_array_elements(p_payload) e;

  -- Cross-tenant guard: every target class MUST belong to this school and be a
  -- live class. Reject the whole batch otherwise (no partial cross-tenant write).
  IF EXISTS (
    SELECT 1 FROM _enroll_req r
    LEFT JOIN public.classes c
      ON c.id = r.class_id
     AND c.school_id = p_school_id
     AND c.is_active
     AND c.deleted_at IS NULL
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'one or more class_id values do not belong to school % (or are inactive/deleted)', p_school_id
      USING ERRCODE = '42501';
  END IF;

  -- ── 1. SERIALISE: take the per-school advisory lock BEFORE re-evaluating. ──
  -- This is the race-safety pivot. Two concurrent imports for the same school
  -- block here; the second only proceeds after the first commits, so it
  -- re-reads the post-insert active count and cannot double-allocate seats.
  -- Distinct namespace from the billing lock ('school_subscription:').
  PERFORM pg_advisory_xact_lock(
    hashtextextended('school_seat:' || p_school_id::text, 0)
  );

  -- ── 2. Read S + grace clock UNDER the lock (FOR UPDATE pins the row). ──────
  SELECT ss.seats_purchased, ss.seat_grace_started_at
    INTO v_seats, v_grace
  FROM public.school_subscriptions ss
  WHERE ss.school_id = p_school_id
    AND ss.status IN ('active', 'trial')
  ORDER BY ss.seats_purchased DESC NULLS LAST, ss.created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  v_seats := COALESCE(v_seats, 0);

  -- ── 3. Current canonical active count, UNDER the lock. ─────────────────────
  v_current := public._count_active_school_students(p_school_id);

  -- The TRUE seat delta is the number of requested students NOT already counted
  -- as active on a roster (a student already active on EITHER roster table
  -- consumes no new seat). Count distinct requested students who are not in the
  -- unified active set for this school — uses the SAME source of truth as the
  -- count so the delta and the count can never disagree.
  SELECT count(DISTINCT r.student_id)::int
    INTO v_distinct_new
  FROM _enroll_req r
  WHERE r.student_id NOT IN (
    SELECT s.student_id FROM public._school_active_student_ids(p_school_id) s
  );

  v_add := GREATEST(v_distinct_new, 0);

  -- ── 4. Re-evaluate the policy UNDER the lock against the live count. ───────
  v_verdict := public._eval_seat_policy_unchecked(v_seats, v_current, GREATEST(v_add, 1), v_grace);

  -- ── 5. BLOCK path: raise a structured exception WITHOUT inserting. ─────────
  -- A no-op add (v_add = 0: all requested students already on active rosters) is
  -- always allowed regardless of verdict — it consumes no new seats.
  IF v_add > 0 AND NOT (v_verdict->>'allowed')::boolean THEN
    RAISE EXCEPTION 'seat_policy_block: %', v_verdict->>'status'
      USING ERRCODE = 'P3B01',
            DETAIL  = v_verdict::text,
            HINT    = 'Deactivate a student to free a seat, or upgrade the subscription.';
  END IF;

  -- ── 6. ALLOW path: UPSERT the roster rows. class_students has
  -- UNIQUE(class_id, student_id) (class_students_class_id_student_id_key in the
  -- baseline), so ON CONFLICT makes the insert idempotent on replay/retry AND
  -- atomically reactivates a previously soft-removed roster row (re-adding a
  -- removed student deterministically restores the seat). v_inserted counts the
  -- rows touched (new + reactivated); the caller treats it as "enrolled".
  INSERT INTO public.class_students (class_id, student_id, is_active)
  SELECT r.class_id, r.student_id, true
  FROM _enroll_req r
  ON CONFLICT (class_id, student_id) DO UPDATE
    SET is_active  = true,
        updated_at = v_now
    WHERE public.class_students.is_active IS DISTINCT FROM true;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- ── 7. Manage grace clock + refresh the snapshot, still inside this txn. ───
  -- refresh_school_seat_usage re-derives the post-insert active count and
  -- sets/resets the grace clock. It re-takes the same advisory lock (no-op:
  -- already held in this txn) and recomputes idempotently.
  v_refresh := public.refresh_school_seat_usage(p_school_id);

  RETURN jsonb_build_object(
    'success',   true,
    'enrolled',  v_inserted,
    'requested', (SELECT count(*) FROM _enroll_req),
    'verdict',   v_verdict,
    'usage',     v_refresh
  );
END;
$$;

COMMENT ON FUNCTION public.enroll_students_with_seat_check(uuid, jsonb) IS
  'Phase 3B Wave B ATOMIC seat-enforced enrollment. One transaction: '
  'pg_advisory_xact_lock(''school_seat:''||school_id) → re-evaluate hybrid policy '
  'under the lock against the live canonical roster count → if allowed insert '
  'class_students roster rows (idempotent) + manage grace clock + refresh snapshot; '
  'if blocked RAISE SQLSTATE P3B01 (DETAIL = verdict jsonb) WITHOUT inserting. '
  'Payload = jsonb array of {student_id, class_id}; class_id must belong to the '
  'school. service_role-only EXECUTE. Caller resolves auth/student/class rows '
  'first. Apply only when ff_school_provisioning is ON.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7b. enroll_section_students_with_seat_check — the SIBLING atomic enforcement
--     RPC for the class_enrollments path (the /api/schools/enroll bulk-import
--     PAGE writes class_enrollments, not class_students). IDENTICAL discipline to
--     enroll_students_with_seat_check: ONE transaction, the SAME per-school
--     advisory lock (same 'school_seat:' namespace, so the two paths SERIALISE
--     against each other and can never both pass the check at the same count),
--     re-evaluate the unified policy under the lock, insert/UPSERT, refresh. Same
--     P3B01 block contract. The only difference is the target roster table.
--
--     class_enrollments has UNIQUE(class_id, student_id)
--     (class_enrollments_class_id_student_id_key, baseline line ~15084), so
--     ON CONFLICT (class_id, student_id) is a real, safe UPSERT target. Its
--     columns are (id, class_id, student_id, enrolled_at, is_active, updated_at) —
--     no roll_number / joined_at (those are class_students-only); the insert sets
--     only class_id, student_id, is_active (enrolled_at/updated_at default now()).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enroll_section_students_with_seat_check(
  p_school_id uuid,
  p_payload   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seats        integer;
  v_grace        timestamptz;
  v_current      integer;
  v_add          integer;
  v_verdict      jsonb;
  v_now          timestamptz := now();
  v_inserted     integer := 0;
  v_distinct_new integer;
  v_refresh      jsonb;
BEGIN
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'p_school_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'array' OR jsonb_array_length(p_payload) = 0 THEN
    RAISE EXCEPTION 'p_payload must be a non-empty jsonb array' USING ERRCODE = '22023';
  END IF;

  -- Validate every entry has the required uuids BEFORE touching any seats.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload) e
    WHERE (e->>'student_id') IS NULL
       OR (e->>'class_id')   IS NULL
  ) THEN
    RAISE EXCEPTION 'every payload entry needs student_id and class_id' USING ERRCODE = '22023';
  END IF;

  -- ── Stage the requested (student_id, class_id) pairs (de-duplicated). ──────
  CREATE TEMP TABLE _enroll_sec_req ON COMMIT DROP AS
  SELECT DISTINCT
         (e->>'student_id')::uuid AS student_id,
         (e->>'class_id')::uuid   AS class_id
  FROM jsonb_array_elements(p_payload) e;

  -- Cross-tenant guard: every target class MUST belong to this school + be live.
  IF EXISTS (
    SELECT 1 FROM _enroll_sec_req r
    LEFT JOIN public.classes c
      ON c.id = r.class_id
     AND c.school_id = p_school_id
     AND c.is_active
     AND c.deleted_at IS NULL
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'one or more class_id values do not belong to school % (or are inactive/deleted)', p_school_id
      USING ERRCODE = '42501';
  END IF;

  -- ── 1. SERIALISE: take the SAME per-school advisory lock as the class_students
  -- path. Same key namespace ⇒ a concurrent class_students import and a
  -- class_enrollments import for the SAME school block each other and re-read the
  -- post-commit unified count, so neither path can double-allocate seats.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('school_seat:' || p_school_id::text, 0)
  );

  -- ── 2. Read S + grace clock UNDER the lock (FOR UPDATE pins the row). ──────
  SELECT ss.seats_purchased, ss.seat_grace_started_at
    INTO v_seats, v_grace
  FROM public.school_subscriptions ss
  WHERE ss.school_id = p_school_id
    AND ss.status IN ('active', 'trial')
  ORDER BY ss.seats_purchased DESC NULLS LAST, ss.created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  v_seats := COALESCE(v_seats, 0);

  -- ── 3. Current unified active count, UNDER the lock (both roster tables). ──
  v_current := public._count_active_school_students(p_school_id);

  -- True seat delta: requested students not already in the unified active set.
  SELECT count(DISTINCT r.student_id)::int
    INTO v_distinct_new
  FROM _enroll_sec_req r
  WHERE r.student_id NOT IN (
    SELECT s.student_id FROM public._school_active_student_ids(p_school_id) s
  );

  v_add := GREATEST(v_distinct_new, 0);

  -- ── 4. Re-evaluate the policy UNDER the lock against the live count. ───────
  v_verdict := public._eval_seat_policy_unchecked(v_seats, v_current, GREATEST(v_add, 1), v_grace);

  -- ── 5. BLOCK path: same P3B01 contract; no-op add (v_add=0) always allowed. ─
  IF v_add > 0 AND NOT (v_verdict->>'allowed')::boolean THEN
    RAISE EXCEPTION 'seat_policy_block: %', v_verdict->>'status'
      USING ERRCODE = 'P3B01',
            DETAIL  = v_verdict::text,
            HINT    = 'Deactivate a student to free a seat, or upgrade the subscription.';
  END IF;

  -- ── 6. ALLOW path: UPSERT class_enrollments. UNIQUE(class_id, student_id)
  -- (class_enrollments_class_id_student_id_key) ⇒ ON CONFLICT is idempotent on
  -- replay/retry AND reactivates a previously soft-removed enrollment row. Only
  -- class_id/student_id/is_active are set; enrolled_at + updated_at default now().
  INSERT INTO public.class_enrollments (class_id, student_id, is_active)
  SELECT r.class_id, r.student_id, true
  FROM _enroll_sec_req r
  ON CONFLICT (class_id, student_id) DO UPDATE
    SET is_active  = true,
        updated_at = v_now
    WHERE public.class_enrollments.is_active IS DISTINCT FROM true;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- ── 7. Manage grace clock + refresh snapshot inside this txn (same lock). ──
  v_refresh := public.refresh_school_seat_usage(p_school_id);

  RETURN jsonb_build_object(
    'success',   true,
    'enrolled',  v_inserted,
    'requested', (SELECT count(*) FROM _enroll_sec_req),
    'verdict',   v_verdict,
    'usage',     v_refresh
  );
END;
$$;

COMMENT ON FUNCTION public.enroll_section_students_with_seat_check(uuid, jsonb) IS
  'Phase 3B Wave B ATOMIC seat-enforced enrollment for the class_enrollments path '
  '(the /api/schools/enroll bulk-import PAGE). IDENTICAL discipline to '
  'enroll_students_with_seat_check — same pg_advisory_xact_lock(''school_seat:''|| '
  'school_id) namespace (the two paths serialise against each other), same unified '
  'count, same hybrid policy re-evaluated under the lock, same P3B01 block contract '
  '— but UPSERTs into class_enrollments (UNIQUE(class_id, student_id)) instead of '
  'class_students. Payload = jsonb array of {student_id, class_id}; class_id must '
  'belong to the school. service_role-only EXECUTE. Apply only when '
  'ff_school_provisioning is ON.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7c. Wave A read-model consistency — re-define get_school_overview and
--     get_classes_at_risk (from 20260614000000) HERE via CREATE OR REPLACE so the
--     change is CONTAINED to Wave B (the already-committed Wave A file is NOT
--     edited). Behavior is UNCHANGED except that "active students" now derives
--     from the unified both-tables definition (_school_active_student_ids), so the
--     read models, the enforcement guards, and the snapshot can never report
--     different numbers. get_teacher_engagement is UNCHANGED and NOT re-defined:
--     it keys on class_teachers + teacher_remediation_assignments and has no
--     roster-count dependency, so the unified count does not affect it.
--
--     With class_enrollments EMPTY (e.g. the REG-96 seed only inserts
--     class_students), the UNION reduces to exactly the old class_students-only
--     query ⇒ byte-identical counts; the existing Wave A tests still pass.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_school_overview(p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- School-scope guard: caller must be an ACTIVE admin of THIS school.
  IF NOT EXISTS (
    SELECT 1 FROM public.school_admins sa
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active
  ) THEN
    RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
  END IF;

  WITH
  -- Active classes in the school.
  school_classes AS (
    SELECT c.id
    FROM public.classes c
    WHERE c.school_id = p_school_id
      AND c.is_active
      AND c.deleted_at IS NULL
  ),
  -- UNIFIED active roster: DISTINCT active students via EITHER roster table.
  -- Single source of truth shared with enforcement (Wave B unification).
  active_roster AS (
    SELECT s.student_id
    FROM public._school_active_student_ids(p_school_id) s
  ),
  -- Distinct active teachers assigned to those classes.
  active_teachers AS (
    SELECT DISTINCT ct.teacher_id
    FROM public.class_teachers ct
    JOIN school_classes sc ON sc.id = ct.class_id
    WHERE ct.is_active
  ),
  -- Latest seat-usage snapshot for the school (one row).
  latest_seat AS (
    SELECT su.seats_purchased, su.active_students, su.utilization_pct
    FROM public.school_seat_usage su
    WHERE su.school_id = p_school_id
    ORDER BY su.snapshot_date DESC
    LIMIT 1
  ),
  -- Subscription fallback for seats_purchased when no snapshot exists.
  sub_seats AS (
    SELECT ss.seats_purchased
    FROM public.school_subscriptions ss
    WHERE ss.school_id = p_school_id
      AND ss.status = 'active'
    ORDER BY ss.seats_purchased DESC NULLS LAST
    LIMIT 1
  ),
  -- Average BKT p_know across the school's unified active roster (null if none).
  mastery AS (
    SELECT AVG(cm.p_know)::numeric AS avg_pknow
    FROM public.concept_mastery cm
    JOIN active_roster ar ON ar.student_id = cm.student_id
  )
  SELECT jsonb_build_object(
    'class_count',         (SELECT count(*) FROM school_classes),
    'teacher_count',       (SELECT count(*) FROM active_teachers),
    'student_count',       (SELECT count(*) FROM active_roster),
    'seats_purchased',     COALESCE(
                             (SELECT seats_purchased FROM latest_seat),
                             (SELECT seats_purchased FROM sub_seats),
                             0),
    'active_students',     COALESCE(
                             (SELECT active_students FROM latest_seat),
                             (SELECT count(*) FROM active_roster)),
    'seat_utilization_pct', CASE
      WHEN (SELECT utilization_pct FROM latest_seat) IS NOT NULL
        THEN round((SELECT utilization_pct FROM latest_seat)::numeric, 2)
      WHEN COALESCE((SELECT seats_purchased FROM latest_seat),
                    (SELECT seats_purchased FROM sub_seats), 0) > 0
        THEN round(
               ((SELECT count(*) FROM active_roster)::numeric
                / COALESCE((SELECT seats_purchased FROM latest_seat),
                           (SELECT seats_purchased FROM sub_seats))::numeric) * 100,
               2)
      ELSE NULL
    END,
    'avg_mastery',         (SELECT round(avg_pknow, 4) FROM mastery),
    -- data_state hint so the UI never fakes numbers: 'no_data' iff the school
    -- has no active classes AND no roster AND no mastery signal.
    'data_state',          CASE
      WHEN (SELECT count(*) FROM school_classes) = 0
       AND (SELECT count(*) FROM active_roster) = 0
       AND (SELECT avg_pknow FROM mastery) IS NULL
        THEN 'no_data'
      ELSE 'live'
    END
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_school_overview(uuid) IS
  'Phase 3B Wave A read model (re-defined in Wave B 20260614000001 for unified-'
  'count consistency): one-pass jsonb snapshot of a school (class/teacher/student '
  'counts, seats, utilization, avg BKT mastery, data_state). Behavior unchanged '
  'EXCEPT student_count / active_students / mastery roster now derive from the '
  'unified _school_active_student_ids (class_students UNION class_enrollments) so '
  'they match the seat-enforcement count. SECURITY DEFINER + active-school_admin '
  'scope guard. Reads AVG(concept_mastery.p_know). Read-only.';

CREATE OR REPLACE FUNCTION public.get_classes_at_risk(
  p_school_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  class_id       uuid,
  class_name     text,
  grade          text,
  student_count  bigint,
  at_risk_count  bigint,
  avg_mastery    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);  -- clamp 1..100
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  -- School-scope guard.
  IF NOT EXISTS (
    SELECT 1 FROM public.school_admins sa
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active
  ) THEN
    RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
  END IF;

  -- NOTE: inner aliases are deliberately NOT named class_id/class_name/grade —
  -- those names are RETURNS TABLE OUT params and in scope throughout the body.
  --
  -- UNIFIED per-class membership: a student counts for a class if active there
  -- via EITHER class_students OR class_enrollments. class_members is the per-
  -- class twin of the school-level union — DISTINCT (class_id, student_id) across
  -- both roster tables — so a student double-listed (both tables, same class) is
  -- counted ONCE for that class, exactly like the school-level count.
  RETURN QUERY
  WITH
  -- Active classes of the school (single scoped scan, reused by the union).
  sc AS (
    SELECT c.id, c.name, c.grade, c.section, c.subject
    FROM public.classes c
    WHERE c.school_id = p_school_id
      AND c.is_active
      AND c.deleted_at IS NULL
  ),
  -- DISTINCT active (class, student) pairs via EITHER roster table.
  class_members AS (
    SELECT cs.class_id, cs.student_id
    FROM public.class_students cs
    JOIN sc ON sc.id = cs.class_id
    JOIN public.students st ON st.id = cs.student_id AND st.is_active
    WHERE cs.is_active
    UNION                       -- dedupe a student listed in both tables per class
    SELECT ce.class_id, ce.student_id
    FROM public.class_enrollments ce
    JOIN sc ON sc.id = ce.class_id
    JOIN public.students st ON st.id = ce.student_id AND st.is_active
    WHERE ce.is_active
  ),
  -- Per (class, student) average p_know, computed once. LEFT JOIN concept_mastery
  -- so students with no mastery rows still count toward student_count (their
  -- per-student avg is NULL and is excluded from the at-risk / avg aggregates).
  per_student AS (
    SELECT
      sc.id                      AS cls_id,
      sc.name                    AS cls_name,
      sc.grade                   AS cls_grade,
      sc.section                 AS cls_section,
      sc.subject                 AS cls_subject,
      cm_pair.student_id         AS stu_id,
      AVG(cmm.p_know)            AS student_avg_pknow
    FROM sc
    JOIN class_members cm_pair ON cm_pair.class_id = sc.id
    LEFT JOIN public.concept_mastery cmm ON cmm.student_id = cm_pair.student_id
    GROUP BY sc.id, sc.name, sc.grade, sc.section, sc.subject, cm_pair.student_id
  )
  SELECT
    ps.cls_id                                                      AS class_id,
    -- class_name: name + section + subject as available, never NULL.
    trim(BOTH ' ' FROM
      COALESCE(ps.cls_name, 'Class')
      || COALESCE(' - ' || NULLIF(ps.cls_section, ''), '')
      || COALESCE(' (' || NULLIF(ps.cls_subject, '') || ')', '')
    )::text                                                        AS class_name,
    ps.cls_grade                                                   AS grade,
    count(*)::bigint                                               AS student_count,
    count(*) FILTER (
      WHERE ps.student_avg_pknow IS NOT NULL
        AND ps.student_avg_pknow < 0.4   -- AT_RISK_PKNOW_THRESHOLD
    )::bigint                                                      AS at_risk_count,
    round(AVG(ps.student_avg_pknow)::numeric, 4)                   AS avg_mastery
  FROM per_student ps
  GROUP BY ps.cls_id, ps.cls_name, ps.cls_section, ps.cls_subject, ps.cls_grade
  ORDER BY at_risk_count DESC, avg_mastery ASC NULLS LAST
  LIMIT v_limit OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION public.get_classes_at_risk(uuid, int, int) IS
  'Phase 3B Wave A read model (re-defined in Wave B 20260614000001 for unified-'
  'count consistency): per-class risk rollup (student_count, at_risk_count where '
  'avg p_know < 0.4, avg_mastery). Behavior unchanged EXCEPT per-class membership '
  'now considers students active via EITHER class_students OR class_enrollments '
  '(DISTINCT per student per class), matching the seat-enforcement count. mastery '
  'still read verbatim from concept_mastery.p_know; at-risk still strict < 0.4. '
  'Ordered at_risk_count DESC, avg_mastery ASC. p_limit clamped to 100. SECURITY '
  'DEFINER + scope guard. Read-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Grants (idempotent, DO-block guarded).
--    evaluate_seat_policy: authenticated (UI/preview; scope-guarded internally).
--    Mutating RPCs + internal helpers: service_role ONLY.
-- ─────────────────────────────────────────────────────────────────────────────
DO $grant$
BEGIN
  -- Public read-only evaluator → authenticated.
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.evaluate_seat_policy(uuid, integer) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.evaluate_seat_policy(uuid, integer) FROM anon';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.evaluate_seat_policy(uuid, integer) TO authenticated';

  -- Mutating + internal helpers → service_role only.
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.enroll_students_with_seat_check(uuid, jsonb) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.enroll_students_with_seat_check(uuid, jsonb) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.enroll_students_with_seat_check(uuid, jsonb) FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.enroll_students_with_seat_check(uuid, jsonb) TO service_role';

  -- Sibling class_enrollments-path enroll RPC → service_role only (same as above).
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.enroll_section_students_with_seat_check(uuid, jsonb) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.enroll_section_students_with_seat_check(uuid, jsonb) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.enroll_section_students_with_seat_check(uuid, jsonb) FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.enroll_section_students_with_seat_check(uuid, jsonb) TO service_role';

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refresh_school_seat_usage(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refresh_school_seat_usage(uuid) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refresh_school_seat_usage(uuid) FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.refresh_school_seat_usage(uuid) TO service_role';

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._count_active_school_students(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._count_active_school_students(uuid) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._count_active_school_students(uuid) FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public._count_active_school_students(uuid) TO service_role';

  -- Source-of-truth set helper → service_role only (internal; called by the
  -- DEFINER read models + guards, which run under their own privileges).
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._school_active_student_ids(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._school_active_student_ids(uuid) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._school_active_student_ids(uuid) FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public._school_active_student_ids(uuid) TO service_role';

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._eval_seat_policy_unchecked(integer, integer, integer, timestamptz) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._eval_seat_policy_unchecked(integer, integer, integer, timestamptz) FROM anon';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public._eval_seat_policy_unchecked(integer, integer, integer, timestamptz) TO authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public._eval_seat_policy_unchecked(integer, integer, integer, timestamptz) TO service_role';

  -- Wave A read models re-defined above via CREATE OR REPLACE. CREATE OR REPLACE
  -- preserves existing grants, but re-assert EXECUTE→authenticated here so this
  -- migration is self-contained on a FRESH DB regardless of apply order relative
  -- to Wave A''s own grant block (idempotent; safe to replay).
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.get_school_overview(uuid) TO authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.get_classes_at_risk(uuid, int, int) TO authenticated';
END;
$grant$;

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- As a school admin of <school_uuid> (authenticated):
--   SELECT public.evaluate_seat_policy('<school_uuid>', 1);   -- verdict jsonb
--   SELECT public.evaluate_seat_policy('<school_uuid>', 25);  -- batch preview
-- As a non-admin / admin of another school: evaluate_seat_policy RAISES 42501.
-- As service_role (backend):
--   SELECT public.refresh_school_seat_usage('<school_uuid>');
--   SELECT public.enroll_students_with_seat_check('<school_uuid>',
--            '[{"student_id":"<uuid>","class_id":"<uuid>"}]'::jsonb);     -- class_students path
--   SELECT public.enroll_section_students_with_seat_check('<school_uuid>',
--            '[{"student_id":"<uuid>","class_id":"<uuid>"}]'::jsonb);     -- class_enrollments path
--   -- Over-ceiling add (EITHER path) raises SQLSTATE P3B01 with DETAIL = verdict jsonb.
--   -- Honest-count parity: the unified count equals the read-model student_count:
--   SELECT public._count_active_school_students('<school_uuid>')
--        = (public.get_school_overview('<school_uuid>')->>'student_count')::int;  -- expect t
--   -- Empty class_enrollments ⇒ count equals the old class_students-only count
--   -- (the UNION reduces to the class_students branch), so Wave A REG-96 seeding
--   -- (class_students only) yields IDENTICAL numbers.
