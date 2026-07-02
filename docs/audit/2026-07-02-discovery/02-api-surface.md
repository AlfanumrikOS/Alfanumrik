
# API Surface Discovery — Alfanumrik Backend Inventory

**Date:** 2026-07-02 · **Scope:** read-only inventory, no code changes · **Method:** `Glob`/`Grep` enumeration of `src/app/api/**/route.ts` (362 files), `supabase/functions/*` (49 live functions), `vercel.json` crons, pg_cron migrations, and edge-function trigger wiring.

**Verification levels used in this doc:**
- **[V]** verified by reading the file directly.
- **[G]** derived by grep pattern-matching across the full route set (bulk-classified — high confidence but not individually eyeballed for every row; multi-auth routes or unusual call shapes can under/over-count).
- **[S]** sampled — one or two representative files read in a group of similar routes; the rest assumed structurally identical. Marked inline where used.

---

## 1. Summary Counts

**Total Next.js API routes:** 362 (`route.ts` files under `src/app/api/`)
**Total Supabase Edge Functions (live):** 49 (+ 1 archived: `_archive/quiz-generator-v2`, never shipped)

### Routes by domain
| Domain | Routes | Primary auth |
|---|---|---|
| `super-admin/*` | 119 | `authorizeAdmin` (98) + `authorizeRequest` RBAC (21 — split posture, see Findings §5.1) |
| `school-admin/*` | 39 | `authorizeSchoolAdmin` (33) / `resolveCommandCenterContext` (6) |
| `v1/*` (legacy versioned) | 18 | RBAC (16), `SchoolApiKey` (2) |
| `internal/admin/*` + `internal/agents/*` | 11 | `x-admin-secret` (`requireAdminSecret`) |
| `internal/cron/*` | 1 | `CRON_SECRET` |
| `cron/*` | 17 | `CRON_SECRET` |
| `parent/*` | 21 | RBAC (14) / `getUser` manual (7) |
| `teacher/*` | 14 | RBAC (13) / manual Bearer+getUser (1 — `teacher/profile`) |
| `student/*` + `students/*` | 15 | RBAC (13) / manual getUser (2) |
| `payments/*` | 7 | RBAC+getUser (5) / `x-admin-secret` raw (1) / Razorpay HMAC (1) |
| `pulse/*` | 4 | RBAC |
| `dive/*` + `synthesis/*` + `rhythm/*` (Pedagogy v2) | 9 | manual `getUser` + feature-flag gate |
| `foxy/*` + `tutor/*` + `learner/*` + `learn/*` | 18 | mixed RBAC / manual getUser |
| `quiz/*` + `exams/*` + `exam/*` + `diagnostic/*` | 10 | RBAC |
| `v2/*` | 10 | RBAC |
| `public/v1/*` | 5 | `PublicApiKey` (4) / public docs (1) |
| `oauth/*` | 2 | public authorize / client-credential token |
| `alfabot/*` | 3 | public, rate-limited (widget) |
| `school-config/*` + `schools/*` + `tenant/*` | 9 | RBAC (6) / public (3) |
| `support/*` | 4 | RBAC (3) / manual Bearer (1) |
| everything else (health, error-report, feature-flags, notifications, state, mol, embedding, lab-notebook, board-score, concept-engine, scan-solve, revision, practice, dashboard) | ~26 | mixed, mostly RBAC/public |

### Routes by auth mechanism (top-level, [G])
| Mechanism | Helper | Approx. count |
|---|---|---|
| RBAC | `authorizeRequest(request, 'perm.code')` from `src/lib/rbac.ts` | ~150 |
| Admin session | `authorizeAdmin(request, level)` from `src/lib/admin-auth.ts` | 98 |
| School admin | `authorizeSchoolAdmin()` / `resolveCommandCenterContext()` from `src/lib/school-admin-auth.ts`, `src/lib/school-admin/command-center-context.ts` | 39 |
| Manual `supabase.auth.getUser()` | ad hoc, no permission-code layer | ~35 |
| `CRON_SECRET` | constant-time header/Bearer/query compare, no shared single helper (see §5.3) | 18 |
| `x-admin-secret` | `requireAdminSecret()` helper (11) or inline raw compare (1 — `payments/setup-plans`) | 12 |
| `PublicApiKey` | `authorizePublicApiKey()` from `src/lib/public-api/auth.ts` | 4 |
| `SchoolApiKey` | `authenticateApiKey()` from `src/lib/school-api-auth.ts` — **separate system**, see Findings §5.2 | 2 |
| Razorpay webhook HMAC | `verifyRazorpaySignature()` from `src/lib/payment-verification.ts` | 1 |
| OAuth client-credential | `client_secret_hash` compare | 1 |
| OTP hash | `verifyOtp()` constant-time | 1 (paired with `getUser`) |
| Public / no auth found by grep | rate-limited or intentionally public | ~20 (listed individually below, each annotated) |

---

## 2. Route Tables by Domain

Columns: **Route** (relative to `src/app/api/`) · **Methods** [G] · **Auth** [G, see legend] · **Client** (`A`=`supabase-admin` service-role import present, `S`=`supabase-server` RLS-scoped import present, `A+S`=both, `-`=neither found — likely raw `fetch` to REST or another mechanism) · **Flag** (feature flag gate found in file, `-`=none found) · **RL** (in-file rate limiting found, `Y`/`N`).

