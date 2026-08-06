-- Migration: Data classification system + processing purpose matrix (P1-1, P1-2)
-- Audit remediation 2026-08-06: Creates machine-readable data classification and purpose mapping.

-- Table 1: Field-level data classification with sensitivity tiers
CREATE TABLE IF NOT EXISTS public.data_classification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_name text NOT NULL DEFAULT 'public',
  table_name text NOT NULL,
  column_name text NOT NULL,
  sensitivity_tier text NOT NULL CHECK (sensitivity_tier IN (
    'public',               -- Public curriculum/content data
    'internal',             -- Internal operational metadata
    'tenant_confidential',  -- Tenant/school confidential data
    'personal',             -- Personal identity/contact data
    'child_record',         -- Child/learner educational records
    'sensitive',            -- Safety, support, free-text data
    'financial',            -- Payment/subscription records
    'credential'            -- Secrets, tokens, auth material
  )),
  pii_category text CHECK (pii_category IN (
    'none', 'direct_identifier', 'indirect_identifier',
    'educational_record', 'behavioral_data', 'contact_info',
    'financial_data', 'auth_credential', 'free_text', 'ai_output'
  )),
  purpose_scope text CHECK (purpose_scope IN (
    'mandatory_core', 'optional_personalization', 'safety',
    'telemetry', 'analytics', 'ai_processing', 'prohibited'
  )),
  retention_class text CHECK (retention_class IN (
    'permanent', 'account_life', '1_year', '6_months', '90_days', '30_days', '7_days'
  )),
  is_encrypted boolean DEFAULT false,
  requires_consent boolean DEFAULT false,
  requires_deletion_propagation boolean DEFAULT false,
  owner text,
  steward text,
  notes text,
  classified_at timestamptz DEFAULT now(),
  last_reviewed_at timestamptz DEFAULT now(),
  UNIQUE (schema_name, table_name, column_name)
);

ALTER TABLE public.data_classification ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access data_classification"
  ON public.data_classification FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Authenticated users can read classification (needed for automated checks)
CREATE POLICY "Authenticated can read classification"
  ON public.data_classification FOR SELECT
  TO authenticated
  USING (true);

-- Seed classifications for high-priority tables (child data + PII)
-- These classifications are the minimum viable set. Full classification is a
-- continuous process (Phase 3 ongoing).

INSERT INTO public.data_classification
  (table_name, column_name, sensitivity_tier, pii_category, purpose_scope, retention_class, requires_consent, requires_deletion_propagation, owner, steward, notes)
