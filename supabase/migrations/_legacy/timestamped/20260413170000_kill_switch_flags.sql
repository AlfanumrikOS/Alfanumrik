-- Kill-switch feature flags for critical subsystems
-- Default: enabled (true). Can be disabled at runtime via super-admin UI.
-- Uses IF NOT EXISTS pattern since flag_name may not have a UNIQUE constraint.

DO $$ BEGIN

  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'quiz_assembler_v2') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'quiz_assembler_v2',
      true,
      'Guaranteed count quiz assembler with fallback ladder. Disable to revert to legacy question fetching.'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'foxy_cognitive_engine') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'foxy_cognitive_engine',
      true,
      'Foxy reads mastery/gaps/errors from CME before responding. Disable for RAG-only mode.'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'adaptive_post_quiz') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'adaptive_post_quiz',
      true,
      'Post-quiz adaptive processing (CME record_response + question_responses). Disable for XP-only submission.'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'foxy_diagram_rendering') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'foxy_diagram_rendering',
      true,
      'Show NCERT diagram PDFs in Foxy responses. Disable for text-only mode.'
    );
  END IF;

END $$;