-- Follow-up: the prior revoke targeted anon/authenticated explicitly, but
-- update_mastery_bkt still had the Postgres default EXECUTE grant to PUBLIC
-- (proacl showed "=X/postgres"), which anon and authenticated inherit regardless
-- of any role-specific revoke. Revoking from PUBLIC closes that. service_role
-- keeps its explicit grant so trusted server-side/internal callers are unaffected.
revoke execute on function public.update_mastery_bkt(uuid, uuid, boolean) from public;