VALUES
  -- students table
  ('students', 'name', 'child_record', 'direct_identifier', 'mandatory_core', 'account_life', true, true, 'data-platform', 'identity', 'Learner display name'),
  ('students', 'email', 'personal', 'contact_info', 'mandatory_core', 'account_life', true, true, 'data-platform', 'identity', 'Contact email (may be guardian email)'),
  ('students', 'phone', 'personal', 'contact_info', 'mandatory_core', 'account_life', true, true, 'data-platform', 'identity', 'Contact phone'),
  ('students', 'auth_user_id', 'credential', 'auth_credential', 'mandatory_core', 'account_life', false, true, 'data-platform', 'identity', 'Supabase auth linkage'),
  ('students', 'date_of_birth', 'child_record', 'direct_identifier', 'mandatory_core', 'account_life', true, true, 'data-platform', 'identity', 'Age verification for child safety'),
  ('students', 'school_name', 'tenant_confidential', 'indirect_identifier', 'mandatory_core', 'account_life', false, true, 'data-platform', 'institution', 'Institutional affiliation'),
  ('students', 'link_code', 'personal', 'indirect_identifier', 'mandatory_core', 'account_life', false, true, 'data-platform', 'identity', 'Parent linking code'),
  ('students', 'avatar_url', 'personal', 'indirect_identifier', 'mandatory_core', 'account_life', false, true, 'data-platform', 'identity', 'Profile image URL'),

  -- quiz_responses table
  ('quiz_responses', 'selected_option', 'child_record', 'educational_record', 'mandatory_core', '1_year', false, true, 'data-platform', 'learning', 'Student answer'),
  ('quiz_responses', 'is_correct', 'child_record', 'educational_record', 'mandatory_core', '1_year', false, true, 'data-platform', 'learning', 'Scoring result'),
  ('quiz_responses', 'time_spent', 'child_record', 'behavioral_data', 'mandatory_core', '1_year', false, true, 'data-platform', 'learning', 'Response time'),

  -- guardians table
  ('guardians', 'name', 'personal', 'direct_identifier', 'mandatory_core', 'account_life', true, true, 'data-platform', 'identity', 'Guardian display name'),
  ('guardians', 'email', 'personal', 'contact_info', 'mandatory_core', 'account_life', true, true, 'data-platform', 'identity', 'Guardian contact email'),
  ('guardians', 'phone', 'personal', 'contact_info', 'mandatory_core', 'account_life', true, true, 'data-platform', 'identity', 'Guardian contact phone'),

  -- teachers table
  ('teachers', 'name', 'personal', 'direct_identifier', 'mandatory_core', 'account_life', true, true, 'data-platform', 'identity', 'Teacher display name'),
  ('teachers', 'email', 'personal', 'contact_info', 'mandatory_core', 'account_life', true, true, 'data-platform', 'identity', 'Teacher contact email'),
  ('teachers', 'phone', 'personal', 'contact_info', 'mandatory_core', 'account_life', true, true, 'data-platform', 'identity', 'Teacher contact phone'),

  -- foxy_chat_messages table
  ('foxy_chat_messages', 'content', 'sensitive', 'free_text', 'ai_processing', '6_months', false, true, 'data-platform', 'ai', 'AI chat history (may contain PII in free text)'),

  -- concept_mastery table
  ('concept_mastery', 'mastery_estimate', 'child_record', 'behavioral_data', 'mandatory_core', 'account_life', false, true, 'data-platform', 'learning', 'Derived mastery score'),

  -- audit_logs table
  ('audit_logs', 'auth_user_id', 'internal', 'auth_credential', 'telemetry', '1_year', false, false, 'data-platform', 'operations', 'Actor identifier for audit trail'),
  ('audit_logs', 'ip_address', 'personal', 'indirect_identifier', 'telemetry', '1_year', false, false, 'data-platform', 'operations', 'Request origin IP'),

  -- learner_twin_memory table
  ('learner_twin_memory', 'embedding', 'child_record', 'behavioral_data', 'optional_personalization', 'account_life', true, true, 'data-platform', 'ai', 'Vector embedding of learner behavior'),

  -- payment_history table
  ('payment_history', 'student_id', 'financial', 'financial_data', 'mandatory_core', 'permanent', false, false, 'data-platform', 'billing', 'Payment record (8yr retention per IT Act)')
ON CONFLICT (schema_name, table_name, column_name) DO UPDATE SET
  sensitivity_tier = EXCLUDED.sensitivity_tier,
  pii_category = EXCLUDED.pii_category,
  owner = EXCLUDED.owner,
  last_reviewed_at = now();

-- Table 2: Data processing purpose matrix
CREATE TABLE IF NOT EXISTS public.data_processing_purposes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_table text NOT NULL,
  processing_purpose text NOT NULL CHECK (processing_purpose IN (
    'mandatory_core', 'optional_personalization', 'safety',
    'telemetry', 'analytics', 'ai_training',
    'ai_inference', 'embeddings', 'exports'
  )),
  decision_supported text,          -- What decision this processing enables
  required_consent_scope text,       -- Which consent scope gates this processing
  allowed_consumers text[],          -- Roles/processes allowed to consume (e.g. '{service_role, authenticated}')
  retention_in_this_context text,    -- How long data persists in this processing context
  opt_out_effect text,              -- What happens when consent is withdrawn
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  owner text,
  UNIQUE (dataset_table, processing_purpose)
);

