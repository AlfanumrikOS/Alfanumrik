-- Identity Service Data Migration Framework
-- Batch migration utilities for large dataset handling
-- Supports progress tracking, error handling, and rollback

-- ============================================================================
-- BATCH MIGRATION FRAMEWORK
-- ============================================================================

-- Create migration tracking table
CREATE TABLE IF NOT EXISTS identity.migration_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name TEXT NOT NULL,
  batch_number INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  records_processed BIGINT DEFAULT 0,
  total_records BIGINT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (migration_name, batch_number)
);

-- Enable RLS
ALTER TABLE identity.migration_batches ENABLE ROW LEVEL SECURITY;

-- Service role access only
CREATE POLICY migration_batches_service ON identity.migration_batches
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================================
-- BATCH PROCESSING FUNCTIONS
-- ============================================================================

-- Function to start a migration batch
CREATE OR REPLACE FUNCTION identity.start_migration_batch(
  p_migration_name TEXT,
  p_batch_number INTEGER,
  p_total_records BIGINT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  batch_id UUID;
BEGIN
  INSERT INTO identity.migration_batches (
    migration_name, batch_number, total_records, status, started_at
  ) VALUES (
    p_migration_name, p_batch_number, p_total_records, 'running', now()
  ) RETURNING id INTO batch_id;

  -- Log batch start
  INSERT INTO identity.identity_events (auth_user_id, event_type, metadata)
  VALUES (
    '00000000-0000-0000-0000-000000000000'::UUID,
    'migration_batch_started',
    jsonb_build_object(
      'migration_name', p_migration_name,
      'batch_number', p_batch_number,
      'batch_id', batch_id,
      'total_records', p_total_records
    )
  );

  RETURN batch_id;
END;
$$;

-- Function to update batch progress
CREATE OR REPLACE FUNCTION identity.update_batch_progress(
  p_batch_id UUID,
  p_records_processed BIGINT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE identity.migration_batches
  SET records_processed = p_records_processed
  WHERE id = p_batch_id;
END;
$$;

-- Function to complete a migration batch
CREATE OR REPLACE FUNCTION identity.complete_migration_batch(
  p_batch_id UUID,
  p_error_message TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  batch_record RECORD;
BEGIN
  SELECT * INTO batch_record FROM identity.migration_batches WHERE id = p_batch_id;

  UPDATE identity.migration_batches
  SET
    status = CASE WHEN p_error_message IS NULL THEN 'completed' ELSE 'failed' END,
    completed_at = now(),
    error_message = p_error_message
  WHERE id = p_batch_id;

  -- Log batch completion
  INSERT INTO identity.identity_events (auth_user_id, event_type, metadata)
  VALUES (
    '00000000-0000-0000-0000-000000000000'::UUID,
    'migration_batch_completed',
    jsonb_build_object(
      'batch_id', p_batch_id,
      'migration_name', batch_record.migration_name,
      'batch_number', batch_record.batch_number,
      'records_processed', batch_record.records_processed,
      'status', CASE WHEN p_error_message IS NULL THEN 'completed' ELSE 'failed' END,
      'error_message', p_error_message
    )
  );
END;
$$;

-- ============================================================================
-- DATA CONSISTENCY CHECKS
-- ============================================================================

-- Function to validate data integrity after migration
CREATE OR REPLACE FUNCTION identity.validate_data_integrity()
RETURNS TABLE(check_name TEXT, status TEXT, details JSONB) LANGUAGE plpgsql AS $$
BEGIN
  -- Check 1: All students have valid auth_user_id
  RETURN QUERY
  SELECT
    'students_auth_user_id'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('invalid_count', COUNT(*))
  FROM identity.students
  WHERE auth_user_id IS NULL OR auth_user_id NOT IN (SELECT id FROM auth.users);

  -- Check 2: All foreign keys are valid
  RETURN QUERY
  SELECT
    'guardian_student_links_valid'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('invalid_links', COUNT(*))
  FROM identity.guardian_student_links gsl
  LEFT JOIN identity.students s ON gsl.student_id = s.id
  LEFT JOIN identity.guardians g ON gsl.guardian_id = g.id
  WHERE s.id IS NULL OR g.id IS NULL;

  -- Check 3: No orphaned class enrollments
  RETURN QUERY
  SELECT
    'class_students_valid'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('orphaned_enrollments', COUNT(*))
  FROM identity.class_students cs
  LEFT JOIN identity.students s ON cs.student_id = s.id
  LEFT JOIN identity.classes c ON cs.class_id = c.id
  WHERE s.id IS NULL OR c.id IS NULL;

  -- Check 4: School references are valid
  RETURN QUERY
  SELECT
    'school_references_valid'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('invalid_references', COUNT(*))
  FROM (
    SELECT school_id FROM identity.students WHERE school_id IS NOT NULL
    UNION
    SELECT school_id FROM identity.teachers WHERE school_id IS NOT NULL
    UNION
    SELECT school_id FROM identity.classes WHERE school_id IS NOT NULL
  ) refs
  LEFT JOIN identity.schools s ON refs.school_id = s.id
  WHERE s.id IS NULL;
END;
$$;

-- ============================================================================
-- PROGRESS MONITORING
-- ============================================================================

-- Function to get migration progress
CREATE OR REPLACE FUNCTION identity.get_migration_progress(p_migration_name TEXT)
RETURNS TABLE(
  batch_number INTEGER,
  status TEXT,
  records_processed BIGINT,
  total_records BIGINT,
  progress_percent NUMERIC,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration INTERVAL
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    mb.batch_number,
    mb.status,
    mb.records_processed,
    mb.total_records,
    CASE
      WHEN mb.total_records > 0 THEN (mb.records_processed::NUMERIC / mb.total_records::NUMERIC) * 100
      ELSE NULL
    END AS progress_percent,
    mb.started_at,
    mb.completed_at,
    CASE
      WHEN mb.completed_at IS NOT NULL THEN mb.completed_at - mb.started_at
      WHEN mb.started_at IS NOT NULL THEN now() - mb.started_at
      ELSE NULL
    END AS duration
  FROM identity.migration_batches mb
  WHERE mb.migration_name = p_migration_name
  ORDER BY mb.batch_number;
END;
$$;

-- ============================================================================
-- BATCH SIZE CONFIGURATION
-- ============================================================================

-- Recommended batch sizes for different operations
-- These can be adjusted based on system performance
CREATE OR REPLACE FUNCTION identity.get_batch_size(p_operation TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
BEGIN
  CASE p_operation
    WHEN 'table_move' THEN RETURN 1000;  -- Moving tables between schemas
    WHEN 'fk_update' THEN RETURN 5000;   -- Updating foreign key references
    WHEN 'rls_policy' THEN RETURN 10000; -- Applying RLS policies
    WHEN 'data_validation' THEN RETURN 10000; -- Data integrity checks
    ELSE RETURN 1000; -- Default
  END CASE;
END;
$$;

-- ============================================================================
-- EXAMPLE USAGE FOR LARGE MIGRATIONS
-- ============================================================================

/*
-- Example: Batch migration of a large table
DO $$
DECLARE
  batch_id UUID;
  batch_size INTEGER := identity.get_batch_size('table_move');
  total_records BIGINT;
  processed BIGINT := 0;
  current_batch INTEGER := 1;
BEGIN
  -- Get total count
  SELECT COUNT(*) INTO total_records FROM public.large_table;

  -- Process in batches
  WHILE processed < total_records LOOP
    -- Start batch
    batch_id := identity.start_migration_batch('large_table_migration', current_batch, batch_size);

    -- Process batch (replace with actual migration logic)
    -- PERFORM identity.migrate_table_batch(batch_id, processed, batch_size);

    -- Complete batch
    PERFORM identity.complete_migration_batch(batch_id);

    processed := processed + batch_size;
    current_batch := current_batch + 1;
  END LOOP;
END;
$$;
*/