-- Migration: Welcome Email Database Triggers
-- Uses pg_net extension for async HTTP calls to send welcome emails
-- Triggers fire on auth.users when email is confirmed (UPDATE) or auto-confirmed (INSERT/OAuth)

-- Enable pg_net for async HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Config table for storing non-secret settings (URL) and referencing vault for secrets
CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Populate Supabase URL from current_setting (set via Supabase dashboard > Database > Settings)
-- After running this migration, set the values:
--   INSERT INTO app_config (key, value) VALUES ('supabase_url', 'https://<your-ref>.supabase.co');
-- Store the anon key in Supabase Vault (Dashboard > Settings > Vault):
--   SELECT vault.create_secret('<your-anon-key>', 'supabase_anon_key');
-- Or as a fallback, store it in app_config:
--   INSERT INTO app_config (key, value) VALUES ('supabase_anon_key', '<your-anon-key>');
--
-- The trigger functions below read from app_config at runtime.

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Only service_role and postgres can read app_config
CREATE POLICY app_config_select_policy ON public.app_config
  FOR SELECT TO postgres, service_role USING (true);

-- Helper function to read config, checking vault first for secrets, then app_config
CREATE OR REPLACE FUNCTION public.get_app_config(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value TEXT;
BEGIN
  -- Try Supabase Vault first (for secrets like anon key)
  BEGIN
    SELECT decrypted_secret INTO v_value
    FROM vault.decrypted_secrets
    WHERE name = p_key
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_value := NULL;
  END;

  IF v_value IS NOT NULL THEN
    RETURN v_value;
  END IF;

  -- Fall back to app_config table
  SELECT value INTO v_value FROM public.app_config WHERE key = p_key LIMIT 1;

  IF v_value IS NULL THEN
    RAISE EXCEPTION 'Missing app config key: %. Set it in vault or app_config table.', p_key;
  END IF;

  RETURN v_value;
END;
$$;

-- Trigger function: fires when existing user confirms their email (UPDATE flow)
CREATE OR REPLACE FUNCTION public.send_welcome_email_on_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role TEXT := 'student';
  v_name TEXT;
  v_email TEXT;
  v_grade TEXT := '';
  v_board TEXT := '';
  v_school TEXT := '';
  v_payload JSONB;
  v_supabase_url TEXT;
  v_anon_key TEXT;
BEGIN
  -- Read config at runtime instead of hardcoding secrets
  v_supabase_url := public.get_app_config('supabase_url');
  v_anon_key := public.get_app_config('supabase_anon_key');

  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  v_email := NEW.email;
  v_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(v_email, '@', 1));

  IF EXISTS (SELECT 1 FROM students WHERE auth_user_id = NEW.id) THEN
    v_role := 'student';
    SELECT COALESCE(grade, ''), COALESCE(board, '') INTO v_grade, v_board
    FROM students WHERE auth_user_id = NEW.id LIMIT 1;
    v_grade := REPLACE(v_grade, 'Grade ', '');
  ELSIF EXISTS (SELECT 1 FROM teachers WHERE auth_user_id = NEW.id) THEN
    v_role := 'teacher';
    SELECT COALESCE(school_name, '') INTO v_school
    FROM teachers WHERE auth_user_id = NEW.id LIMIT 1;
  ELSIF EXISTS (SELECT 1 FROM guardians WHERE auth_user_id = NEW.id) THEN
    v_role := 'parent';
  END IF;

  v_payload := jsonb_build_object(
    'role', v_role, 'name', v_name, 'email', v_email,
    'grade', v_grade, 'board', v_board, 'school_name', v_school
  );

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-welcome-email',
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'apikey', v_anon_key
    )
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Welcome email trigger failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_send_welcome_email ON auth.users;
CREATE TRIGGER trigger_send_welcome_email
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.send_welcome_email_on_confirm();

-- Trigger function: fires for auto-confirmed users (e.g. Google OAuth)
CREATE OR REPLACE FUNCTION public.send_welcome_email_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role TEXT := 'student';
  v_name TEXT;
  v_email TEXT;
  v_payload JSONB;
  v_supabase_url TEXT;
  v_anon_key TEXT;
BEGIN
  -- Read config at runtime instead of hardcoding secrets
  v_supabase_url := public.get_app_config('supabase_url');
  v_anon_key := public.get_app_config('supabase_anon_key');

  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  v_email := NEW.email;
  v_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(v_email, '@', 1));

  v_payload := jsonb_build_object(
    'role', v_role, 'name', v_name, 'email', v_email,
    'grade', '', 'board', '', 'school_name', ''
  );

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-welcome-email',
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'apikey', v_anon_key
    )
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Welcome email insert trigger failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_send_welcome_email_insert ON auth.users;
CREATE TRIGGER trigger_send_welcome_email_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW
  WHEN (NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.send_welcome_email_on_insert();

-- Grant permissions to auth admin
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.get_app_config(TEXT) TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.send_welcome_email_on_confirm() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.send_welcome_email_on_insert() TO supabase_auth_admin;
GRANT SELECT ON public.app_config TO supabase_auth_admin;