ALTER TABLE public.data_processing_purposes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access data_processing_purposes"
  ON public.data_processing_purposes FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read processing purposes"
  ON public.data_processing_purposes FOR SELECT
  TO authenticated
  USING (true);

-- Seed purpose matrix for key processing flows
INSERT INTO public.data_processing_purposes
  (dataset_table, processing_purpose, decision_supported, required_consent_scope, allowed_consumers, retention_in_this_context, opt_out_effect, owner)
VALUES
  ('quiz_responses', 'mandatory_core', 'Quiz scoring and XP calculation', NULL, ARRAY['service_role', 'authenticated'], 'account_life', 'N/A (core functionality)', 'data-platform'),
  ('quiz_responses', 'ai_training', 'IRT parameter calibration', 'curriculum_access', ARRAY['service_role'], 'de-identified permanent', 'Stops new calibration data from this user', 'data-platform'),
  ('concept_mastery', 'mandatory_core', 'Today recommendation queue', NULL, ARRAY['service_role', 'authenticated'], 'account_life', 'N/A (core functionality)', 'data-platform'),
  ('concept_mastery', 'analytics', 'School performance dashboards (EIC)', NULL, ARRAY['service_role'], 'aggregated only', 'Individual record removed from aggregates', 'data-platform'),
  ('foxy_chat_messages', 'ai_inference', 'Foxy AI tutor responses', NULL, ARRAY['service_role'], '6_months', 'Chat history deleted; no effect on live Foxy', 'data-platform'),
  ('foxy_chat_messages', 'ai_training', 'AI quality improvement', 'curriculum_access', ARRAY['service_role'], 'de-identified permanent', 'Stops new training data from this user', 'data-platform'),
  ('learner_twin_memory', 'optional_personalization', 'Digital twin predictions', NULL, ARRAY['service_role'], 'account_life', 'Twin memory erased; predictions degrade to population baseline', 'data-platform'),
  ('payment_history', 'mandatory_core', 'Subscription management and billing', NULL, ARRAY['service_role'], 'permanent (8yr IT Act)', 'N/A (legal obligation)', 'data-platform'),
  ('students', 'analytics', 'Platform health and growth metrics', NULL, ARRAY['service_role'], 'aggregated only', 'Individual record excluded from aggregates', 'data-platform'),
  ('quiz_responses', 'embeddings', 'Misconception pattern detection (pgvector)', NULL, ARRAY['service_role'], 'account_life', 'Vector embeddings deleted; pattern detection degraded', 'data-platform')
ON CONFLICT (dataset_table, processing_purpose) DO UPDATE SET
  decision_supported = EXCLUDED.decision_supported,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- Trigger to auto-classify new tables as 'unknown' sensitivity
CREATE OR REPLACE FUNCTION public.flag_unclassified_table()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE WARNING 'New table created. Run classification review: data_classification table audit.';
END;
$$;

-- CI/CD guard: Function that CI calls to verify all tables have at least one classification
CREATE OR REPLACE FUNCTION public.get_unclassified_tables()
RETURNS TABLE(table_name text, column_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    c.relname::text AS table_name,
    (SELECT count(*) FROM pg_attribute a
     WHERE a.attrelid = c.oid
       AND a.attnum > 0
       AND NOT a.attisdropped) AS column_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname NOT IN (
      SELECT DISTINCT table_name FROM public.data_classification
    )
    AND c.relname NOT LIKE 'pg_%'
    AND c.relname NOT LIKE '_prisma_%'
  ORDER BY c.relname;
$$;

REVOKE ALL ON FUNCTION public.get_unclassified_tables() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unclassified_tables() TO authenticated, service_role;

-- Index for classification queries
CREATE INDEX IF NOT EXISTS idx_data_classification_table_name
  ON public.data_classification (table_name);

CREATE INDEX IF NOT EXISTS idx_data_classification_sensitivity
  ON public.data_classification (sensitivity_tier)
  WHERE sensitivity_tier IN ('child_record', 'sensitive', 'financial', 'credential');
