-- Migration: 20260504100500_backfill_quiz_shuffles_integrity.sql
-- Purpose:    Marking-Authenticity Phase 2.9 — backfill the Phase C
--             observability columns on quiz_session_shuffles
--             (`options_version_at_serve`, `integrity_hash`) for every
--             pre-Phase-C row, then promote both columns to NOT NULL so
--             REG-53 ("server-only re-derivation + tamper detection")
--             covers every quiz row, not just sessions started after
--             Phase C shipped (2026-04-30).
--
-- Audit gap closed:
--   Phase C migration `20260430000000_quiz_phase_c_options_versioning.sql`
--   added both columns as NULLABLE so existing rows would not break the
--   ADD COLUMN. submit_quiz_results_v2 short-circuits hash verification
--   when integrity_hash IS NULL (those legacy rows continue to score
--   per Phase A semantics). REG-53 therefore only enforces tamper
--   detection on ~1 day of data. This migration eliminates that gap:
--   after it runs, every row has a deterministic hash that matches what
--   the Phase C trigger would have produced, AND the columns are NOT NULL
--   so future inserts cannot regress.
--
-- What this migration does NOT change:
--   - submit_quiz_results_v2 logic (still uses the same hash format).
--   - start_quiz_session logic (already populates both fields for new rows).
--   - Phase A / Phase B constraints, triggers, RLS policies.
--   - Mobile / v1 submit_quiz_results path.
--   - question_bank.options_version (already NOT NULL DEFAULT 1 from Phase C).
--
-- Hash format (MUST stay byte-for-byte identical to Phase C):
--   encode(digest(options_snapshot::text || correct_answer_index_snapshot::text, 'sha256'), 'hex')
--   See `start_quiz_session` body in 20260430000000 lines 237-240. If that
--   format ever changes, this backfill becomes stale — pair with a fresh
--   re-backfill migration in the same PR. The format is also re-verified
--   inside submit_quiz_results_v2 (lines 398-401, 538-541), so divergence
--   between this migration and the trigger-time format would surface
--   immediately as REG-53 false-positives.
--
-- Sentinel value for options_version_at_serve:
--   Backfilled rows are stamped with `0` to signal "pre-Phase-C snapshot,
--   version unknown". Phase C's question_bank.options_version DEFAULT is 1,
--   so 0 is unambiguously distinguishable from any legitimate served
--   version. Cross-session drift detection (which compares
--   options_version_at_serve against current question_bank.options_version)
--   will treat 0 as "no version captured" and skip the comparison rather
--   than always reporting drift. Operators querying marking_audit_last_30d
--   can filter on options_version_at_serve = 0 to identify backfilled rows.
--
-- Reversibility:
--   - SET NOT NULL is reversible via `ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL`
--     (no compensating data work needed; the backfilled values stay).
--   - Backfilled hashes are deterministic from the row's own snapshot, so
--     even after rollback the hash column would still match what
--     submit_quiz_results_v2 expects. There is no destructive op here —
--     no DROP, no DELETE, no UPDATE of pre-existing non-NULL data.
--   - To fully undo: revert this migration AND null out the backfilled
--     fields with `UPDATE quiz_session_shuffles SET integrity_hash = NULL,
--     options_version_at_serve = NULL WHERE options_version_at_serve = 0;`
--     (operator-driven, not automated, never needed in normal operations).
--
-- Idempotent:
--   - Backfill UPDATEs filter on `IS NULL`, so re-running is a no-op for
--     rows already populated.
--   - `ALTER TABLE ... SET NOT NULL` is idempotent in Postgres (no error
--     if the column is already NOT NULL).
--   - `CREATE EXTENSION IF NOT EXISTS pgcrypto` is idempotent.
--   - The verification block raises an exception only when the post-
--     backfill state is wrong, which means the migration is failing for
--     a real reason, not a re-application.
--
-- Risk profile:
--   - LOW. Pure additive data fill + constraint tightening. No schema
--     reshape, no DROP, no row deletion, no policy change.
--   - The backfill UPDATE rewrites N rows where N = count of NULL rows
--     today. Estimate: a few thousand rows per day of Phase A/B traffic
--     since 2026-04-28 (≈6-7 days). The verification block in step 4
--     prints the exact count at apply time.
--   - Phase C trigger (`question_bank_bump_options_version`) is unaffected.
--
-- Reviewers (per .claude/skills/review-chains/SKILL.md, "RBAC/auth"
-- and "Anti-cheat thresholds" don't apply here — this is a data-only
-- backfill on a server-owned snapshot table). Architect-owned because
-- it touches the schema and tightens NOT NULL on a security-relevant
-- column. Quality + testing should re-run REG-53 against pre-Phase-C
-- rows once this is deployed.

-- ──────────────────────────────────────────────────────────────────────────
-- 0. Defensive: ensure pgcrypto is available for digest()
-- ──────────────────────────────────────────────────────────────────────────
-- pgcrypto is enabled on prod (used by Phase C and by the observability
-- console migration). This is belt-and-suspenders for fresh staging /
-- preview environments where the legacy chain hasn't been fully replayed.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Backfill options_version_at_serve where NULL → 0 (sentinel)
-- ──────────────────────────────────────────────────────────────────────────
-- Rationale: pre-Phase-C rows have no captured version. 0 is the agreed
-- sentinel because question_bank.options_version DEFAULT is 1 and the
-- trigger only ever increments, so 0 cannot occur naturally. This lets
-- downstream consumers (marking_audit_last_30d, drift detection logic)
-- distinguish backfilled rows from genuine serves.

