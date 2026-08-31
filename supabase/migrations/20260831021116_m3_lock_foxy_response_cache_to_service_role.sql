-- M3 (schema review finding): public.foxy_response_cache had an unscoped public
-- SELECT policy ("read_fc": USING (is_active AND expires_at > now())) with no
-- caller-identity check. Confirmed dormant: 0 live rows, zero readers/writers
-- in app code (documented unused since migration 20260516080000, superseded by
-- an in-memory L1 + Upstash Redis L2 cache). Schema contains no PII (generic
-- cached Q&A: cache_key, grade, subject, response_text, etc.) so this was never
-- a live data-exposure risk, but the loose policy is closed as hygiene —
-- matching the already-correct "svc_fc" service-role policy's intent.
DROP POLICY IF EXISTS read_fc ON public.foxy_response_cache;
REVOKE ALL ON public.foxy_response_cache FROM anon, authenticated;
GRANT ALL ON public.foxy_response_cache TO service_role;