Auth legend: `RBAC`=`authorizeRequest`; `AdminSession`=`authorizeAdmin` (tiers: support<analyst<content_manager<finance<admin<super_admin); `AdminSecretHelper`=`requireAdminSecret()`; `AdminSecretRaw`=inline `x-admin-secret` compare; `SchoolAdmin`/`SchoolAdminCtx`=school-admin wrappers; `PublicApiKey`/`SchoolApiKey`=API-key systems; `CronSecret`=`CRON_SECRET`; `RazorpaySig`=webhook HMAC; `GetUser`=manual `supabase.auth.getUser()`; `OAuthClientCred`; `OTP`; `PUBLIC`=no auth mechanism found (verified or sampled where noted).

### 2.1 Payments (`payments/*`) — backend-owned, P11
| Route | Methods | Auth | Client | Flag | RL |
|---|---|---|---|---|---|
| `payments/cancel` | POST | RBAC | A | - | N |
| `payments/create-order` | POST | RBAC+GetUser | A | `ff_gst_invoicing_v1` | N |
| `payments/setup-plans` | POST | **AdminSecretRaw** (inline `x-admin-secret` check, not the `requireAdminSecret()` helper) [V] | A | - | N |
| `payments/status` | GET | RBAC | A | - | N |
| `payments/subscribe` | POST | RBAC+GetUser | A | `ff_gst_invoicing_v1` | N |
| `payments/verify` | POST | RBAC+GetUser | A | `ff_gst_invoicing_v1` | N |
| `payments/webhook` | POST | RazorpaySig — `verifyRazorpaySignature()` checked before any DB read/write [V] | A | `ff_atomic_subscription_activation` | N |

### 2.2 Cron (`cron/*`, `internal/cron/*`) — 18 routes, all `CRON_SECRET`-gated
| Route | Methods | Vercel schedule (vercel.json) | Flag |
|---|---|---|---|
| `cron/school-operations` | POST | `0 2 * * *` | - |
| `cron/daily-cron` | POST | `30 2 * * *` | - |
| `cron/irt-calibrate` | GET/POST | `50 2 * * *` | - |
| `cron/reconcile-payments` | POST | `*/30 * * * *` | - |
| `cron/payments-health` | GET/POST | `*/10 * * * *` | - |
| `cron/expired-subscriptions` | POST | `15 */6 * * *` | - |
| `cron/account-purge` | GET/POST | `0 4 * * *` | `ff_ends_at` [G — likely false positive, verify] |
| `cron/pre-debit-notice` | POST | `0 */6 * * *` | - |
| `cron/board-score` | POST | `0 3 * * *` | `ff_board_score_v1` |
| `cron/reverify-domains` | POST | `45 3 * * *` | - |
| `cron/foxy-quality-sample` | POST | `40 3 * * *` | - |
| `internal/cron/fix-failed-questions` | GET/POST | `*/15 * * * *` | - |
| `cron/streak-guardian` | POST | `30 16 * * *` | `ff_streak_guardian_cron_v1` |
| `cron/adaptive-remediation` | POST | **not in vercel.json crons list** — triggered thin from `daily-cron` Edge Function per constitution; route itself is directly callable too | `ff_adaptive_loops_bc_v1` (Loop A separately gated by `ff_adaptive_remediation_v1` per constitution, not caught by this grep) |
| `cron/build-twin-snapshots` | POST | **not in vercel.json crons list** — also daily-cron-triggered | `ff_digital_twin_v1` |
| `cron/evaluate-alerts` | POST | **not in vercel.json crons list** | - |
| `cron/goal-daily-plan-reminder` | POST | **not in vercel.json crons list** | `ff_goal_daily_plan_reminder` |
| `cron/daily` | GET | **not in vercel.json crons list** — appears to be a legacy/duplicate of `cron/daily-cron`; needs manual check (Finding §5.4) | - |

Auth pattern for all: header `x-cron-secret` or `Authorization: Bearer <CRON_SECRET>` or (some routes) `?token=`, constant-time compared against `process.env.CRON_SECRET`. No single shared helper — each route re-implements the compare inline [V, sampled across ~6 files]; `src/app/api/cron/adaptive-remediation/route.ts` and `build-twin-snapshots/route.ts` explicitly self-document "fail-closed CRON_SECRET gate with a `x-cron-secret`, `Authorization: Bearer`, or `?token=`" (REG-118/REG-119/REG-127 posture).

