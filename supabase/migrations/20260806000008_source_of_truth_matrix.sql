-- Migration: Source-of-truth matrix (P2-5)
-- Audit remediation 2026-08-06: Creates the authoritative source-of-truth registry.
-- Every canonical entity must have a declared authoritative write path, store,
-- owner, and recovery method.

CREATE TABLE IF NOT EXISTS public.source_of_truth_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_fact text NOT NULL,          -- What real-world fact this represents
  canonical_write_path text NOT NULL,     -- The only intended authority for new writes
  authoritative_store text NOT NULL,      -- Table/object containing durable truth
  owner text NOT NULL,                    -- Team/domain responsible for invariants
  identity_grain text NOT NULL,           -- Primary key and one-row meaning
  tenant_scope text NOT NULL,             -- Organization/school/B2C ownership rule
  history_policy text NOT NULL            -- Append, version, correct, or overwrite
    CHECK (history_policy IN ('append_only', 'versioned', 'correctable', 'overwritable', 'immutable_ledger')),
  derived_consumers text[],               -- Projections, caches, search, analytics, exports
  consistency_expectation text NOT NULL   -- Transactional, eventual, scheduled, or manual
    CHECK (consistency_expectation IN ('transactional', 'eventual', 'scheduled', 'manual')),
  retention_deletion_rule text NOT NULL,  -- Executable lifecycle rule
  recovery_method text NOT NULL,          -- Replay, restore, recompute, or manual
  schema_version integer DEFAULT 1,
  effective_from timestamptz DEFAULT now(),
  deprecated_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (capability_fact, schema_version)
);

ALTER TABLE public.source_of_truth_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access source_of_truth_registry"
  ON public.source_of_truth_registry FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read source_of_truth"
  ON public.source_of_truth_registry FOR SELECT
  TO authenticated
  USING (true);

-- Seed the source-of-truth matrix with canonical entities
INSERT INTO public.source_of_truth_registry
  (capability_fact, canonical_write_path, authoritative_store, owner, identity_grain,
   tenant_scope, history_policy, derived_consumers, consistency_expectation,
   retention_deletion_rule, recovery_method)
