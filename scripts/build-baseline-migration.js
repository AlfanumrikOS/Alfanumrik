#!/usr/bin/env node
/**
 * One-shot helper to build supabase/migrations/00000000000000_baseline_schema_consolidated.sql
 * by concatenating supabase/migrations/_legacy/*.sql in canonical order, applying minimal
 * idempotency wraps (only where the source SQL is non-idempotent).
 *
 * Run from repo root:  node scripts/build-baseline-migration.js
 *
 * This script is intended to be deleted (or kept only as historical artifact)
 * after the consolidated migration is committed. It does NOT need to run in CI.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEGACY_DIR = path.join(ROOT, 'supabase', 'migrations', '_legacy');
const OUT_PATH = path.join(ROOT, 'supabase', 'migrations', '00000000000000_baseline_schema_consolidated.sql');

const FILES_IN_ORDER = [
  '000_core_schema.sql',
  '001_task_queue_and_helpers.sql',
  '002_indexes_triggers_realtime.sql',
  '003_strengthen_rls.sql',
  '004_security_hardening.sql',
  '005_welcome_email_triggers.sql',
  '006_cognitive_engine_tables.sql',
  '007_core_rpcs.sql',
  '007_dashboard_rpcs.sql',
  '008_fix_snapshot_rpc_and_rls.sql',
];

const HEADER = `-- ============================================================================
-- 00000000000000_baseline_schema_consolidated.sql
-- ============================================================================
-- WHAT THIS IS
--   Consolidated, idempotent baseline of the foundational Alfanumrik schema.
--   This file is the verbatim concatenation of the 10 SQL files under
--   supabase/migrations/_legacy/ (in canonical order), with minimal
--   idempotency wraps applied around statements that the source SQL did
--   not already guard.
--
-- WHY IT EXISTS
--   Before this migration, supabase/migrations/ first 9 entries were
--   stub files containing only "-- Applied remotely to Supabase / -- See
--   _legacy/ for consolidated SQL reference". Production was bootstrapped
--   via the Supabase dashboard before migration tracking was set up, and
--   "supabase db push" against a fresh Supabase project failed at
--   20260322200645_add_task_queue_and_helper_functions.sql with
--   ERROR: relation "students" does not exist.
--
--   That meant the schema was not reproducible from source — disaster
--   recovery was broken and we could not spin up new staging/dev/test
--   projects. This baseline closes that P0 gap.
--
-- IDEMPOTENCY GUARANTEE
--   Every CREATE TABLE uses IF NOT EXISTS.
--   Every CREATE INDEX uses IF NOT EXISTS.
--   Every CREATE FUNCTION uses OR REPLACE.
--   Every CREATE TRIGGER is wrapped (DROP IF EXISTS ... CREATE) or guarded
--     by a pg_trigger lookup in a DO block.
--   Every CREATE POLICY is preceded by DROP POLICY IF EXISTS.
--   Every ALTER TABLE ADD COLUMN uses IF NOT EXISTS.
--   ALTER PUBLICATION ADD TABLE is wrapped in a pg_publication_tables guard
--     (Postgres errors if the relation is already a publication member).
--
--   On a fresh DB:    creates the foundational schema (schools, students,
--                     sessions, gamification, RLS policies, RPCs, etc.)
--   On production:    every statement is a no-op. The only side effect is
--                     that the supabase CLI marks 00000000000000 as applied
--                     in schema_migrations, which is the desired outcome —
--                     schema becomes traceable from source.
--
-- HISTORICAL REFERENCE
--   supabase/migrations/_legacy/ is preserved unchanged as the historical
--   record of how the schema was bootstrapped. It is no longer required for
--   fresh-DB bootstrap.
--
-- FORWARD DECLARATIONS
--   _legacy/006_cognitive_engine_tables.sql references curriculum_topics(id)
--   in foreign keys, but no _legacy file creates that table — it was originally
--   created via the Supabase dashboard. To make this baseline self-sufficient
--   on a fresh DB, a minimal CREATE TABLE IF NOT EXISTS curriculum_topics
--   block is injected immediately before the _legacy/006 section. On production
--   the table already exists; the IF NOT EXISTS guard makes it a no-op.
--
-- TOTAL FILE ORDER (concatenated below)
--   000_core_schema.sql
--   001_task_queue_and_helpers.sql
--   002_indexes_triggers_realtime.sql
--   003_strengthen_rls.sql
--   004_security_hardening.sql
--   005_welcome_email_triggers.sql
--   006_cognitive_engine_tables.sql
--   007_core_rpcs.sql
--   007_dashboard_rpcs.sql
--   008_fix_snapshot_rpc_and_rls.sql
-- ============================================================================

`;

function sectionSeparator(filename) {
  return `\n-- ============================================================\n` +
         `-- > Section: ${filename}\n` +
         `-- ============================================================\n\n`;
}

/**
 * Apply per-file wraps for non-idempotent statements identified during audit.
 * Only the minimum changes needed; SQL semantics remain identical.
 */