UPDATE quiz_session_shuffles
   SET options_version_at_serve = 0
 WHERE options_version_at_serve IS NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Backfill integrity_hash where NULL — deterministic from existing snapshot
-- ──────────────────────────────────────────────────────────────────────────
-- The hash format MUST mirror start_quiz_session() in
-- 20260430000000_quiz_phase_c_options_versioning.sql:237-240
-- so that submit_quiz_results_v2's verification (lines 398-401) succeeds
-- against backfilled rows.
--
-- Format:
--   encode(digest(options_snapshot::text || correct_answer_index_snapshot::text, 'sha256'), 'hex')
--
-- Rows where options_snapshot or correct_answer_index_snapshot is somehow
-- NULL would currently violate the NOT NULL constraints from the original
-- table definition (20260428160000:61, 64), so this UPDATE cannot encounter
-- NULL inputs — the digest() call is therefore safe without a COALESCE
-- guard. If a fresh DB shape ever loosens those NOT NULLs the verification
-- block in step 4 will catch the resulting NULL hash.

UPDATE quiz_session_shuffles
   SET integrity_hash = encode(
         digest(options_snapshot::text || correct_answer_index_snapshot::text, 'sha256'),
         'hex'
       )
 WHERE integrity_hash IS NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Promote both columns to NOT NULL — future inserts cannot regress
-- ──────────────────────────────────────────────────────────────────────────
-- ALTER ... SET NOT NULL is itself idempotent in Postgres (no-op if the
-- column is already NOT NULL, no error). We rely on that for re-runs.
-- start_quiz_session() in Phase C already always inserts non-NULL values,
-- so this constraint reflects existing producer behavior — no change to
-- write paths is required.

ALTER TABLE quiz_session_shuffles
  ALTER COLUMN options_version_at_serve SET NOT NULL;

ALTER TABLE quiz_session_shuffles
  ALTER COLUMN integrity_hash SET NOT NULL;

-- Refresh column COMMENTs so the new invariant is documented at the
-- catalog level. These overwrite the Phase C comments (which described
-- the columns as nullable / Phase-A-rows-skipped) with the post-2.9
-- reality.

COMMENT ON COLUMN quiz_session_shuffles.options_version_at_serve IS
  'NOT NULL (Phase 2.9, migration 20260504100500). Snapshot of '
  'question_bank.options_version at the moment start_quiz_session() ran. '
  'Sentinel value 0 = pre-Phase-C row backfilled by migration '
  '20260504100500 (no genuine version captured). Used by '
  'submit_quiz_results_v2 to detect cross-session content drift '
  '(observability only — scoring remains snapshot-bound).';

COMMENT ON COLUMN quiz_session_shuffles.integrity_hash IS
  'NOT NULL (Phase 2.9, migration 20260504100500). SHA256 hex of '
  '(options_snapshot::text || correct_answer_index_snapshot::text) computed '
  'either by start_quiz_session() at insert time (Phase C and later) or '
  'by the Phase 2.9 backfill migration for pre-Phase-C rows (deterministic '
  'from the same snapshot fields, so submit_quiz_results_v2 verification '
  'succeeds in either case). On mismatch at submit time, the question is '
  'awarded zero XP and an ops_events warning is written with '
  'category=quiz.integrity_mismatch.';

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Verification — assert zero NULLs remain; print backfill counts
-- ──────────────────────────────────────────────────────────────────────────
-- This block runs AFTER the SET NOT NULL above, so it should be impossible
-- to find a NULL row at this point — the ALTER would have failed first.
-- The explicit count() check is defense-in-depth for catch-all observability
-- on platforms that might short-circuit the SET NOT NULL (none known, but
-- the check costs ~one index scan and gives operators a confidence signal
-- in the migration log).

DO $verify$
DECLARE
  v_null_version  BIGINT;
  v_null_hash     BIGINT;
  v_total_rows    BIGINT;
  v_backfilled_v  BIGINT;
BEGIN
  SELECT count(*) INTO v_total_rows FROM quiz_session_shuffles;

  SELECT count(*) INTO v_null_version
    FROM quiz_session_shuffles
   WHERE options_version_at_serve IS NULL;

  SELECT count(*) INTO v_null_hash
    FROM quiz_session_shuffles
   WHERE integrity_hash IS NULL;

  SELECT count(*) INTO v_backfilled_v
    FROM quiz_session_shuffles
   WHERE options_version_at_serve = 0;

  IF v_null_version > 0 OR v_null_hash > 0 THEN
    RAISE EXCEPTION
      'Phase 2.9 backfill verification FAILED: '
      'options_version_at_serve NULL count = %, integrity_hash NULL count = %. '
      'The SET NOT NULL above should have prevented this — investigate before '
      'declaring REG-53 covers all rows.',
      v_null_version, v_null_hash;
  END IF;

  RAISE NOTICE
    'Phase 2.9 backfill verification OK: total rows = %, backfilled (sentinel '
    'options_version_at_serve = 0) = %, all integrity_hash values populated.',
    v_total_rows, v_backfilled_v;
END $verify$;

-- End of migration: 20260504100500_backfill_quiz_shuffles_integrity.sql
-- Tables touched:    quiz_session_shuffles (data backfill + 2 SET NOT NULL)
-- Functions touched: none
-- Triggers touched:  none
-- RLS touched:       none
