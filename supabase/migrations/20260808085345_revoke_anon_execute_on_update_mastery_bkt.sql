-- Fix: update_mastery_bkt(uuid, uuid, boolean) had no auth/ownership check and was
-- executable by the anon role, letting anyone with the public anon key rewrite any
-- student's mastery data by ID via PostgREST RPC. The locked-down sibling function
-- update_concept_mastery_bkt (SECURITY DEFINER, anon revoked) is the pattern the
-- rest of the mastery-write surface already follows; this brings update_mastery_bkt
-- in line. Also revoking from `authenticated` since the function takes an arbitrary
-- p_student_id with no ownership check, so any logged-in user could still target
-- another student's row.
revoke execute on function public.update_mastery_bkt(uuid, uuid, boolean) from anon, authenticated;