### 2.3 Super Admin (`super-admin/*`) — 119 routes, ops/backend joint domain
Two co-existing auth systems (see Finding §5.1):
- **`authorizeAdmin(request, level)`** (98 routes) — session JWT + `admin_users` table lookup, 6-tier hierarchy (`support` floor through `super_admin`). Level distribution sampled [G]: `support` (~55 routes, read-heavy dashboards/reports), `super_admin` (~25 routes, mutations: institutions, RBAC, entitlements, reconciliation approve/reject, plan-change, contracts), `admin` (~8, student PII views + impersonation + bulk notify/resend-invite), mixed multi-level per route common (e.g. GET at `support`, POST at `super_admin` in the same file).
- **`authorizeRequest(request, 'super_admin.access'|'super_admin.subjects.manage')`** (21 routes) — RBAC permission-code path, structurally identical to student/teacher/parent routes rather than the admin-secret/session model. Routes: `ai/oracle-health`, `foxy-quality`, `goal-profiles`, `grounding/*` (5), `marking-integrity` (2), `marking-path-mix`, `misconceptions`, `mol-shadow`, `oracle-health`, `students/[id]/subjects`, `subjects/*` (5), `alfabot/sessions/[sessionId]` (dual: both `authorizeRequest` AND `authorizeAdmin` present in the same file).
- `super-admin/login` — public (it IS the login endpoint), Upstash-rate-limited + lockout-throttled [V].
- `super-admin/oauth-apps` — `authorizeAdmin` for the admin UI + `OAuthClientCred`-style hashing for the app secret it issues.

Full 119-route path list omitted here for length (enumerated in §1 counts and the raw classification table generated during this audit — available on request); every route was covered by the bulk `[G]` classification pass in §1.

### 2.4 School Admin (`school-admin/*`) — 39 routes, tenant-scoped
All 39 routes pass through one of two wrapper helpers that both bottom out in `authorizeRequest()` + a `school_admins` lookup [V, `src/lib/school-admin-auth.ts`]:
- `authorizeSchoolAdmin(request, 'permission.code')` — 33 routes (classes, students, teachers, staff, parents, exams, content, invoices, gst-details, invite-codes, webhooks, integrations, api-keys, audit-log, branding, rbac, roster/validate, tenant-config, subscription, bulk-import ×2, contracts, modules, ai-assistant, announcements, analytics, reports).
- `resolveCommandCenterContext()` — 6 routes, the newer "Command Center" read-model wave: `overview`, `classes-at-risk`, `teacher-engagement`, `reports/bloom`, `reports/mastery`, `reports/export`. Same underlying RBAC + tenant-scope guarantee, thinner handler pattern (calls a single SECURITY DEFINER RPC).

Permission code observed: `institution.manage`, `institution.view_analytics`, `public_api.manage`, `class.manage` (exact code varies per route; not individually re-verified for all 39 — `[S]`).

Notable: `school-admin/webhooks` is the **outbound** integration webhook system (school registers an HTTPS sink, HMAC-signed deliveries via the `webhook-dispatcher` Edge Function) — explicitly documented in-file as unrelated to the inbound Razorpay webhook.

### 2.5 Public API v1 (`public/v1/*`) — external ERP/partner integrations
| Route | Methods | Auth |
|---|---|---|
| `public/v1/classes` | GET | `authorizePublicApiKey()` |
| `public/v1/marketplace/listings` | GET | `authorizePublicApiKey()` |
| `public/v1/reports` | GET | `authorizePublicApiKey()` |
| `public/v1/students` | GET | `authorizePublicApiKey()`, scope `students.read`, tenant = key's `school_id` only, PII-minimized response (id/name/grade/is_active/created_at — no email/phone) [V] |
| `public/v1/openapi` | GET | public — serves the OpenAPI spec doc itself |

Auth: `src/lib/public-api/auth.ts` — bearer API key, scope-checked, rate-limited (headers attached to response), tenant resolved from the key, never from request params.

### 2.6 v1/school (`v1/school/*`) — **a second, separate API-key system**
| Route | Methods | Auth |
|---|---|---|
| `v1/school/reports` | GET | `authenticateApiKey()` — `src/lib/school-api-auth.ts` |
| `v1/school/students` | GET | `authenticateApiKey()` — `src/lib/school-api-auth.ts` |

Key format `sk_school_*`, SHA-256 hashed, looked up in `school_api_keys` table — structurally parallel to but implementation-distinct from `public/v1/*`'s `authorizePublicApiKey()`/`public_api_keys` system. See Finding §5.2.

### 2.7 Pedagogy v2 (`dive/*`, `synthesis/*`, `rhythm/*`)
| Route | Methods | Auth | Flag |
|---|---|---|---|
| `dive/artifact`, `dive/history`, `dive/start`, `dive/state` | POST/GET | manual `getUser()`, 404-on-flag-off pattern [V] | `ff_pedagogy_v2_weekly_dive` |
| `synthesis/parent-share`, `synthesis/state` | POST/GET | manual `getUser()`, same 404 pattern | `ff_pedagogy_v2_monthly_synthesis` |
| `rhythm/today` | GET/POST | manual `getUser()` | `ff_pedagogy_v2_daily_rhythm` (+ nested `ADAPTIVE_REMEDIATION_FLAGS.V1` check inside) |
| `rhythm/remediation/[id]/resolve` | POST | RBAC | - |

None of these use `authorizeRequest`/permission codes — they use a bespoke "check session, then check flag, 404 if off" pattern documented in each file's header comment. Consistent across all 9 routes [V, sampled 3 of 9].

