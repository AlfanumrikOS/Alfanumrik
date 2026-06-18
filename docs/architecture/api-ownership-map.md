# API Ownership Map and Deprecation Plan

This map covers overlapping workflow APIs and defines which path is canonical for new production traffic. Duplicate routes stay in place until telemetry proves zero production usage for a full release window.

## Ownership map

| Workflow | Canonical owner/path | Compatibility paths | Internal-only paths | Deprecated paths | Notes |
| --- | --- | --- | --- | --- | --- |
| Quiz | Next.js API v2: `POST /api/v2/quiz/start`, `GET /api/v2/quiz/questions`, `POST /api/v2/quiz/submit` | `GET/POST /api/quiz`, `POST /api/quiz/submit`, `GET /api/quiz/ncert-questions` | `supabase/functions/quiz-generator` for adaptive question engine behavior not yet represented in v2 | Direct browser calls to `quiz-generator` | Frontend must call the v2 Next.js route for quiz loading/submission. The Edge Function is service/internal until its adaptive behavior is fully wrapped by v2. |
| Parent | Next.js parent APIs. Stable web surfaces remain under `/api/parent/**`; mobile/new contract surfaces use `/api/v2/parent/**` | `supabase/functions/parent-portal` is a compatibility backend for the v2 glance aggregator | None | Direct frontend calls to `parent-portal` | Parent routes remain split by product surface until all web pages have v2 equivalents. Direct Edge Function usage is deprecated. |
| NCERT solve | `POST /api/scan-solve` | None | `supabase/functions/ncert-solver`, `supabase/functions/ncert-question-engine` | Direct browser calls to NCERT Edge Functions | The Next.js route owns auth, input validation, and response contract; Edge Functions remain implementation details. |
| AI tutor | `POST /api/foxy` for conversational tutoring; `GET /api/tutor/next` and `POST /api/tutor/answer` for adaptive tutor concept checks | None | `supabase/functions/grounded-answer`, `supabase/functions/alfabot-answer` | Direct browser calls to tutor Edge Functions | Foxy owns chat orchestration and may call grounded-answer internally. Tutor concept APIs are separate canonical BKT endpoints. |
| Cron | `POST /api/cron/daily-cron` | None | `supabase/functions/daily-cron` | `GET /api/cron/daily` | Vercel Cron points at `/api/cron/daily-cron`; the Edge Function is invoked by the proxy and validates the shared secret. |

## Deprecation policy

1. Mark duplicate paths with structured `api.deprecated_route.hit` warning logs and `Deprecation`, `Sunset`, and `Link` response headers where the path is a Next.js route.
2. Edge Functions that are no longer public entry points log `api_deprecated_edge_function_hit` with workflow and canonical path metadata.
3. New frontend code must call the canonical path. Static routing tests enforce the current browser-facing call sites.
4. Keep compatibility paths deployed until production telemetry shows zero usage for at least 30 days and one full app release.
5. Remove duplicates in a follow-up PR only after the owning team confirms telemetry, updates runbooks, and notifies mobile/web consumers.

## Removal checklist

- [ ] Dashboard query confirms zero hits for deprecated path in production for 30 days.
- [ ] No active mobile/web release references the deprecated route.
- [ ] Synthetic checks and cron schedules point to canonical path.
- [ ] OpenAPI/client contracts updated.
- [ ] Route deleted and integration tests updated in the same PR.