function applyWraps(filename, body) {
  switch (filename) {
    case '002_indexes_triggers_realtime.sql':
      return wrapAlterPublication(body);
    case '005_welcome_email_triggers.sql':
      return wrapAppConfigPolicy(body);
    case '006_cognitive_engine_tables.sql':
      return wrapCreatePoliciesIn006(body);
    case '008_fix_snapshot_rpc_and_rls.sql':
      return wrapCreatePoliciesIn008(body);
    default:
      return body;
  }
}

/**
 * Forward-declared schema items that `_legacy/006_cognitive_engine_tables.sql`
 * references but are NOT created in any _legacy file (they were originally
 * created/added via the Supabase dashboard, same root cause as the broader
 * stub-migrations gap this PR fixes).
 *
 * Without these, fresh-DB bootstrap fails with errors like:
 *   ERROR: relation "curriculum_topics" does not exist (SQLSTATE 42P01)
 *   ERROR: column qb.subject_id does not exist (SQLSTATE 42703)
 *
 * On production each statement is a no-op (objects already exist, IF NOT
 * EXISTS / DROP IF EXISTS guards prevent any change). On a fresh DB this
 * lets the _legacy/006 FK + JOIN references resolve.
 *
 * Later migrations add additional columns to these objects idempotently via
 * ALTER TABLE ADD COLUMN IF NOT EXISTS, so they keep working unchanged.
 */
const FORWARD_DECLARATIONS = `
-- ============================================================
-- > Forward declarations: schema items referenced by _legacy/
-- > but not created in any _legacy file (originally added via
-- > Supabase dashboard before migration tracking existed).
-- > All statements are idempotent and a no-op on production.
-- ============================================================

-- 1. curriculum_topics (referenced in _legacy/006 FKs and
--    _legacy/007_dashboard_rpcs.sql RPC bodies).
CREATE TABLE IF NOT EXISTS curriculum_topics (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id           UUID REFERENCES subjects(id),
  grade                TEXT NOT NULL,
  chapter_number       INTEGER,
  title                TEXT NOT NULL,
  title_hi             TEXT,
  description          TEXT,
  description_hi       TEXT,
  topic_type           TEXT DEFAULT 'concept',
  difficulty_level     INTEGER DEFAULT 2,
  learning_objectives  JSONB DEFAULT '[]',
  display_order        INTEGER DEFAULT 0,
  is_active            BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE curriculum_topics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "curriculum_topics_public_read" ON curriculum_topics;
CREATE POLICY "curriculum_topics_public_read" ON curriculum_topics
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "curriculum_topics_service_all" ON curriculum_topics;
CREATE POLICY "curriculum_topics_service_all" ON curriculum_topics
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 2. question_bank.subject_id (referenced in _legacy/006
--    get_board_exam_questions: "JOIN subjects s ON s.id = qb.subject_id").
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id);

-- 3. concept_mastery.topic_tag, .chapter_title, .front_text, .back_text,
--    .hint, .interval_days, .streak (referenced in _legacy/007_*.sql RPCs
--    that read mastery cards). On prod these were added via dashboard.
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS topic_tag TEXT;
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS chapter_title TEXT;
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS chapter_number INTEGER;
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS front_text TEXT;
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS back_text TEXT;
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS hint TEXT;
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS interval_days INTEGER DEFAULT 1;
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS streak INTEGER DEFAULT 0;
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS total_reviews INTEGER DEFAULT 0;
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS correct_reviews INTEGER DEFAULT 0;
ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS repetition_count INTEGER DEFAULT 0;

-- 4. quiz_sessions.xp_earned, .topic_id, .grade, .time_seconds (referenced
--    in _legacy/007_core_rpcs.sql submit_quiz_results INSERT).
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS xp_earned INTEGER DEFAULT 0;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS topic_id UUID;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS time_seconds INTEGER;

-- 5. question_bank legacy columns referenced by _legacy/007_dashboard_rpcs
--    (question_text_hi, correct_option). These overlap with existing
--    columns in _legacy/000 (question_hi, correct_answer_index) but the
--    older RPC bodies expected the legacy names.
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS question_text_hi TEXT;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS correct_option INTEGER;

-- 6. student_learning_profiles helpers referenced by _legacy/007_*.sql
--    leaderboard subqueries.
ALTER TABLE student_learning_profiles ADD COLUMN IF NOT EXISTS total_xp INTEGER;
ALTER TABLE student_learning_profiles ADD COLUMN IF NOT EXISTS max_streak INTEGER;
ALTER TABLE student_learning_profiles ADD COLUMN IF NOT EXISTS total_correct INTEGER;
ALTER TABLE student_learning_profiles ADD COLUMN IF NOT EXISTS total_asked INTEGER;

`;