### 2.8 Foxy / Tutor / Learner Loop (`foxy/*`, `tutor/*`, `learner/*`, `learn/*`)
| Route | Methods | Auth | Client | Flag |
|---|---|---|---|---|
| `foxy/route` (main chat) | GET/POST | RBAC `foxy.chat` | A | `ff_digital_twin_v1` |
| `foxy/feedback`, `foxy/remediation` | POST | RBAC | A | - |
| `foxy/learning-action` | POST | RBAC | A+S | `ff_event_bus_v1` |
| `foxy/quiz-answer` | POST | GetUser (manual) | A+S | `ff_event_bus_v1` |
| `foxy/suggest-prompts` | GET | RBAC | S | - |
| `tutor/answer` | POST | GetUser | A+S | `ff_event_bus_v1` |
| `tutor/next` | GET | GetUser | S | `ff_tutor_bkt_v1` |
| `learner/next`, `learner/lesson/progress` | GET/POST | GetUser | A+S | `ff_event_bus_v1` |
| `learner/cards/create`, `learner/queue-from-scan`, `learner/review/grade` | POST | RBAC | A | `ff_scan_to_queue_v1` / `ff_event_bus_v1` |
| `learner/revise-stack`, `learner/scheduled`, `learner/weak-topics` | GET | GetUser | S | per-route flag (`ff_learner_loop_v1`, `ff_scheduled_actions_v1`, `ff_personalised_compete_v1`) |
| `learn/remediation` | GET | GetUser | S | `ff_distractor_micro_explainer_v1` |

Notable split: routes with a `student_id` request-scoping requirement mostly use `RBAC` with `{ requireStudentId: true }`; routes reading the "next learning action" state machine mostly use manual `getUser()` and re-derive student identity from the session — inconsistent pattern worth a follow-up architect/backend review (not a defect per se, but two idioms doing the same job).

### 2.9 Quiz / Exam / Diagnostic
| Route | Methods | Auth | Flag |
|---|---|---|---|
| `quiz/route`, `quiz/ncert-questions` | GET/POST | RBAC `quiz.attempt` / none-declared | - |
| `quiz/submit` | POST | RBAC | `ff_server_only_quiz_submit` |
| `exam/chapters` | POST | RBAC `exam.create` | - |
| `exams/papers`, `exams/papers/[id]`, `exams/papers/[id]/submit` | GET/POST/PATCH/PUT/DELETE | RBAC `exam.view` | `ff_competitive_exams_v1` |
| `exams/sync-mastery` | POST | RBAC | - |
| `diagnostic/start`, `diagnostic/complete` | POST | RBAC | - |
| `board-score` | GET/POST | RBAC | - |
| `state/decisions` | GET | RBAC (no permission code arg found — `authorizeRequest(request)` bare) | `ff_rule_engine_v1` |

### 2.10 Student / Parent / Teacher Portals
- **Student** (`student/*`, `students/*`, 15 routes): RBAC with `requireStudentId: true` on nearly every mutating route [V, sampled 4]. Two routes (`student/chapters`, `student/subjects`) use manual `getUser()` instead.
- **Parent** (`parent/*`, 21 routes): RBAC `child.view_progress` / `child.receive_alerts` / `profile.update_own` on 14 routes; manual `getUser()` on 7 — notably the entire link/consent/invite flow (`accept-invite`, `approve-link`, `consent`, `link-code/redeem` [+`verifyOtp`], `link-code/request-otp`) uses manual `getUser()` rather than RBAC, consistent with these being identity-linking bootstrap flows rather than data-access flows.
- **Teacher** (`teacher/*`, 14 routes): RBAC `class.manage` / `class.view_analytics` / `class.assign_remediation` on 13; `teacher/profile` uses a **manual Bearer + `getUser(token)`** pattern that bypasses `authorizeRequest` entirely — no permission-code check [V]. Same non-standard pattern found on `support/ticket`.

### 2.11 Pulse (`pulse/*`) — 4 routes, `ff_school_pulse_v1`-gated
All 4 use RBAC (`progress.view_own`, `class.view_analytics`, `institution.view_analytics`, bare `authorizeRequest(request)` on `student/[id]`). `pulse/school` additionally layers `resolveCommandCenterContext`-style school-admin resolution. Per constitution, `canAccessStudent` is the single cross-role data boundary enforced inside the handlers (not visible from the auth-helper grep alone — code-level check, not re-verified in this pass, `[S]`).

### 2.12 Internal Admin (`internal/admin/*`, `internal/agents/*`) — 11 routes, `x-admin-secret`
All gated by `requireAdminSecret()` [V] — a **separate mechanism from `super-admin/*`'s session-based `authorizeAdmin`**, sharing only the same `SUPER_ADMIN_SECRET` env var name space conceptually (constant-time header compare, no session/JWT). This is the `/internal/admin/*` pages' backing API, distinct product surface from `/super-admin/*`.

