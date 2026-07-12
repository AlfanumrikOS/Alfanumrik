-- Minimal current-schema contract for the selected-school RPC migration.
-- This is an isolated CI fixture, not a production migration or schema source.
-- Supabase supplies auth.users, auth.uid(), and the API database roles; every
-- public object below is limited to what 20260711230713 and its assertions use.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'local Supabase fixture requires auth.users';
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'local Supabase fixture requires auth.uid()';
  END IF;

  IF EXISTS (
    SELECT required.role_name
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS required(role_name)
    LEFT JOIN pg_roles role_row ON role_row.rolname = required.role_name
    WHERE role_row.rolname IS NULL
  ) THEN
    RAISE EXCEPTION 'local Supabase fixture is missing an API database role';
  END IF;
END;
$preflight$;

CREATE TABLE public.schools (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  max_students integer
);

CREATE TABLE public.school_admins (
  id uuid PRIMARY KEY,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (auth_user_id, school_id)
);

CREATE TABLE public.students (
  id uuid PRIMARY KEY,
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  grade text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  xp_total integer NOT NULL DEFAULT 0,
  last_active timestamptz,
  subscription_plan text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.classes (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  grade text NOT NULL,
  section text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.class_students (
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, student_id)
);

CREATE TABLE public.school_subscriptions (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  plan text NOT NULL,
  billing_cycle text NOT NULL,
  seats_purchased integer,
  status text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.roles (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.permissions (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE public.user_roles (
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  PRIMARY KEY (auth_user_id, role_id)
);

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

INSERT INTO public.roles (id, name, is_active)
VALUES (
  '60000000-0000-0000-0000-000000000001',
  'institution_admin',
  true
);

INSERT INTO public.permissions (id, code, is_active)
VALUES (
  '61000000-0000-0000-0000-000000000001',
  'institution.manage_students',
  true
);

INSERT INTO public.role_permissions (role_id, permission_id)
VALUES (
  '60000000-0000-0000-0000-000000000001',
  '61000000-0000-0000-0000-000000000001'
);

CREATE OR REPLACE FUNCTION public.get_user_permissions(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'permissions',
    COALESCE(jsonb_agg(DISTINCT permission_rows.code), '[]'::jsonb)
  )
  FROM (
    SELECT permission_row.code
    FROM public.user_roles user_role
    JOIN public.roles role_row
      ON role_row.id = user_role.role_id
     AND role_row.is_active = true
    JOIN public.role_permissions role_permission
      ON role_permission.role_id = role_row.id
    JOIN public.permissions permission_row
      ON permission_row.id = role_permission.permission_id
     AND permission_row.is_active = true
    WHERE user_role.auth_user_id = p_user_id
      AND user_role.is_active = true
      AND (user_role.expires_at IS NULL OR user_role.expires_at > now())
  ) permission_rows;
$$;

REVOKE ALL ON FUNCTION public.get_user_permissions(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Legacy signatures model the already-deployed callers whose catalog entries
-- and authenticated grants the additive selected-school migration must preserve.
CREATE OR REPLACE FUNCTION public.school_admin_list_students(
  p_page integer,
  p_limit integer,
  p_grade text,
  p_search text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT jsonb_build_object('success', true); $$;

CREATE OR REPLACE FUNCTION public.school_admin_toggle_student_active(
  p_student_id uuid,
  p_is_active boolean
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT jsonb_build_object('success', true); $$;

CREATE OR REPLACE FUNCTION public.school_admin_attach_created_student(
  p_student_auth_user_id uuid,
  p_phone text,
  p_class_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT jsonb_build_object('success', true); $$;

CREATE OR REPLACE FUNCTION public.school_admin_student_create_preflight(
  p_email text,
  p_attempted_count integer,
  p_class_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT jsonb_build_object('success', true); $$;

CREATE OR REPLACE FUNCTION public.school_admin_student_create_preflight(
  p_email text,
  p_attempted_count integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT jsonb_build_object('success', true); $$;

REVOKE ALL ON FUNCTION public.school_admin_list_students(integer, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_admin_list_students(integer, integer, text, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.school_admin_toggle_student_active(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_admin_toggle_student_active(uuid, boolean)
  TO authenticated;
REVOKE ALL ON FUNCTION public.school_admin_attach_created_student(uuid, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_admin_attach_created_student(uuid, text, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.school_admin_student_create_preflight(text, integer, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_admin_student_create_preflight(text, integer, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.school_admin_student_create_preflight(text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_admin_student_create_preflight(text, integer)
  TO authenticated;

GRANT USAGE ON SCHEMA public TO authenticated;

COMMIT;
