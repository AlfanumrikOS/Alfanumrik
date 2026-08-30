-- Follow-up to 20260830172610_remove_dpdp_erasure_system.sql: that migration's
-- DROP FUNCTION for insert_data_erasure_audit_event guessed a 0-arg signature;
-- the live function is actually insert_data_erasure_audit_event(uuid, text,
-- text, jsonb), so the earlier DROP silently no-opped (IF EXISTS matches on
-- exact signature). The function body reads from public.data_erasure_requests,
-- which no longer exists, so it is now a broken orphan. No app code calls it
-- (verified via repo grep) — only the already-removed erasure RPCs did.
DROP FUNCTION IF EXISTS public.insert_data_erasure_audit_event(uuid, text, text, jsonb);