### 2.13 OAuth (`oauth/*`) — 2 routes
- `oauth/authorize` (GET) — no user-auth check found; publicly reachable by design (this is the authorize leg of an OAuth flow — the interactive login happens client-side before redirect back here in the actual PKCE flow, per file's own doc comment: "client_id required, code_challenge optional for public clients"). **Flagged for manual confirmation** — worth an architect look to confirm this isn't missing a user-session check before issuing an auth code (Finding §5.5).
- `oauth/token` (POST) — client_id + client_secret_hash compare, standard OAuth2 client-credential/token-exchange pattern.

### 2.14 Public / unauthenticated by design (verified, not gaps)
`health`, `v1/health` (uptime probes), `error-report`, `client-error` (client telemetry ingestion, in-file rate-limited), `feature-flags/check`, `feature-flags/voice` (public flag reads), `alfabot/*` (3 routes — public marketing widget, layered Upstash rate limits: burst/daily/ip-daily/lead), `tenant/config` (explicitly documented "Auth: none — public branding info by design", 5-min cached), `schools/trial`, `schools/claim-admin` (pre-signup / pre-login flows by necessity), `super-admin/login`, `public/v1/openapi`.

---

## 3. Supabase Edge Functions (`supabase/functions/*`, excluding `_archive`)

49 live functions. Grouped by trigger type.

### 3.1 Cron / scheduled (internal service-to-service, no browser caller)
| Function | Trigger | Auth | Purpose |
|---|---|---|---|
| `daily-cron` | Vercel Cron (`/api/cron/daily-cron` proxy, 02:30 UTC) + historical pg_cron (now disabled, migration `20260505100000`) | `verifyInternalCronRequest` (shared) + `CRON_SECRET` | Orchestrates 20 nightly steps (§4) |
| `queue-consumer` | Cron/manual invoke | `verifyInternalCronRequest` (shared) | Dequeues `task_queue`: quiz_processing (BKT+SRS+XP), notification_batching, ai_response_processing |
| `projector-runner` | pg_cron via pg_net, every 1 min (migration `20260524110002`) | `verifyInternalCronRequest` (shared) | Event-sourcing projector runner |
| `projector-health-check` | pg_cron via pg_net, every 2 min | `verifyInternalCronRequest` (shared) | Projector lag/health monitor |
| `synthetic-host-monitor` | scheduled | `verifyInternalCronRequest` (shared) | Catches white-label tenant-resolution regressions in prod |
| `data-erasure-purger` | scheduled | `verifyInternalCronRequest` (shared) | Stage 2 of parent-initiated child-data erasure (DPDP S15) |
| `verify-question-bank` | scheduled/cron | `verifyInternalCronRequest` (shared) | Runs the quiz-oracle grader over `question_bank` rows |
| `monthly-synthesis-builder` | `x-cron-secret` (direct, documented "same convention as daily-cron") + triggered thin from `daily-cron`'s `triggerMonthlySynthesis` step | `CRON_SECRET` header | Builds Pedagogy v2 monthly synthesis bundle per student/month |
| `coverage-audit` | `supabase functions schedule` cron `30 21 * * *` (03:00 IST) | `CRON_SECRET` + Bearer [G] | Nightly NCERT syllabus RAG-coverage drift + auto-disable of low-verified-ratio grounded-AI pairs |
| `account-purge` | scheduled | `CRON_SECRET` + Bearer [G] | Account/data purge job |
| `alert-deliverer` | pg_cron via pg_net (`x-cron-source: pg_cron`) or direct `CRON_SECRET`/service-role | `CRON_SECRET` + Bearer, constant-time [V] | Delivers observability alerts (Slack/email) |
| `webhook-dispatcher` | Nightly thin-trigger from `daily-cron` (`triggerWebhookDispatcher` step) or ad hoc operator call | `x-cron-secret` \| `Authorization: Bearer` \| `?token=` | Outbound HMAC-signed webhook delivery to school-admin-registered sinks |
| `send-pre-debit-notice` | `/api/cron/pre-debit-notice` Next.js proxy, `0 */6 * * *` | `CRON_SECRET` [G] | RBI e-mandate pre-debit compliance email |
| `send-renewal-reminder` | scheduled (school contract renewal) | unclear [G — not conclusively classified, verify manually] | Bilingual school renewal-reminder email |

### 3.2 HTTP-invoked (called from Next.js API routes or directly from client/mobile)
| Function | Called from | Auth | Purpose |
|---|---|---|---|
| `identity` | Client/mobile direct invoke (no Next.js proxy found in this pass) [G, unverified caller] | Bearer JWT [G] | Resolves Supabase JWT → student identity + feature flags ("Microservice #1") |
| `session-guard` | Client/mobile direct invoke [G, unverified caller] | Bearer JWT [G] | Enforces `MAX_SESSIONS = 2` concurrent-session cap |
| `scan-ocr` | `src/app/api/scan-solve/route.ts` | Bearer JWT [G] | Worksheet OCR pipeline |
| `export-report` | `src/app/api/parent/report/route.ts` | Bearer JWT [G] | PDF report generation for teachers/parents |
| `parent-portal` | Called directly from `src/app/parent/*` client pages (bypasses Next.js API layer — Finding §5.6) | Bearer JWT [G] | Serves parent-portal linked-children data |
| `teacher-dashboard` | Called directly from `src/app/teacher/*` client pages (same pattern) | Bearer JWT [G] | Class management, mastery heatmaps |
| `cme-engine` | AI-engineer-owned (Cognitive Mastery Engine) | Bearer JWT [G] | Mastery computation actions |
| `ncert-solver` | AI-engineer-owned | Bearer JWT + `resolveSecurityPrincipal` [G] | NCERT-grounded question solver pipeline |
| `ncert-question-engine` | AI-engineer-owned | `resolveSecurityPrincipal` [G] | Question generation/selection |
| `nep-compliance` | admin/school-facing | Bearer JWT [G] | NEP 2020 Holistic Progress Card generation |
| `grade-experiment-conclusion` | `src/app/api/student/grade-conclusion/route.ts` (Tier 3 R10) | Bearer JWT [G] | Grades free-text guided-experiment conclusions |
| `board-score` | `src/app/api/board-score/route.ts` + `src/app/api/cron/board-score/route.ts` | Bearer JWT [G] | BoardScore™ v1 computation |
| `alfabot-answer` | `src/app/api/alfabot/route.ts` | unclear [G — no obvious internal auth found, likely relies on the Next.js layer's own rate-limit/anon-id gate before invoking] | AlfaBot chat turn: KB retrieval + gpt-4o-mini streaming + guardrails |
| `alfabot-send-inquiry` | `src/app/api/alfabot/inquiry/route.ts` | Bearer JWT [G] | AlfaBot "submit your query" mailer |
| `whatsapp-notify` | `src/app/api/notifications/whatsapp/route.ts` | Bearer JWT [G] + internal caller signature (`buildInternalCallerHeaders`, per calling route) | WhatsApp Cloud API template messages |
| `quiz-generator` | AI-engineer-owned | Bearer JWT [G] | AI-enhanced adaptive quiz question selection (the ONLY live generator — `quiz-generator-v2` is archived, never shipped) |
| `grounded-answer` | **Deprecated** — logs `api_deprecated_edge_function_hit` on every call, canonical replacement is `/api/foxy` [V] | `resolveSecurityPrincipal` + quota reservation | Legacy grounded-AI answer pipeline, internal-only compatibility shim |
| `invoice-generator` | school-admin billing flow (caller not confirmed in this pass) | unclear [G] | GST-compliant PDF invoice generation |

### 3.3 Admin-only bulk content pipeline (HTTP, service-role/admin-gated)
`bulk-jee-neet-curated-import`, `bulk-jee-neet-import`, `bulk-non-mcq-gen`, `bulk-question-gen`, `embed-diagrams`, `embed-ncert-qa`, `embed-questions`, `extract-diagrams`, `extract-ncert-questions`, `generate-answers`, `generate-concepts`, `generate-embeddings` — all self-documented "Admin-only endpoint" in their header comments [V, sampled headers]; auth pattern not conclusively grep-matched for most (likely a service-role Bearer check inline rather than the shared `_shared/security/` module — **needs a follow-up read-through**, marked `[G, low-confidence]`). These are AI-engineer/content-pipeline owned, not backend's routes to author, but they sit in the same `supabase/functions/` tree.

### 3.4 Auth-lifecycle email hooks
| Function | Trigger | Purpose |
|---|---|---|
| `send-auth-email` | Supabase Auth "Send Email" hook (fired by GoTrue on signup/reset, MUST return HTTP 200 on all paths per P15) | Branded auth emails (verification, reset) |
| `send-welcome-email` | Called post-signup (caller not traced in this pass) | Role-specific welcome emails |
| `send-transactional-email` | School-onboarding flows (trial provisioned, etc.) | Transactional emails |

### 3.5 Shared library (`_shared/`)
Not a callable function; utility modules imported by the above. Notable subdirectories: `security/` (`internal-cron-auth.ts`, `auth.ts`, `policy.ts`, `quota.ts`, `circuit.ts`, `audit.ts`, `attribution.ts`, `request-signature.ts` — the shared auth/quota/audit spine used by `grounded-answer` and a subset of cron functions), `mol/`, `rag/`, `state-runtime/`.

---

## 4. Background Jobs

### 4.1 Vercel crons (`vercel.json`) — 13 scheduled jobs, all Next.js API routes
See §2.2 table for the full schedule. `maxDuration` overrides: `daily-cron`, `irt-calibrate`, `board-score`, `internal/cron/fix-failed-questions` get 300s; other `cron/*` get 60s; everything else 30s (15s for `.tsx`).

### 4.2 pg_cron (Postgres-native, migrations)
- **`alfanumrik-daily-cron`** — **disabled** as of migration `20260505100000_disable_pg_cron_daily_in_favor_of_vercel.sql`; Vercel Cron is now the canonical trigger for `daily-cron`. Guarded so `db push` no-ops on environments without `pg_cron` installed (staging/dev/DR).
- **`mol_shadow_text_buffer_sweeper`** (migration `20260520000001`) — every 6h, batch-deletes up to 10k expired rows from `mol_shadow_text_buffer` (7-day hard TTL, belt-and-braces alongside the grader's on-success DELETE).
- **`recompute_subject_content_readiness_daily`** — pg_cron at 03:30 UTC, refreshes `subject_content_readiness_daily` + `subjects.is_content_ready`.
- **`projector_runner_cron`** (migration `20260524110002`) — schedules `projector-runner` Edge Function via pg_cron+pg_net every 1 min; migration comment notes the target environment **does NOT currently have `pg_cron` installed**, so this schedule is presently a no-op there (skips cleanly, no behavioral impact per the migration's own note).

### 4.3 `daily-cron` step list (20 steps, `Promise.allSettled` — isolated failures)
`streaks_reset`, `leaderboard_entries`, `parent_digests_sent`, `task_queue_rows_deleted`, `health_snapshot`, `education_intelligence_rollup`, `ml_retrain_new_responses`, `performance_scores_recalculated`, `challenges_generated`, `streaks_managed`, `lab_completions_logged`, `contract_reminders_sent`, `contracts_expired`, `contract_grace_audited`, `monthly_synthesis_triggered` (flag-gated), `adaptive_remediation_triggered` (flag-gated), `twin_snapshots_built` (flag-gated), `webhook_deliveries_dispatched`, `foxy_expectations_expired`, `mol_shadow_pairs_graded`, `purge_principal_ai`, `first_quiz_nudges_sent` — 22 actions total in the current `createDailyCronActions()` call [V, counted from `Deno.serve` handler in `supabase/functions/daily-cron/index.ts`].

### 4.4 `queue-consumer` flows
Dequeues `task_queue` rows by `queue_name`: `quiz_processing` (BKT mastery update + spaced-rep card generation + XP credit), `notification_batching` (in-app notifications from trigger events), `ai_response_processing` (topic-mastery signal extraction from Foxy sessions).

---

## 5. Webhooks & External Integrations

| Integration | Direction | Endpoint(s) | Auth |
|---|---|---|---|
| Razorpay | Inbound | `POST /api/payments/webhook` | HMAC-SHA256 signature (`x-razorpay-signature` header vs `RAZORPAY_WEBHOOK_SECRET`), verified before any DB read [V — P11 compliant] |
| School-admin outbound webhooks | Outbound | Subscriptions managed via `POST/GET/DELETE /api/school-admin/webhooks`, delivered by `webhook-dispatcher` Edge Function | HMAC-signed at delivery time; subscription creation requires `public_api.manage` + SSRF-guarded target URL |
| Email (transactional + auth) | Outbound | `send-auth-email` (GoTrue hook), `send-welcome-email`, `send-transactional-email`, `send-pre-debit-notice`, `send-renewal-reminder`, `alfabot-send-inquiry` | Edge Function secrets (not `.env`), per CLAUDE.md |
| WhatsApp (Meta Cloud API) | Outbound | `POST /api/notifications/whatsapp` → `whatsapp-notify` Edge Function | Internal caller signature (`buildInternalCallerHeaders`) between the Next.js route and the Edge Function |
| OCR (worksheet scan) | Internal | `POST /api/student/scan-upload`, `POST /api/scan-solve` → `scan-ocr` Edge Function | RBAC (Next.js side), Bearer JWT (Edge Function side) |
| Sentry | Outbound (errors) | Client errors tunneled through `/monitoring` (configured in `next.config.js`, bypasses ad-blockers) | N/A |
| PostHog | Outbound (analytics) | Referenced in `foxy/quiz-answer`, `learner/next`, `payments/create-order`, `payments/webhook`, `quiz/submit`, `school-admin/students`, `school-admin/subscription`, `schools/join`, `super-admin/bulk-upload`, plus `super-admin/analytics/posthog-summary` (reads PostHog data back) | N/A |
| OAuth apps (3rd-party integrations) | Inbound | `GET /api/oauth/authorize`, `POST /api/oauth/token` | PKCE + `client_secret_hash`, managed via `super-admin/oauth-apps` |
| Public/partner ERP API | Inbound | `/api/public/v1/*` and `/api/v1/school/*` (two parallel systems — Finding §5.2) | API key |

---

## 6. Findings & Gaps (inventory only — no fixes performed)

**5.1 Two co-existing super-admin auth systems.** 98 of 119 `super-admin/*` routes use the session-based `authorizeAdmin(request, level)` (6-tier `admin_users` hierarchy); 21 use the RBAC permission-code path `authorizeRequest(request, 'super_admin.access')`. One route (`super-admin/alfabot/sessions/[sessionId]`) uses **both** in the same file. Functionally this may be intentional (RBAC path for routes that also need fine-grained non-admin roles to reach them; admin-session path for admin-only tooling) but the split isn't documented anywhere as a deliberate architecture choice — worth an architect confirmation of which new routes should use which.

**5.2 Two parallel school-scoped API-key systems.** `src/lib/public-api/auth.ts` (`authorizePublicApiKey`, backs `/api/public/v1/*`) and `src/lib/school-api-auth.ts` (`authenticateApiKey`, backs `/api/v1/school/*`, key prefix `sk_school_*`) are structurally near-identical (Bearer key → SHA-256 hash → table lookup → school-scoped tenant) but are separate code paths against what look like separate key tables (`school_api_keys` vs whatever `public-api/auth.ts` reads — not confirmed same/different table in this pass). This is either deliberate versioning (v1 legacy vs public v1 new) or duplicate infrastructure — flagged for architect/backend review, not fixed here.

**5.3 No single shared `CRON_SECRET` helper for Next.js routes.** Unlike Edge Functions (which mostly share `verifyInternalCronRequest` from `_shared/security/internal-cron-auth.ts`), the 18 Next.js `cron/*` routes each re-implement their own constant-time `CRON_SECRET` compare inline. Sampled 6 of 18 — all correct (constant-time, checked before I/O) but the duplication is a maintenance risk (one route drifting to a naive `===` compare would reintroduce a timing side-channel undetected).

**5.4 `cron/daily` (GET) looks like a dead/duplicate route.** Not present in `vercel.json`'s `crons` list, and its name closely shadows `cron/daily-cron` (which IS scheduled and is the documented canonical daily-cron proxy). Not read in full during this pass — flagged for a manual check on whether it's genuinely dead code, a manual-trigger-only endpoint, or a legacy route that predates the `daily-cron` proxy rename.

**5.5 `oauth/authorize` has no auth-mechanism grep hit.** The file's own doc comment frames this as intentional (PKCE flow, `client_id` required, no pre-existing session implied by the route itself), but this is exactly the kind of route where "looks public by design" and "missing an auth check" are easy to conflate. Recommend an architect read-through to confirm whether a user session is validated somewhere in the handler body before an authorization code is issued.

**5.6 `parent-portal` and `teacher-dashboard` Edge Functions are called directly from client pages**, bypassing the Next.js API route layer entirely (found via `functions/v1/parent-portal` / `functions/v1/teacher-dashboard` grep hits inside `src/app/parent/*.tsx` and `src/app/teacher/*.tsx`, not inside any `route.ts`). This is architecturally inconsistent with every other Edge Function, which is always fronted by a Next.js API route. Not necessarily wrong (Edge Functions do enforce their own JWT auth) but it means these two integration points sit outside the `authorizeRequest`/RBAC permission-code system entirely, and outside this backend agent's normal review surface for API-shape changes.

**5.7 Manual `getUser()`-only routes bypass the permission-code layer.** `teacher/profile`, `support/ticket`, and the parent link/consent/invite cluster (7 routes, §2.10) authenticate identity via `supabase.auth.getUser(token)` but never call `authorizeRequest()`, so there's no declared `permission.code` for these routes the way P9 (RBAC Enforcement) implies for the rest of the surface. For the parent-linking flows this is arguably correct (identity-bootstrapping, no student data yet in scope), but `teacher/profile` and `support/ticket` look like they should be on the standard RBAC path and may be legacy holdovers — flagged, not fixed.

**5.8 `grounded-answer` Edge Function is confirmed-deprecated** (self-logs `api_deprecated_edge_function_hit` with `canonical_route: '/api/foxy'` on every invocation) but is still present and callable, not removed. Matches the constitution's framing of `/api/foxy` as the active AI-tutor route; this function is a compatibility shim, not a gap, but worth noting it's still live surface area.

**5.9 Contract versioning is inconsistent.** The codebase has `v1/*` (18 routes, mostly RBAC), `v2/*` (10 routes, RBAC), `public/v1/*` (5 routes, API-key), and a large unversioned root surface (parent/teacher/student/school-admin/super-admin/etc — the majority of the 362 routes). There's no visible deprecation path or version-negotiation header; `v1` and unversioned routes coexist for overlapping concerns (e.g., `v1/child/[id]/progress` vs no unversioned equivalent, but `v1/leaderboard` vs `v2/student/leaderboard` both exist and appear to serve similar-but-not-identical purposes). Not read closely enough to say whether `v1`/`v2` are genuinely versioned iterations of the same contract or independently-evolved features that happened to land in versioned folders — flagged for assessment/architect to clarify the versioning policy.

**5.10 Routes absent from the constitution's "Critical File Map".** `CLAUDE.md`'s backend-agent section and `.claude/CLAUDE.md`'s file map explicitly enumerate only a small "owned" subset (health, child progress/report, class analytics, exam/create, performance, study-plan, upload-assignment, admin/roles, admin/audit-logs, error-report, plus the payment routes and edge functions). This is expected — those docs describe **exclusive ownership boundaries**, not a full API inventory — but it means there was previously no single document listing all 362 routes; this discovery doc is intended to fill that gap for the audit.

**5.11 Rate-limit inconsistency vs. constitution.** CLAUDE.md's Payment Rules skill states "general 60/min, parent login 5/min, admin 10/min" as the rate-limit policy, but `src/proxy.ts` [V] currently enforces `RATE_LIMIT_MAX = 600` req/min general (IP-wide, comment explains this was raised from a too-strict earlier value after a CEO-reported false-positive lockout), `RATE_LIMIT_PARENT_MAX = 20` req/min, and `RATE_LIMIT_ADMIN_MAX = 60` req/min for `/internal/admin/*`. All three numbers differ from the skill doc's stated policy — worth reconciling the skill doc with actual enforced values (or vice versa) in a follow-up, not fixed here since this is a discovery-only pass.

**5.12 Sampling caveats.** The per-route auth/client/flag/rate-limit columns in §2 were bulk-derived via `grep` pattern matching across all 362 files in one pass (`[G]`), not individually read. High confidence on the auth-mechanism classification (patterns are consistent and centralized through a small number of helper functions); lower confidence on: (a) exact permission-code string per route (only spot-verified for ~130 of ~150 RBAC routes), (b) whether "Client: A" (uses `supabase-admin`) always means the admin client does the actual privileged write vs. just being imported for a read that could've used the RLS-scoped client, (c) the `NONE/PUBLIC?` bucket (§2.14) — every entry there was individually manually re-checked in this pass and confirmed intentionally public or rate-limited, but any future addition to that list should get the same manual check rather than trusting the grep miss.