/**
 * `ALTER PUBLICATION supabase_realtime ADD TABLE IF EXISTS xxx;` is idempotent
 * with respect to the table existing, but NOT idempotent with respect to the
 * table already being a publication member — Postgres raises:
 *   ERROR: relation "xxx" is already member of publication "supabase_realtime"
 * Wrap each one in a guarded DO block.
 */
function wrapAlterPublication(body) {
  return body.replace(
    /^ALTER PUBLICATION supabase_realtime ADD TABLE IF EXISTS\s+(\w+);\s*$/gm,
    (_, tbl) => {
      return `DO $$\n` +
             `BEGIN\n` +
             `  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = '${tbl}' AND relnamespace = 'public'::regnamespace)\n` +
             `     AND NOT EXISTS (\n` +
             `       SELECT 1 FROM pg_publication_tables\n` +
             `       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = '${tbl}'\n` +
             `     ) THEN\n` +
             `    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.${tbl}';\n` +
             `  END IF;\n` +
             `END $$;`;
    }
  );
}

/**
 * 005 has a single `CREATE POLICY app_config_select_policy ON public.app_config ...`
 * with no DROP IF EXISTS in front of it. Wrap it.
 */
function wrapAppConfigPolicy(body) {
  return body.replace(
    /^CREATE POLICY app_config_select_policy ON public\.app_config\s*\n\s*FOR SELECT TO postgres, service_role USING \(true\);/m,
    `DROP POLICY IF EXISTS app_config_select_policy ON public.app_config;\n` +
    `CREATE POLICY app_config_select_policy ON public.app_config\n` +
    `  FOR SELECT TO postgres, service_role USING (true);`
  );
}

/**
 * 006 defines 12 CREATE POLICY statements with no DROP IF EXISTS. Add a DROP IF EXISTS
 * line before each one.
 */
function wrapCreatePoliciesIn006(body) {
  // Match: CREATE POLICY "name" ON tablename
  return body.replace(
    /^CREATE POLICY "([^"]+)" ON (\w+)/gm,
    (_, name, tbl) => `DROP POLICY IF EXISTS "${name}" ON ${tbl};\nCREATE POLICY "${name}" ON ${tbl}`
  );
}

/**
 * 008 has CREATE POLICY entries that lack a DROP IF EXISTS for their *new* names
 * (the file only DROPs the old human-readable name). Add DROP IF EXISTS for the
 * new short names.
 */
function wrapCreatePoliciesIn008(body) {
  return body.replace(
    /^CREATE POLICY "([^"]+)" ON (\w+)/gm,
    (_, name, tbl) => `DROP POLICY IF EXISTS "${name}" ON ${tbl};\nCREATE POLICY "${name}" ON ${tbl}`
  );
}

let output = HEADER;
const wrapsApplied = [];

for (const filename of FILES_IN_ORDER) {
  // Inject forward declarations immediately before _legacy/006 (which is the
  // first file that references `curriculum_topics`).
  if (filename === '006_cognitive_engine_tables.sql') {
    output += FORWARD_DECLARATIONS;
  }
  const fullPath = path.join(LEGACY_DIR, filename);
  let body = fs.readFileSync(fullPath, 'utf8');
  const before = body;
  body = applyWraps(filename, body);
  if (body !== before) {
    wrapsApplied.push(filename);
  }
  // Ensure trailing newline
  if (!body.endsWith('\n')) body += '\n';
  output += sectionSeparator(filename) + body;
}

fs.writeFileSync(OUT_PATH, output, 'utf8');

const lines = output.split('\n').length;
const bytes = Buffer.byteLength(output, 'utf8');
console.log(`Wrote ${OUT_PATH}`);
console.log(`  Lines:  ${lines}`);
console.log(`  Bytes:  ${bytes} (${(bytes / 1024).toFixed(1)} KB)`);
console.log(`  Wraps applied to: ${wrapsApplied.join(', ') || '(none)'}`);
