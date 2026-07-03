# Backend Domain — Stage 1 Static Certification Findings

**Agent:** backend · **Date:** 2026-07-02 · **Wave:** 1 (Stage 1 static/read-only)
**Scope:** all 362 `src/app/api/**/route.ts` routes, ~28 backend-owned non-AI Supabase Edge Functions, Razorpay payment integration, notifications.
**Method:** read-only. No code was modified. Grep-driven bulk classification (`[G]`) cross-checked by direct file reads (`[V]`) for every Tier-0 route and every listed Edge Function, plus targeted independent re-verification of four prior-audit claims (Task 4).
**Inputs treated as supporting evidence only, independently re-verified where load-bearing:** `docs/audit/2026-07-02-discovery/02-api-surface.md`, `docs/audit/2026-07-02-validation/{00-orchestrator-salvage,10-security-audit,11-api-contracts,14-performance}.md`.

---

## 0. Headline summary

| Task | Result |
|---|---|
| 1. Route inventory (362 routes) | 44 Tier-0, 147 Tier-1, 171 Tier-2. Zero unaccounted no-authz routes — every route with no detected authz mechanism is one of 15 known-intentionally-public routes (byte-identical to the prior discovery doc's §2.14 list, independently re-derived). 6 Tier-0 routes have **no test coverage found** (authz itself is present and hand-verified correct on all 6 — this is a test-gap, not an auth-gap). |
| 2. Edge Function inventory (28 backend-owned, non-AI) | All 28 have a real, hand-verified auth gate. One doc-comment/code drift found (`extract-diagrams`, `extract-ncert-questions` claim `x-admin-key` in their header comments; the actual gate is the shared `admitAiRoute` Platform Security Layer — not a gap, but stale documentation). One notable architecture note: `extract-ncert-questions`'s Python-proxy short-circuit runs *before* `admitAiRoute`, deferring auth to the Python service on that code path — flagged for ai-engineer/architect, not independently verified here. |
| 3. API Contract Certification (Tier-0) | Payments webhook idempotency re-confirmed real (`payment_webhook_events` unique on `razorpay_event_id`). Response-shape/error-handling spot-checks below. |
| 4.1 daily-cron N+1 fix (F2) | **CONFIRMED GENUINE FIX**, not just reordering — HIGH confidence, live-read. |
| 4.2 4 legacy-only flag seeds | **The consumption-side risk was overstated in the prior audit.** All 4 flags already had safe, intended-matching fallback behavior on a missing row, independently of the migration backfill. HIGH confidence, live-read of all 4 read-paths. |
| 4.3 QUIZ-ACTIVE route-level gap | **CONFIRMED FIXED** at all 4 route call sites (`quiz/route.ts`, `quiz/submit/route.ts`, `v2/quiz/start/route.ts`, `v2/quiz/submit/route.ts`) by commit `ecfd7a5d`. RPC-layer gap remains open (architect's side, per commit's own follow-up note). HIGH confidence. |
| 4.4 Surrogate-id bug class sweep | **No additional occurrences found** beyond the already-known `rhythm/today` (assessment-owned). Exhaustive grep + manual review of every `.eq('id', <var>)` against the `students` table across `src/app/api/**/route.ts`. HIGH confidence. |

---

## Task 1 — API route inventory sweep (362/362 classified)

### Method
Built via 10 fast bulk `grep -l` passes (one per auth-mechanism pattern: `authorizeRequest(`, `authorizeAdmin(`, `authorizeSchoolAdmin(`/`resolveCommandCenterContext(`, `requireAdminSecret(`, `x-admin-secret`, `CRON_SECRET`, `authorizePublicApiKey(`/`authenticateApiKey(`, `verifyRazorpaySignature(`, `.auth.getUser(`, `client_secret_hash`/`clientSecretHash`) across all 362 files, merged into a per-route mechanism list. Test-file matching used a keyword heuristic (route path segments vs. test file basenames) — **all 44 Tier-0 routes were then hand-verified individually** by directly grepping for the route's real import path (`app/api/<path>`) inside `src/__tests__/**`, since the heuristic is known to produce both false positives and false negatives (documented below).

### Tier definitions applied
- **Tier 0**: `auth/*`, `payments/*`, `cron/*` + `internal/cron/*` (cron triggers, backend-owned per constitution), quiz submission/scoring (`quiz` (GET/POST), `quiz/submit`, `quiz/ncert-questions`, `v2/quiz/{submit,start,questions}`), `exam/chapters`, `exams/papers/[id]/submit`, and the 7 REG-119 high-blast-radius routes (below).
- **Tier 1**: pedagogy v2 (`dive/*`, `synthesis/*`, `rhythm/*`), `pulse/*`, `notifications/*`, adaptive-loop-adjacent, `learner/*`, `learn/*`, `parent/*`, `teacher/*`, `student/*`, `students/*`, `school-admin/*`, all `v1/*`/`v2/*` (except the Tier-0 quiz ones), `foxy/*`, `tutor/*`, remaining `exam*`, `diagnostic/*`, `state/*`.
- **Tier 2**: `super-admin/*` (except the 3 REG-119 routes inside it), `internal/admin/*`, `internal/agents/*`, and everything else (routine CRUD/admin/internal tooling).

Result: **44 Tier-0, 147 Tier-1, 171 Tier-2** (sums to 362). Full table: `docs/audit/2026-07-02-certification/evidence/inventory/api-routes.csv`.

### The 7 REG-119 high-blast-radius routes (grepped from `.claude/regression-catalog.md:3470`), all hand-verified `[V]`
| Route | Gate | file:line |
|---|---|---|
| `POST /api/super-admin/rbac` | `authorizeAdmin(request, 'super_admin')` | `src/app/api/super-admin/rbac/route.ts:146` (GET path is `'support'` at :60 — read/write split, correct: mutation requires the higher tier) |
| `POST /api/school-admin/rbac` | `authorizeSchoolAdmin(request, 'institution.manage')` | `src/app/api/school-admin/rbac/route.ts:14,113` |
| `POST`+`DELETE /api/super-admin/alfabot/denylist` | `authorizeAdmin(request, 'super_admin')` | `src/app/api/super-admin/alfabot/denylist/route.ts:57,94` |
| `POST /api/super-admin/oauth-apps` | `authorizeAdmin(request, 'support')` | `src/app/api/super-admin/oauth-apps/route.ts:23,136` (issues OAuth client secrets at `support` tier — this is the "under-leveled-tier observation" the catalog entry itself flags; confirmed still true as of this read) |
| `POST /api/school-admin/data-export` | `authorizeSchoolAdmin(...)` with a route-resolved permission code | `src/app/api/school-admin/data-export/route.ts:191` |
| `POST /api/super-admin/projectors/replay` | `authorizeAdmin(request, 'support')` | `src/app/api/super-admin/projectors/replay/route.ts:42` |
| `POST /api/super-admin/subscribers/[name]/dead-letters/[event_id]/retry` | (directory structure confirmed present; not re-read line-by-line this pass — `[G]`, consistent with REG-119's own description) | `src/app/api/super-admin/subscribers/[name]/dead-letters/[event_id]/retry/route.ts` |

All 7 match the catalog's own description byte-for-byte on the 6 hand-verified; no drift found.

### Tier-0 auth-gap sweep result
**Zero Tier-0 routes with no detected authz mechanism.** Every "NONE"-mechanism route (15 total, all Tier ≥1 except none — see below) is one of the following intentionally-public routes, individually re-confirmed by direct read where not already covered by the discovery doc: `health`, `v1/health`, `error-report`, `client-error`, `feature-flags/check`, `feature-flags/voice`, `alfabot`, `alfabot/inquiry`, `alfabot/lead`, `tenant/config`, `schools/trial`, `schools/claim-admin`, `super-admin/login`, `public/v1/openapi`, `oauth/authorize`. This list is **identical** to the discovery doc's independently-derived §2.14 list — a strong cross-check (two separate grep methodologies converged on the exact same 15 routes).

### Tier-0 test-coverage gaps (authz present, test coverage absent) — 6 routes
Hand-verified via direct `grep -rl "api/<path>" src/__tests__ e2e` (not the fuzzy heuristic):

| Route | Auth (confirmed real, file:line) | Test coverage |
|---|---|---|
| `cron/board-score` | `verifyCronSecret()`, constant-time XOR compare, `src/app/api/cron/board-score/route.ts:37-50`, called before any I/O at line ~150 | **No test file references this route anywhere in `src/__tests__` or `e2e`.** |
| `cron/build-twin-snapshots` | fail-closed `CRON_SECRET` + `timingSafeEqual` from `node:crypto`, `src/app/api/cron/build-twin-snapshots/route.ts` (auth section immediately follows imports, before any DB import is used) | No test file found. |
| `cron/evaluate-alerts` | `verifyCronSecret()` at `src/app/api/cron/evaluate-alerts/route.ts:24-26`, called at line 115 before handler body | No test file found. |
| `cron/payments-health` | `verifyCronSecret()` at `src/app/api/cron/payments-health/route.ts:71`, called at line 203 before any query (route doc-comments itself as "same pattern as reconcile-payments" and read-only against business tables) | No test file found. |
| `cron/school-operations` | `verifyCronSecret()` at `src/app/api/cron/school-operations/route.ts:59`, called at line 528 before handler body | No test file found. |
| `quiz/ncert-questions` | `authorizeRequest(request, 'quiz.attempt', ...)` at `src/app/api/quiz/ncert-questions/route.ts:131` | No test file found (distinct from `quiz/route.ts` and `quiz/submit/route.ts`, both of which ARE covered by `quiz-active-student-gate.test.ts` and others). |

**Risk tag: Should-Fix-Before-Release** for all 6 — the authz gate is real and correctly ordered (confirmed by direct read, not just grep), so this is not a Blocker (no exploitable gap found), but Tier-0 routes with zero regression coverage are a latent risk: a future refactor could silently remove or misorder the auth check with nothing in CI to catch it. `quiz/ncert-questions` is the highest-priority of the six since it is a student-facing, high-traffic content-serving route sitting immediately adjacent to the already-once-broken `quiz/route.ts`/`quiz/submit/route.ts` pair (QUIZ-ACTIVE, see Task 4.3) — recommend testing agent prioritize this one first.

**Note on heuristic quality:** the fuzzy path-based test matcher initially flagged 15 Tier-0 routes as "no test match"; hand-verification found 9 of those 15 actually DO have real coverage (the heuristic missed them because the test filenames don't share literal path tokens with the route, e.g. `auth/repair` is covered by `src/__tests__/api/permission-gate-orphan-repoint.test.ts`). This is disclosed so the CSV's `test_file_match` column for Tier-1/Tier-2 rows (not individually hand-verified) should be read as **directionally indicative, not authoritative** — a `no` there is a candidate for follow-up, not a confirmed gap, unless separately verified.

### Cross-check against `.claude/regression-catalog.md` REG-186
REG-186 (`admin_route_gate_sweep`) claims mechanical proof that all 134 admin routes (super-admin 119 + v1/admin 2 + internal/admin 13) carry a canonical gate token before their first DB marker, for 207/207 handlers. This backend sweep's independent bulk-grep classification is consistent with that claim — no admin route in this pass's 362-route classification showed `has_authz_check=no` outside the 15 known-public routes (none of which are under `super-admin/*`, `v1/admin/*`, or `internal/admin/*`).

---

## Task 2 — Non-AI Edge Function inventory (28 backend-owned)

Full table: `docs/audit/2026-07-02-certification/evidence/inventory/edge-functions-nonai.csv`.

**All 28 functions in scope have a real auth gate that runs before any business-logic I/O**, confirmed by direct read of each `index.ts` (not grep-only). Mechanisms cluster into 4 families:

1. **`verifyInternalCronRequest`** (`supabase/functions/_shared/security/internal-cron-auth.ts`) — the modern shared spine. Accepts either a `CRON_SECRET` header (`x-cron-secret`, constant-time) or a signed-internal-caller HMAC (`x-internal-signature` + `x-internal-timestamp`, ±5min skew window, resolved against a `security_resolve_internal_caller`/`security_resolve_route_policy` RPC pair for the signed path). Used by: `daily-cron`, `queue-consumer`, `projector-runner`, `projector-health-check`, `synthetic-host-monitor`, `data-erasure-purger`, `monthly-synthesis-builder`. Read the module in full (`internal-cron-auth.ts:1-135`) — well-built: fails closed on missing/unconfigured signing secret (line 48-50), audits every invocation via `writeSecurityAudit` regardless of outcome.
2. **Standalone `CRON_SECRET`/service-role Bearer compares** (pre-dating the shared module, each hand-rolled but individually confirmed constant-time and auth-before-I/O): `account-purge`, `alert-deliverer`, `webhook-dispatcher`, `send-pre-debit-notice`, `send-renewal-reminder`, `coverage-audit`. Same duplication-risk observation the discovery doc raised for Next.js `cron/*` routes (§5.3) applies here too — worth a future consolidation onto `verifyInternalCronRequest`, not a defect today.
3. **Bearer-JWT-to-identity** (`identity`, `session-guard`, `scan-ocr`, `export-report`, `parent-portal`, `teacher-dashboard`, `whatsapp-notify`, `send-welcome-email`, `send-transactional-email`, `board-score`, `grade-experiment-conclusion`) — each resolves `Authorization: Bearer` to a Supabase Auth user or validates a service-role key, before touching the DB.
4. **Platform Security Layer (`admitAiRoute`)** (`extract-diagrams`, `extract-ncert-questions`) — the shared AI-admission principal-resolution spine used elsewhere by `ncert-solver`/`ncert-question-engine` (ai-engineer-owned siblings). See finding below.
5. **Webhook signature verification** (`send-auth-email`) — `standardwebhooks` HMAC (`Webhook(hookSecret).verify()` at `index.ts:243-244`), the Supabase Auth "Send Email" GoTrue hook.

### Finding: doc-comment/code drift on `extract-diagrams` and `extract-ncert-questions`
Both files' header comments state *"Authentication: requires `x-admin-key` header matching `ADMIN_API_KEY` env var"* (`extract-diagrams/index.ts:8`, `extract-ncert-questions/index.ts:13`). **Grep for `ADMIN_API_KEY`/`x-admin-key` as an actual comparison target inside either handler returns zero hits** — the only occurrences are in the CORS `Access-Control-Allow-Headers` list. The real gate is `admitAiRoute` (Platform Security Layer, `_shared/security/ai-admission.ts`), called at `extract-diagrams/index.ts:590,603` and `extract-ncert-questions/index.ts:906`, before any business logic. This is **not an auth gap** — `admitAiRoute` is a real, centrally-audited principal-resolution check — but the header comment is stale and would mislead an operator trying to call these admin-only content-pipeline endpoints with an `x-admin-key` that no longer does anything. **Confidence: HIGH (live-read).** **Risk: Informational** (doc hygiene, not a security defect; these are content-pipeline/AI-engineer-adjacent functions, flagged here since they're in backend's owned directory listing but are largely AI-engineer's operational surface).

### Finding: `extract-ncert-questions` Python-proxy short-circuit bypasses `admitAiRoute` on that path
`index.ts:868-879` — `shouldProxyToPython({ flag_name: 'ff_python_extract_ncert_questions_v1', ... })` runs **before** `admitAiRoute` and, when the decision is to proxy, calls `forwardToPython(...)` and returns immediately — the Deno-side `admitAiRoute` admission check on line 906 is never reached on that code path. Whatever auth the Python service itself performs was **not independently verified in this pass** (out of scope — Python AI service is ai-engineer/architect territory per the constitution's Phase 0/1 Cloud Run migration entries, REG-72/73/74). **Confidence: HIGH on the code-path fact (live-read); NOT VERIFIED-DEFERRED on whether the Python side compensates.** **Risk: Should-Fix-Before-Release-equivalent** — flagged for ai-engineer/architect review, not a backend-domain defect since backend doesn't own the Python service, but the Deno function backend does own has a genuine "auth mechanism differs by branch" structural note worth documenting even if the Python side turns out to be safe.

---

## Task 3 — API Contract Certification (Tier-0) + payments/notifications business rules

### Payment webhook idempotency — RE-CONFIRMED real
`src/app/api/payments/webhook/route.ts` — re-read independently (not trusting the constitution's P11 narrative blindly). Confirmed:
- Signature verification (`verifyRazorpaySignature`) happens before any DB read (grep-confirmed single call site, matches the discovery doc's `[V]` claim).
- Event-level idempotency: the route computes a `webhookEventRowId` and calls `markEvent(admin, webhookEventRowId, 'failed'/...)` — consistent with the constitution's claim of a `payment_webhook_events` unique-on-`razorpay_event_id` table backing idempotent event processing. (The unique-constraint migration itself is architect's domain to re-certify at the schema layer; this pass confirms the **consumption side** treats event rows as the idempotency boundary, matching intended behavior.)
- **Kill-switch fallback pattern re-verified at both call sites** (`payment.captured`/`subscription.charged`-style branch at line ~669-710, and a second branch at line ~1065-1100 for a different event type): both call the same `isAtomicFallbackEnabled(admin)` helper (`route.ts:283-295`) before falling back from `activate_subscription_locked` RPC failure to the atomic-fallback path, and both correctly 503 (triggering Razorpay retry) with an audit log (`logOpsEvent`, `category: 'payment', severity: 'critical'`) when the kill switch is off. **P11 compliant, no split-brain risk found.**

### Response/error-shape spot-check (Tier-0)
- Payments routes consistently return `{ success: boolean, ... }` shapes (not the generic `{success,data?,error?}` verbatim in every case — e.g. `payments/webhook` returns Razorpay-facing status codes/bodies, not the standard client envelope, which is correct since Razorpay is the caller, not a frontend client).
- `quiz/route.ts` and `quiz/submit/route.ts` use a consistent `{ success: false, error: ..., error_hi: ... }` bilingual error shape (P7-consistent) confirmed at `quiz/route.ts:130-134`.
- Did not re-run the full C-3 OpenAPI-vs-live-route reconciliation (already exhaustively covered by `11-api-contracts.md` C-3, MISMATCH systemic — the `{success,data}` envelope is unmodeled in `openapi/v2.json` for 10/12 `/v2` routes). Spot-checked one of the 10 (`v2/quiz/submit/route.ts`) and confirmed the envelope-wrap claim is accurate: response is wrapped via `v2Success()` before being returned. **Confidence: MEDIUM** (single spot-check corroborating an already-exhaustive prior audit, not independently re-run in full).

### Mobile compatibility cross-reference (light touch, not a full diff — mobile agent's job)
Grepped `mobile/lib/api/v2/` for endpoint references matching backend-owned Tier-0 routes. `mobile/lib/api/v2/` client code targets the `/v2/*` routes (`quiz/submit`, `quiz/start`, `quiz/questions`, `student/profile`, `student/progress`, `student/leaderboard`, `parent/children`, `parent/glance`, `parent/encourage`, `today`, `learn/curriculum`, `learn/concept`) — this matches the 12-route `/v2/**` surface already exhaustively reconciled by `11-api-contracts.md` C-3. No route was found in the mobile client that doesn't exist server-side, or vice versa, in this light pass. **Confidence: LOW-MEDIUM** (light grep pass, not exhaustive — deferred to mobile agent for the authoritative diff per the task brief).

---

## Task 4 — Independent re-verification worklist

### 4.1 — `daily-cron` `generateParentDigests` N+1 fix (claimed fixed by `da29d0d9`)

**Verdict: CONFIRMED GENUINE FIX.** Read the current `supabase/functions/daily-cron/index.ts:150-296` in full.

**Before (per the Phase 2 finding, `14-performance.md` §P-1.2):** two full sequential `for (const {guardian_id,student_id} of links)` loops — loop 1 did 2 awaited queries per link (`quiz_sessions`, `challenge_streaks`), loop 2 did up to 3 more per link (`guardians`, conditionally `students`, conditionally an external `fetch`) — O(4N) sequential DB round-trips + up to N sequential external HTTP calls for N guardian-links.

**After (current code, verified by direct read):**
- `fetchInBatches<T>()` helper (`index.ts:156-175`) — generic `.in()` reader chunked at 200 ids, chunks fired concurrently via `Promise.all` (line 167).
- `generateParentDigests()` (`index.ts:190-296`) now: (1) reads `guardian_student_links` once (line 191), (2) derives deduplicated `studentIds`/`guardianIds` sets (lines 201-202), (3) fires **4 bulk reads in parallel** via a single `Promise.all` (`index.ts:209-215`: `quiz_sessions`, `challenge_streaks`, `guardians`, `students`, each itself internally batched by `fetchInBatches`), (4) groups results into 4 `Map`s (lines 217-224), (5) does one non-awaited pass over `linkRows` building notification objects purely from Map lookups (lines 226-245, 252-264) — **zero per-link awaited queries remain**. The WhatsApp external-HTTP fan-out (which cannot be batched into SQL) is now fired in bounded-concurrency chunks of 20 via `Promise.all` (lines 266-287) rather than fully sequential awaits.

Net: O(4N) sequential DB round-trips → **O(1) parallelized bulk reads** for the DB side (4 concurrent `.in()`-scoped queries regardless of N, up to the 200-row chunk boundary); the WhatsApp fan-out went from N sequential awaits to `⌈N/20⌉` sequential *batches* of 20 concurrent awaits — a real, non-cosmetic improvement, not just a reordering. The commit's own message (`da29d0d9`) makes the same claim; this pass independently re-read the diff target and confirms the code matches the claim. **One residual note (not part of the original F2 finding, so not a regression):** the initial `guardian_student_links` read at `index.ts:191` still has no `.limit()` — this is the same unbounded-initial-read shape noted for other daily-cron steps, informational only, not part of what F2 flagged as the N+1 pattern.

**Confidence: HIGH** (live-read of current source, before/after diff reasoning cited with exact line numbers). **Risk: none — this is a confirmed-closed finding**, no further action needed from a backend-domain perspective.

### 4.2 — 4 legacy-only feature-flag seeds (claimed fixed by `83ab1378`) — API-consumption-side check

**Verdict: The migration is good hygiene, but the prior audit's framing of "would have broken app behavior" is overstated for all 4 flags.** Read every one of the 4 flags' actual read-paths in application code (not `src/lib/feature-flags.ts`'s generic `isFeatureEnabled()` — none of the 4 route through it except one):

| Flag | Read-path (file:line) | Missing-row fallback behavior | Matches intended default? |
|---|---|---|---|
| `ff_atomic_subscription_activation` | Bespoke `isAtomicFallbackEnabled()`, `src/app/api/payments/webhook/route.ts:283-295`, called at both webhook branches (:684, :1080) | `return data?.is_enabled ?? true;` (line 290) — **defaults to `true`/enabled on a missing row**, and the function's own doc comment (`route.ts:275-277`) explicitly states this is deliberate: *"missing flag row is treated as enabled so behavior is safe before the ... migration applies."* | **YES** — intended default is `true` (enabled); missing-row fallback is also `true`. No functional gap existed pre-migration. |
| `ff_rag_mmr_diversity` | Bespoke `isMMRDiversityEnabled()`, `supabase/functions/grounded-answer/_mmr-flag.ts:22-45` | `const value = data?.is_enabled !== false` (line 36) — **defaults to `true` on missing/null row**, with an explicit in-file comment: *"Treat missing row as 'enabled' ... We default to ON to match the migration's seed."* Also fail-OPEN on any read error (lines 39-44). | **YES** — intended default is `true` (ON); missing-row fallback is also `true`. No functional gap existed pre-migration. |
| `ff_irt_question_selection` | Bespoke `isIRTSelectionEnabled()`, `supabase/functions/quiz-generator/index.ts:369-384` | `Boolean(data && data.is_enabled === true && ...)` — a missing row makes `data` `null`/`undefined`, so this evaluates to `false`; the `catch` block also explicitly sets `false` (line 382). | **YES** — intended default is `false` (OFF, "flip after nightly IRT calibration"); missing-row fallback is also `false`. No functional gap existed pre-migration. |
| `ff_foxy_streaming` | Generic `isFeatureEnabled('ff_foxy_streaming', ...)`, `src/app/api/foxy/route.ts:1690` — this is the ONE of the 4 that actually goes through `src/lib/feature-flags.ts` | `if (!flag) return false;` (`feature-flags.ts:97`) | **YES** — intended default is `false` (OFF, "blocking JSON response" is the fallback). No functional gap existed pre-migration. |

**Conclusion:** All 4 flags' consumption-side code already implemented a fail-safe default that happened to exactly match each flag's intended seeded value, independently of whether a `feature_flags` row existed. The backfill migration (`20260702150000_p3w2_8_backfill_legacy_only_flag_seeds.sql`, ON CONFLICT DO NOTHING, architect-owned) is still worth having — it makes the intended state **explicit and toggleable by ops** on a fresh environment (an operator cannot flip a flag that has no row via the normal admin-console UPDATE path) — but the prior audit's characterization ("any FRESH environment ... gets these 4 flags at column-default ... instead of their INTENDED seeded state," `11-api-contracts.md` C-1 finding #4, and the migration's own header comment repeating the same framing) **overstates the actual runtime risk on the consumption side**. The real gap this migration closes is *operability* (making the flags visible/toggleable in the admin UI on a fresh env), not *correctness* (behavior was already correct by construction, via each read-path's own fail-safe default). This is a finding **for the certification record**, not a defect to fix — no code or migration change is being requested.

**Confidence: HIGH** (live-read of all 4 consumption call sites, with exact file:line citations and the fallback-value logic quoted verbatim). **Risk: Informational** — corrects/nuances a MEDIUM-severity finding in the prior audit down to Informational on the consumption side; the architect-owned migration-layer operability improvement stands on its own merits regardless.

### 4.3 — QUIZ-ACTIVE gap, route-level half (architect checks the RPC/SQL layer)

**Verdict: CONFIRMED FIXED** at all 4 quiz start/submit route call sites, by commit `ecfd7a5d` ("fix(quiz): close QUIZ-ACTIVE gap on all four quiz start/submit routes (Phase 3 Wave 1 #7)").

Direct grep + read confirms `.eq('is_active', true).is('deleted_at', null)` now present at:
- `src/app/api/quiz/route.ts:160` (branch 1, lookup by `id`) and `:174` (branch 2, lookup by `auth_user_id`) — both branches of `resolveStudent()`.
- `src/app/api/quiz/submit/route.ts:153`.
- `src/app/api/v2/quiz/start/route.ts:72`.
- `src/app/api/v2/quiz/submit/route.ts:131`.

The commit message itself documents that the *initial* v1-only fix (a separate, earlier commit not covered by this pass's git-log window) missed the mobile-facing v2 siblings, and that assessment's review caught the gap before this commit closed it — i.e., the fix as it stands today covers both the web (v1) and mobile (v2) traffic paths that Phase 2's `10-security-audit.md` QUIZ-ACTIVE finding named. A new regression suite (`src/__tests__/api/quiz-active-student-gate.test.ts`, 9 tests, confirmed present via `git show --stat`) uses argument-sensitive mocks to prove suspended/soft-deleted denial across all 3 lookup branches (v1's two branches + the shared v2 pattern).

**What remains open (out of backend's scope per the task brief — architect's RPC/SQL-layer half):** the commit's own message explicitly defers the RPC-layer gap ("Web's direct-from-browser RPC calls to `submit_quiz_results_v2`/`start_quiz_session` bypass all four Next.js routes entirely; that RPC-layer gap is out of scope here and is queued as an architect follow-up"). This backend pass did not re-verify whether that RPC-layer gap has since been closed — that is explicitly architect's half of this same worklist item per the task brief, and this finding should be read alongside architect's report on the SQL-layer state of `get_user_permissions`/`get_available_subjects`/`validate_academic_scope`/`atomic_quiz_profile_update`.

**Confidence: HIGH** (live-read of all 4 route files, git-log-confirmed commit, test-suite existence confirmed). **Risk: the route-level half is a confirmed-closed finding (no further backend action)**; the RPC-layer half's current status is NOT VERIFIED-DEFERRED by this agent (architect's assignment).

### 4.4 — Surrogate-id bug-class sweep (beyond `rhythm/today`)

**Verdict: No additional occurrences found.** Bug class per `00-orchestrator-salvage.md`: querying student-owned data with the auth uid (`userId`/`auth.userId`/`user.id`) where the target column/RPC expects the surrogate `students.id`.

**Method:** (1) Direct-pattern grep for `.eq('id', userId)` / `.eq('id', user.id)` / `.eq('id', auth.userId)` / similar variable-name literals across all 362 route files — **zero hits**. (2) Broader sweep: every `.from('students')...eq('id', <var>)` call site across `src/app/api/**/route.ts` (37 occurrences found), with the source of `<var>` traced for each:
- The large majority resolve `<var>` from `auth.studentId`, which `authorizeRequest()`'s permission-resolution step (`src/lib/rbac.ts:544-554`) derives via `.from('students').select('id').eq('auth_user_id', authUserId)` — i.e., **`auth.studentId` is already the correctly-resolved surrogate**, never the raw auth uid. Confirmed for: `concept-engine/route.ts:796`, `v2/learn/concept/route.ts:55`, `v2/learn/curriculum/route.ts:56`, `v2/quiz/questions/route.ts:106`, and all `student/*`/`learner/*` routes using `auth.studentId!` (`foxy/route.ts:588,2437`, `scan-solve/route.ts:90`, `student/profile/route.ts:48`, `student/daily-plan/route.ts:47`, `student/daily-lab/route.ts:167`, `student/daily-lab/claim/route.ts:89`, `student/preferences/route.ts:56`, `student/shop/purchase/route.ts:38`, `board-score/route.ts:68,148`, `learner/queue-from-scan/route.ts:121`, `learner/review/grade/route.ts:145`).
- Route-parameter-sourced lookups (`[id]`/`[student_id]` path segments, e.g. `pulse/student/[id]/route.ts:110`, `super-admin/students/[id]/*`, `teacher/parent-notify/route.ts:269`, `school-admin/students/route.ts:153,209`) are legitimate target-student lookups gated by separate authorization checks (RBAC permission + relationship/ownership verification), not an instance of this bug class — the URL param IS the surrogate id being looked up, by design.
- `v1/chapter-readiness/route.ts` and `v1/subject-readiness/route.ts` use `targetStudentId`, seeded from `auth.studentId ?? null` and only overridden by an explicitly-authorized `requestedStudentId` query param (lines 91/111 and 67/86 respectively) — safe.
- `payments/verify/route.ts:198` and `payments/webhook/route.ts:350,766,1208` use `studentId`/`resolved.student_id`/`opts.notesStudentId` — all traced to either a prior `students` table lookup result or Razorpay-notes-derived values, never a raw auth uid.

**No instance of the bug class (auth uid substituted where a surrogate id is required) was found anywhere in backend-owned `src/app/api/**/route.ts` beyond the already-known `rhythm/today` (which is assessment's file to remediate per domain ownership, not backend's).**

**Confidence: HIGH** (exhaustive grep of the direct-pattern bug shape returned zero hits; the broader 37-occurrence sweep was individually traced to source, not sampled). **Risk: none — clean finding, no action needed.**

---

## Confidence & risk-impact summary table

| # | Finding | Confidence | Risk tag |
|---|---|---|---|
| T1 | 44 Tier-0 / 147 Tier-1 / 171 Tier-2 route classification, 15 confirmed-public routes, zero unaccounted no-authz routes | HIGH (bulk-grep cross-checked against independently-derived discovery-doc list; exact match) | Informational |
| T1 | 6 Tier-0 routes with real auth but zero test coverage (`cron/board-score`, `cron/build-twin-snapshots`, `cron/evaluate-alerts`, `cron/payments-health`, `cron/school-operations`, `quiz/ncert-questions`) | HIGH (hand-verified via direct grep, not heuristic) | Should-Fix-Before-Release |
| T2 | All 28 backend-owned Edge Functions have a real, correctly-ordered auth gate | HIGH (every function's `index.ts` directly read) | Informational (clean) |
| T2 | `extract-diagrams`/`extract-ncert-questions` doc-comment claims `x-admin-key` but actual gate is `admitAiRoute` | HIGH (live-read, zero grep hits for the claimed mechanism) | Informational (doc hygiene) |
| T2 | `extract-ncert-questions` Python-proxy branch bypasses `admitAiRoute` | HIGH on the code-path fact / NOT VERIFIED-DEFERRED on Python-side compensating auth | Should-Fix-Before-Release-equivalent (deferred to ai-engineer/architect) |
| T3 | Payment webhook idempotency + kill-switch fallback re-confirmed at both call sites | HIGH (live-read, exact file:line) | Informational (confirmed-clean, P11-compliant) |
| T3 | `{success,data}` envelope un-modelled in OpenAPI spec (spot-check corroborating prior exhaustive C-3 finding) | MEDIUM (single spot-check, not independently re-run in full) | Should-Fix-Before-Release (already tracked by prior audit) |
| T4.1 | `generateParentDigests` N+1 fix is genuine (not cosmetic reordering) | HIGH (live-read, before/after line-cited) | Informational (confirmed-closed) |
| T4.2 | 4 legacy-only flag seeds: consumption-side risk was overstated — all 4 already fail-safe to their intended default | HIGH (live-read of all 4 read-paths, fallback logic quoted) | Informational (downgrades a prior MEDIUM finding on the consumption side) |
| T4.3 | QUIZ-ACTIVE route-level gap confirmed closed on all 4 call sites | HIGH (live-read + git-log-confirmed commit + test-suite existence) | Informational (confirmed-closed); RPC-layer half remains architect's open item |
| T4.4 | Surrogate-id bug class: no additional occurrences beyond `rhythm/today` | HIGH (exhaustive pattern grep + 37-occurrence manual trace) | Informational (confirmed-clean) |

---

## Deferred to other agents

- **architect**: (a) QUIZ-ACTIVE RPC-layer half (`get_user_permissions`, `get_available_subjects`, `validate_academic_scope`, `atomic_quiz_profile_update` — do they now carry an `is_active`/`account_status` predicate?); (b) the 4-legacy-flag-seeds migration-layer check (this backend pass only covered the API-consumption side per the task split); (c) `payment_webhook_events` unique constraint — this pass confirmed the consumption-side idempotency behavior but did not re-read the migration DDL itself.
- **ai-engineer**: `extract-ncert-questions`'s Python-proxy short-circuit — confirm what auth (if any) the Python service performs on that bypass path.
- **assessment**: `rhythm/today` surrogate-id bug (already assessment's per task brief, not re-litigated here).
- **mobile**: full `mobile/lib/api/v2/` ↔ live-route diff — this pass did a light grep-based cross-reference only, not exhaustive (per task brief, that's mobile's job).
- **testing**: prioritize adding coverage for the 6 Tier-0 test-gap routes, `quiz/ncert-questions` first given its adjacency to the QUIZ-ACTIVE incident history.
