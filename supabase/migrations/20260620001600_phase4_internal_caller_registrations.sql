-- Platform Security Layer — Phase 4: Internal Caller Registrations
-- Registers all 10 bulk/embed Edge Function proxies in security_internal_callers.
-- Each proxy is named "${fnName}-proxy" and links to the corresponding
-- "${fnName}-internal_service" quota profile seeded in 20260620001300.
--
-- Wave 1 (5 functions): embed-questions, embed-ncert-qa, embed-diagrams,
--   extract-diagrams, bulk-jee-neet-import
-- Wave 2 (5 functions): generate-answers, generate-concepts,
--   extract-ncert-questions, bulk-non-mcq-gen, bulk-question-gen
--
-- All 10 are registered in this single migration so the DB is complete for
-- both waves before any code integration lands.

INSERT INTO public.security_internal_callers (
  name,
  owner,
  description,
  status,
  caller_kind,
  quota_profile_id
)
SELECT
  callers.caller_name,
  'platform',
  callers.caller_desc,
  'active',
  'service_name',
  p.id
FROM (
  VALUES
    ('embed-questions-proxy',        'embed-questions-internal_service',        'Next.js /api/super-admin/ai/embed-questions proxy signing requests to embed-questions'),
    ('embed-ncert-qa-proxy',         'embed-ncert-qa-internal_service',         'Next.js /api/super-admin/ai/embed-ncert-qa proxy signing requests to embed-ncert-qa'),
    ('embed-diagrams-proxy',         'embed-diagrams-internal_service',         'Next.js /api/super-admin/ai/embed-diagrams proxy signing requests to embed-diagrams'),
    ('extract-diagrams-proxy',       'extract-diagrams-internal_service',       'Next.js /api/super-admin/ai/extract-diagrams proxy signing requests to extract-diagrams'),
    ('bulk-jee-neet-import-proxy',   'bulk-jee-neet-import-internal_service',   'Next.js /api/super-admin/ai/bulk-jee-neet-import proxy signing requests to bulk-jee-neet-import'),
    ('generate-answers-proxy',       'generate-answers-internal_service',       'Next.js /api/super-admin/ai/generate-answers proxy signing requests to generate-answers'),
    ('generate-concepts-proxy',      'generate-concepts-internal_service',      'Next.js /api/super-admin/ai/generate-concepts proxy signing requests to generate-concepts'),
    ('extract-ncert-questions-proxy','extract-ncert-questions-internal_service','Next.js /api/super-admin/ai/extract-ncert-questions proxy signing requests to extract-ncert-questions'),
    ('bulk-non-mcq-gen-proxy',       'bulk-non-mcq-gen-internal_service',       'Next.js /api/super-admin/ai/bulk-non-mcq-gen proxy signing requests to bulk-non-mcq-gen'),
    ('bulk-question-gen-proxy',      'bulk-question-gen-internal_service',      'Next.js /api/super-admin/ai/bulk-question-gen proxy signing requests to bulk-question-gen')
) AS callers(caller_name, profile_name, caller_desc)
JOIN public.security_quota_profiles p ON p.name = callers.profile_name
ON CONFLICT (name) DO UPDATE SET
  status      = EXCLUDED.status,
  description = EXCLUDED.description;