VALUES
  -- Identity
  ('Student profile exists and is active',
   'POST /api/auth/bootstrap -> bootstrap_user_profile RPC',
   'students', 'identity',
   'students.id (UUID per student)',
   'B2C: student owns self; B2B: student belongs to school via class_enrollments',
   'versioned',
   ARRAY['student_learning_profiles', 'class_students', 'learner_twin_snapshots'],
   'transactional',
   'account_life (kept until account deletion + 30d cooling-off)',
   'restore from backup; auth.users recreation required'),

  ('Guardian linked to student',
   'POST /api/parent/link -> guardian_student_links INSERT',
   'guardian_student_links', 'identity',
   'guardian_student_links.id (one row per link)',
   'School: guardian sees only linked students within school scope',
   'append_only',
   ARRAY['parental_consent', 'notifications'],
   'transactional',
   'account_life (deleted on either account deletion)',
   'restore from backup; re-link required'),

  ('Teacher assigned to class',
   'POST /api/teacher/assign -> class_teachers INSERT',
   'class_teachers', 'identity',
   'class_teachers.id (one row per teacher-class pair)',
   'School: teacher sees own classes within school scope',
   'append_only',
   ARRAY['assignments', 'student_assessment_attempts'],
   'transactional',
   'account_life (removed on teacher departure)',
   'restore from backup; reassignment required'),

  -- Learning
  ('Quiz response submitted and scored',
   'RPC submit_quiz_results_v2 (v2 authoritative; v1 deprecated)',
   'quiz_sessions + quiz_responses', 'data-platform',
   'quiz_sessions.id (one per quiz attempt)',
   'Student: own quiz sessions only',
   'append_only',
   ARRAY['concept_mastery', 'xp_transactions', 'student_learning_profiles', 'state_events'],
   'transactional',
   '1_year (delete quiz_responses/sessions; keep concept_mastery aggregates)',
   'restore from backup; replay from state_events if needed'),

  ('Concept mastery estimate calculated',
   'RPC atomic_quiz_profile_update -> upsert concept_mastery',
   'concept_mastery', 'data-platform',
   'concept_mastery.(student_id, concept_id, engine_version)',
   'Student: own mastery estimates only',
   'versioned',
   ARRAY['recommendations', 'Today queue', 'teacher_analytics_cache', 'EIC aggregations'],
   'eventual',
   'account_life (deleted on account deletion)',
   'recompute from quiz_responses + learning_events via replay'),

  ('Recommendation generated for learner',
   'RPC generate_recommendations -> recommendations INSERT',
   'recommendations', 'data-platform',
   'recommendations.id (one per recommendation)',
   'Student: own recommendations only',
   'append_only',
   ARRAY['Today queue', 'notifications', 'teacher_analytics_cache'],
   'scheduled',
   '90_days (recommendations expire; keep acceptance/completion aggregates)',
   'recompute from concept_mastery + spaced_repetition_cards'),

  -- AI
  ('Foxy AI interaction recorded',
   'POST /api/foxy -> foxy_chat_messages INSERT',
   'foxy_chat_messages', 'data-platform',
   'foxy_chat_messages.id (one per message)',
   'Student: own chat messages only',
   'append_only',
   ARRAY['grounded_ai_traces', 'foxy_quality_scores', 'foxy_served_items'],
   'transactional',
   '6_months (delete messages, keep de-identified quality scores)',
   'not recoverable (generative AI output is non-deterministic)'),

  ('RAG content chunk ingested and searchable',
   'scripts/ncert-ingestion -> rag_content_chunks INSERT',
   'rag_content_chunks', 'content',
   'rag_content_chunks.id (one per chunk)',
   'Global: content is shared across tenants; access gated by approval status',
   'versioned',
   ARRAY['rag_content_documents', 'cbse_syllabus', 'rag_retrieval_logs', 'pgvector indexes'],
   'scheduled',
   'permanent (content retained; retired content soft-deleted)',
   're-ingest from NCERT source files via ingestion scripts'),

  -- Safety
  ('Safety incident escalated',
   'safeguarding_escalations INSERT via API or automated detection',
   'safeguarding_escalations', 'data-platform',
   'safeguarding_escalations.id (one per incident)',
   'School: incidents visible to authorized school staff within scope',
   'append_only',
   ARRAY['notifications', 'audit_logs', 'state_events'],
   'transactional',
   'permanent (safety records retained for legal compliance)',
   'restore from backup; audit trail must be preserved'),

  -- Payments
  ('Subscription payment processed',
   'Razorpay webhook -> payment_history INSERT + student_subscriptions UPDATE',
   'payment_history + student_subscriptions', 'data-platform',
   'payment_history.id (one per payment)',
   'B2C: subscription linked to student; B2B: linked to school',
   'append_only',
   ARRAY['subscription_events', 'payment_webhook_events', 'plan_limit_coverage'],
   'transactional',
   'permanent (8-year minimum per IT Act §44AA)',
   'restore from backup; reconcile with Razorpay dashboard'),

  -- Content
  ('Question bank question verified and approved',
   'POST /api/super-admin/questions/verify -> question_bank UPDATE is_verified=true',
   'question_bank', 'content',
   'question_bank.id (one per question)',
   'Global: content shared across tenants; access gated by is_verified + is_active',
   'versioned',
   ARRAY['quiz_session_shuffles', 'rag_content_chunks', 'ncert_solver_solutions'],
   'transactional',
   'permanent (retired content soft-deleted, never hard-deleted)',
   'restore from backup; re-verify if restored from pre-verification state')
ON CONFLICT (capability_fact, schema_version) DO NOTHING;
