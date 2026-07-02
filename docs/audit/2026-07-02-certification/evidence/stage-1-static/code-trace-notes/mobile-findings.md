# Mobile Domain — Stage 1 Static Certification Findings

Independent Production Certification, Wave 1 (Stage 1: static/read-only). Agent: mobile.
Scope: `mobile/` Flutter app only. Read-only pass — no code changed.
`docs/audit/2026-07-02-discovery/05-mobile.md` was read and used as supporting evidence
only; every load-bearing claim below was independently re-derived from source, not
copied from that doc. Divergences from the discovery doc are called out explicitly.

**IMPORTANT META-FINDING**: my own agent-definition prompt (the "Critical Sync Points"
table I was given at task start) asserts mobile currently hardcodes stale XP values
(5/10/20 vs web's 10/20/50) and stale usage limits (free quiz 3/day, starter chat
25/day). **Both claims are FALSE as of this pass** — see §5. Treat agent-definition
"known divergence" tables as historical/possibly-stale context, not current fact;
this report only asserts what was independently re-verified against current source.

---

## Task 1 — File-count reconciliation

Four numbers, exact commands, run from `D:\Alfa_local\Alfanumrik`:

| # | Command | Result | What it measures |
|---|---|---|---|
| 1 | `cd mobile && find . -type f \| wc -l` | **411** | Raw, zero exclusions. Includes `.dart_tool/` caches, `build/` output, `pubspec.lock`, everything. This is the source of the "411 files" broad-glob claim — confirmed exact match. |
| 2 | `find mobile -type d \( -name ".dart_tool" -o -name "build" -o -name ".gradle" -o -name ".idea" -o -name "Pods" -o -name ".git" \) -prune -o -type f -print \| wc -l` | **337** | Total real (non-generated-cache) files. Name-based prune catches BOTH the top-level `mobile/.dart_tool`/`mobile/build` AND the **nested** `mobile/lib/api/v2/.dart_tool` / `mobile/lib/api/v2/build` (build_runner's own build-cache for the generated OpenAPI client — see finding below). This is the number that should be used for "how many files does this app really have." |
| 3a | `find mobile/lib -name "*.dart" \| wc -l` | **217** | All `.dart` under `mobile/lib/`, **including** the nested generated-client package `mobile/lib/api/v2/` (97 client source files + 45 of the client's own boilerplate-generated tests, currently on disk because `build_runner` was run locally at some point — see below). |
| 3b | `find mobile/test -name "*.dart" \| wc -l` | **16** | App test suite only (`mobile/test/`, not the nested client's `mobile/lib/api/v2/test/`). |
| — | 217 + 16 | **233** | Reconciles to the "~234 dart files" claim (off by ~1, negligible — almost certainly the same broad `lib+test` glob that doesn't distinguish generated-client content from hand-written app content). |

**The reconciliation**: both prior claims are correct measurements of *different things*, not
a contradiction:
- "411 files" = raw `find` with **no exclusions** (everything on disk under `mobile/`).
- "234 dart files" = `*.dart` glob across `mobile/lib/` + `mobile/test/`, which **silently
  includes** the generated-and-gitignored `mobile/lib/api/v2/` OpenAPI client package
  (its own `lib/`, 97 files, and its own `test/`, 45 boilerplate files — 142 of the 233).

**A cleaner "how much hand-written app code is there" number**, run for this pass:
```
find mobile/lib -name "*.dart" -not -path "mobile/lib/api/v2/*" | wc -l   → 74   (app source)
find mobile/test -name "*.dart" | wc -l                                   → 16   (app tests)
74 + 16 = 90 truly hand-written, committed Dart files.
```
This **also diverges from the discovery doc**, which reports "46" hand-written source
files excluding the v2 client (`05-mobile.md` line 9). I listed all 74 files (see raw
tool output in this session) and every one is a legitimate, non-generated, committed
source file under `lib/{app.dart,main.dart,core/,data/,providers/,ui/}` — no `.g.dart`,
no test file, no duplicate. **74 is the reconciled figure for this pass; the discovery
doc's 46 appears to be an undercount** (possibly an earlier snapshot, or a narrower glob
that missed `lib/ui/screens/**` and/or `lib/core/**`). Flagged for backend/testing
cross-check if the "how big is the mobile app" number is load-bearing anywhere downstream.

**Structural discovery relevant to the count**: `mobile/lib/api/v2/` is not just a
directory of generated files — it is a **separate, self-contained Dart package**
(`alfanumrik_api_v2`, its own `pubspec.yaml`/`pubspec.lock`/`analysis_options.yaml`/
`README.md`/`.openapi-generator/` metadata, `openapi-generator` v7.11.0, `DartDioClientCodegen`)
consumed by the app via a local `path:` dependency (`mobile/pubspec.yaml:32-33`). Its
`*.g.dart` part files are `.gitignore`d (`mobile/lib/api/v2/.gitignore:8`) and regenerated
by `build_runner` — confirmed present locally (41 `*.g.dart` files on disk from a prior
local run) which is why `flutter analyze`/`flutter test` ran clean without me needing to
invoke `build_runner` myself.

---

## Task 2 — Mobile Compatibility Certification (report 12)

### Flutter compatibility
- **`flutter analyze`: CLEAN.** `No issues found! (ran in 23.3s)`, Flutter 3.41.9 stable
  (matches the version pinned in `.github/workflows/mobile-ci.yml:51`), Dart 3.11.5.
  Full raw output: `evidence/stage-1-static/local-command-output/mobile-flutter-analyze-test.log`.
- **`flutter test`: 146/146 PASS**, 0 failures, ~31s wall time. Every test is a **pure
  unit/widget test with mocked/faked collaborators** — no live Supabase, no live
  Razorpay, no live `/api/foxy` or `/v2/*` HTTP calls were made (confirmed by reading
  test names/bodies: `OfflineQuizSubmitter` fakes, `resolveFoxyUrlForTest`/
  `parseApiResponseForTest` static-method helpers, in-memory Hive-shaped stores, etc).
  This run required **no backend, no `.env`, no secrets** — fully Stage-1-safe.
  **Discrepancy with CI comment**: `mobile-ci.yml:7` says "flutter test (75/75)" as of its
  last-verified comment. Current count is 146/146. Not a functional problem — the test
  suite has grown since that comment was written (offline-replay tests, v2 parity tests,
  parent/today-copy tests all postdate it) — but the comment is now stale documentation,
  informational only.

### API parity — `/v2` contract-generated surface
- Confirmed an actual OpenAPI-generation pipeline exists and both sides trace to one
  Zod source: `src/lib/api/v2/contract.ts` → `npm run gen:openapi` → committed
  `openapi/v2.json` → `npm run gen:dart` (`openapi-generator-cli generate`, see
  `package.json:28-30`) → `mobile/lib/api/v2/`. Documented in
  `src/app/api/v2/README.md` (read in full).
- **CI enforcement of drift on the TS↔OpenAPI half**: `.github/workflows/openapi-contract.yml`
  runs `npm run gen:openapi:check` on any push/PR touching `contract.ts`/the generator
  scripts/`openapi/v2.json` and **fails the build if the committed spec is stale**. This
  is a real drift gate, not just documentation.
- **Dart-client-half regeneration is NOT committed** — `mobile/lib/api/v2/*.g.dart` and
  the openapi-generated model/api sources under `lib/api/v2/lib/` are regenerated fresh
  on every `mobile-ci.yml` run (`dart pub get && dart run build_runner build
  --delete-conflicting-outputs`, working dir `mobile/lib/api/v2`) — so "when was the Dart
  client last regenerated" is really "every CI run, from whatever `openapi/v2.json` is
  current at that commit." There is no drift window on the generated-Dart-source side by
  construction (it's never stale because it's never persisted).
- **12/12 route parity, both directions, zero orphans**: enumerated every `Future<Response<...>>`
  method across the 5 generated API classes (`learn_api.dart`, `parent_api.dart`,
  `quiz_api.dart`, `student_api.dart`, `today_api.dart`) and every route file under
  `src/app/api/v2/**`:

  | Web route | Mobile client method |
  |---|---|
  | `GET /v2/learn/concept` | `getLearnConcept` |
  | `GET /v2/learn/curriculum` | `getLearnCurriculum` |
  | `GET /v2/parent/children` | `getParentChildren` |
  | `POST /v2/parent/encourage` | `postParentEncourage` |
  | `GET /v2/parent/glance` | `getParentGlance` |
  | `GET /v2/quiz/questions` | `getQuizQuestions` |
  | `POST /v2/quiz/start` | `postQuizStart` |
  | `POST /v2/quiz/submit` | `postQuizSubmit` |
  | `GET /v2/student/leaderboard` | `getStudentLeaderboard` |
  | `GET /v2/student/profile` | `getStudentProfile` |
  | `GET /v2/student/progress` | `getStudentProgress` |
  | `GET /v2/today` | `getToday` |

  No orphaned web route, no orphaned Dart method. **HIGH confidence, IN SYNC.**
- **git-blame timing check** (as requested): `openapi/v2.json` and `src/lib/api/v2/contract.ts`
  were both last touched by commit `cb4bcec0` (2026-06-07). Mobile's tracked `lib/api/v2/`
  config (`pubspec.yaml`) was last touched by `f07c3062` (2026-06-06, one day earlier — CI
  wiring, not a contract change). **The web `/v2` route *files themselves* were most
  recently touched TODAY** by `ecfd7a5d` (2026-07-02) — but I read that diff and it only
  adds a `.eq('is_active', true).is('deleted_at', null)` filter to an internal Supabase
  query inside the route handler; it does **not** change any request/response shape, so
  it does not require (and did not trigger) contract regeneration. No drift found. **This
  same commit is the source of a live security-gap finding below — see "RPC-bypass gap."**

### Non-`/v2` REST + RPC + Edge Function surfaces (outside the generated contract)
Traced every non-`/v2` network call site in mobile source:

| Mobile call | Target | Verified against | Status |
|---|---|---|---|
| `SubscriptionRepository.createOrder` | `POST /payments/create-order` | `src/app/api/payments/create-order/route.ts` exists | IN SYNC |
| `SubscriptionRepository.verifyPayment` | `POST /payments/verify` | `src/app/api/payments/verify/route.ts` exists | IN SYNC |
| `SubjectsService.fetchAllowedSubjects` (`core/services/subjects_provider.dart`) | `GET /api/student/subjects` | `src/app/api/student/subjects/route.ts` exists | IN SYNC |
| `DailyPlanRepository.fetch` | `GET /api/student/daily-plan` | `src/app/api/student/daily-plan/route.ts` exists | IN SYNC (but see "orphaned repo" note below) |
| `ChatRepository._sendViaApi` (default path, `foxyEndpoint == 'api'`) | `POST /api/foxy` | `src/app/api/foxy/route.ts` exists | IN SYNC — correctly targets the **replacement** route per the 2026-07-01 `foxy-tutor` Edge Function retirement noted in `CLAUDE.md` |
| `ChatRepository._sendViaEdge` (legacy fallback, only reachable via `--dart-define=FOXY_ENDPOINT=edge`) | Edge Function `foxy-tutor` | `supabase/functions/` — **confirmed absent** (retired 2026-07-01) | **DEAD ENDPOINT.** Dormant for current default builds (`ApiConstants.foxyEndpoint` defaults to `'api'`, `mobile/lib/core/constants/api_constants.dart:86`) but the in-code comment describing this branch as a "preserved indefinitely for old builds in the wild" rollback path is **no longer true** — the rollback target was deleted server-side. Any already-installed APK still pointed at `edge` (an old default, or a manual override) will hard-fail every chat call. **Confidence: HIGH. Risk: Post-Release-Acceptable as a currently-dormant branch, but Should-Fix-Before-Release as documentation/dead-code hygiene** — the comment actively misleads a future maintainer into believing this is a safe rollback path. Deferred: ai-engineer/backend (owns the retirement), mobile (should update the comment and/or delete the dead branch in the next mobile PR). |
| `QuizRepository.startSessionForQuestions` (legacy, `useV2` OFF — **the default**) | RPC `start_quiz_session` (direct Supabase client, bypasses all Next.js routes) | Present in `supabase/migrations/00000000000000_baseline_from_prod.sql:7084` | Present, but see **RPC-bypass gap** below |
| `QuizRepository.submitAttempt` (legacy/v2, `useV2` OFF path uses `submit_quiz_results_v2` directly too) | RPC `submit_quiz_results_v2` (direct Supabase client) | Present at line 7594 of the same file | Present, but see **RPC-bypass gap** below |
| `LearningRepository.markCompleted` | RPC `add_xp` | Not independently re-verified this pass (best-effort/swallowed on failure per in-code comment — low blast radius) | NOT VERIFIED — deferred |
| `RoleProvider` | RPC `get_user_role` | Not independently re-verified this pass | NOT VERIFIED — deferred |

**Orphaned repository, confirmed**: `DailyPlanRepository` (`mobile/lib/data/repositories/daily_plan_repository.dart`)
calls a real, existing route (`/api/student/daily-plan`) but I could not find any
provider or screen that constructs/consumes it (`grep -rn "DailyPlanRepository\|daily_plan_repository" mobile/lib/providers mobile/lib/ui` — the widget `daily_plan_card.dart` exists but I did not find it wired into any route/screen in the router). Informational — landed-ahead-of-UI or genuinely dead code; not a contract-sync defect either way since the route itself is real and matches. Confidence: MEDIUM (repo-file-exists + no-consumer-found is what static reading can confirm; a live-app screen trace would be needed to fully rule out a consumer I missed).

### CRITICAL finding — RPC-bypass gap affects mobile's DEFAULT quiz path (Tier 0)

Commit `ecfd7a5d` (2026-07-02, today, `fix(quiz): close QUIZ-ACTIVE gap on all four quiz
start/submit routes`) added `.eq('is_active', true).is('deleted_at', null)` to the
**students lookup inside the four Next.js quiz routes** (`/api/quiz`, `/api/quiz/submit`,
`/v2/quiz/start`, `/v2/quiz/submit`) to stop a super-admin-suspended or soft-deleted
student with a still-valid JWT from starting/submitting quizzes and earning XP. The
commit message **explicitly states**: *"Web's direct-from-browser RPC calls to
`submit_quiz_results_v2`/`start_quiz_session` bypass all four Next.js routes entirely;
that RPC-layer gap is out of scope here and is queued as an architect follow-up."*

I independently confirmed by reading the RPC function bodies in
`supabase/migrations/00000000000000_baseline_from_prod.sql`:
- `start_quiz_session` (line 7084-7214): no `students.is_active`/`students.deleted_at`
  check anywhere in the body (the one `is_active = true` predicate present is on
  `question_bank`, not `students`).
- `submit_quiz_results_v2` (line 7594-7886): no `is_active`/`deleted_at` check at all.

**This directly affects mobile, not just web.** `ApiConstants.useV2` defaults to `false`
(`bool.fromEnvironment('USE_V2', defaultValue: false)`, `api_constants.dart:48`), which is
also what `mobile/build_apk.sh` ships unless `USE_V2=true` is explicitly exported at build
time. In the default (`useV2` OFF) configuration, `QuizRepository` calls
`start_quiz_session` / `submit_quiz_results_v2` **directly via the Supabase client SDK**
(`quiz_repository.dart:14-37` doc comment: *"`useV2` OFF (default) — ... submission goes
through `submit_quiz_results_v2`/`submit_quiz_results` RPCs. The generated `/v2` client is
never constructed or called on this path."*) — i.e. it goes straight to Postgres, never
touching the Next.js route layer that just got patched. **A suspended/soft-deleted
student with a live mobile session and a still-valid JWT can therefore still start and
submit quizzes and earn XP on the default mobile build, exactly the scenario this
morning's fix was meant to close.**

Note this is a **narrow, already-privileged-abuse surface** (requires the student account
to already be in a suspended/soft-deleted state while the device holds a live JWT) — not
an anyone-can-exploit hole — but it is a **live, currently-unpatched security/XP-integrity
gap reachable from the mobile app today**, not a hypothetical.

- **Confidence: HIGH** (direct code read of both the fix commit and the un-patched RPC bodies).
- **Risk: Should-Fix-Before-Release** (Tier 0 — auth + P2 XP integrity). Not classified
  Blocker only because the precondition (suspended/soft-deleted account + still-valid JWT)
  is itself an existing edge case the platform already tolerates for some window, and the
  commit's own author explicitly scoped the RPC-layer fix out as a tracked follow-up
  rather than treating it as launch-blocking.
- **Deferred to: architect** (owns the RPC-layer fix, per the commit's own stated
  follow-up), **assessment** (P2/XP-integrity sign-off), **mobile** (re-verify once the
  RPC-layer check lands — no mobile-side code change is needed if the fix is added inside
  the RPC bodies themselves, since both the `useV2` ON and OFF paths ultimately call the
  same RPCs).

### Authentication
- Supabase Auth, PKCE flow (`AuthFlowType.pkce`, referenced in discovery and consistent
  with `AuthInterceptor` reading `Supabase.instance.client.auth.currentSession` — same
  SDK-managed session object web's own Supabase clients use).
- `ApiClient`'s `_AuthInterceptor` (`mobile/lib/core/network/api_client.dart:78-87`)
  injects `Authorization: Bearer ${session.accessToken}` on every non-Supabase-SDK request
  from the **current in-memory session** — it does not proactively force-refresh before
  the call. This relies on `supabase_flutter`'s own background auto-refresh timer,
  standard SDK behavior, consistent with web.
- **Session-expiry handling gap (Should-Fix-Before-Release, MEDIUM confidence)**: a 401 from
  `ApiClient` maps to `NetworkException.unauthorized()` (`api_client.dart:61`) and is
  surfaced as a generic error to the caller. I found **no global handler** that reacts to
  a 401 (or to a Supabase `AuthChangeEvent.signedOut`/session-expired event) by forcing
  `signOut()` + a router redirect to `/login` — `signOut()` is only invoked from two
  explicit user-initiated UI actions (`settings_screen.dart:204`,
  `parent_glance_screen.dart:125`). Separately, `GoRouter`'s `redirect` callback
  (`app_router.dart:38-86`) only re-evaluates on navigation events or when its
  `refreshListenable` fires — and that listenable only listens to `roleProvider`, and
  **only when `useV2` is ON** (`app_router.dart:36-37`). So on the default (`useV2` OFF)
  build, a session that goes stale/gets revoked mid-session will not proactively bounce
  the user to `/login`; they'll sit on an authenticated screen seeing ad-hoc error
  messages from individual failed calls until they manually navigate or sign out. Not a
  data-exposure issue (RLS still gates every read/write server-side) but a real UX/session-
  hygiene gap. Deferred: mobile (own fix — add a global `onAuthStateChange` listener that
  drives the router), architect (confirm this doesn't also mask a server-side
  session-invalidation gap).

### Offline behavior (REG-91)
Located and read the full offline-replay implementation — **substantiated by code, not
just the regression catalog's word**:
- `mobile/lib/data/models/offline_quiz_models.dart` (357 lines) — `OfflineTodayBundle`
  and `QueuedQuizAttempt` value types. Explicit P-invariant guard-rail comments at the
  top of the file (lines 25-32) map directly to constitution P2/P3/P6/P13:
  - **P2**: no score/XP field exists on either type — "the device never grades."
  - **P3**: per-question + total timings stored verbatim, `withDrainAttempt()`
    (lines 269-283) provably only mutates the retry counter — `idempotencyKey`,
    `capturedAt`, `responses`, and `totalTimeSeconds` are threaded through unchanged
    (verified by reading the constructor call).
  - **P6**: `correctIndex` is hard-pinned to `-1` on **read** (`_questionFromJson`,
    line 190, comment: *"never trust a stored correct index — server is authoritative"*)
    regardless of what was persisted — so even a tampered local Hive box can't inject a
    fake correct answer back into the review UI.
  - **P13**: no PII fields present in either serialized shape (ids, indices, counts,
    and question option *text* the student already saw on-screen — nothing logged).
- `mobile/lib/data/repositories/offline_drain_service.dart` (182 lines) — FIFO drain with
  a `_draining` boolean guard preventing concurrent re-entrant drains (line 76, 93-94),
  and an explicit discard-vs-retain classification matrix (`classify()`, lines 148-181):
  success/idempotent-replay → success; 409/422/400 → discard (permanently un-replayable,
  removed from queue); 5xx/network/null-status → retain (kept, retried next reconnect,
  **idempotency key never regenerated** — this is the mechanism that prevents a re-drain
  after a server-side commit from double-granting XP, per the class doc at lines 55-65).
- 20 dedicated unit tests exist and pass (`test/data/models/offline_quiz_models_test.dart`,
  `test/data/repositories/offline_drain_service_test.dart`,
  `test/data/repositories/offline_quiz_store_test.dart`,
  `test/data/repositories/offline_submit_request_test.dart`) — all green in this run,
  explicitly named against the P-invariants (e.g. "drain 503 RETAINS the attempt and the
  idempotency key is UNCHANGED across drains (P2 — never regenerate the key)").
- **What this pass could NOT verify** (static/no-backend limitation, explicitly out of
  mobile's authority anyway): whether the **server side** of the idempotency contract
  (the `Idempotency-Key` header handling inside `submit_quiz_results_v2`/`POST
  /v2/quiz/submit`) actually honors the key and returns a genuine idempotent-replay
  rather than double-crediting XP on a retried commit. That is a backend/architect
  verification, not something readable from the mobile client alone. **Deferred:
  backend/architect** — recommend a Stage 2 (live) test that deliberately retries a
  drain against a real session to confirm server-side idempotency.
- **Gated correctly**: offline capture/replay only exists on the `useV2` ON path
  (`offline_quiz_provider.dart` — confirmed by discovery doc and consistent with what I
  read). Default (`useV2` OFF) builds have no offline quiz capability at all — not a bug,
  just a scope note for anyone assuming offline works everywhere.
- **Confidence: HIGH** the client-side half is exactly as claimed. **Confidence: NOT
  VERIFIED-DEFERRED** on the server-side idempotency half.

### Version compatibility
- **No minimum-supported-app-version server-side gate was found.** Searched
  `src/proxy.ts`, `src/app/api/v2/**`, and the non-v2 routes mobile calls for any
  `X-App-Version`/`X-Client-Version`/user-agent version check, a `min_version` config, or
  a feature-flag-style version gate — none found in this pass. The only compatibility
  mechanism in play is the `useV2` **compile-time** flag baked into each APK build (old
  builds default OFF and use the byte-identical legacy path; the legacy RPCs are
  preserved "indefinitely" per in-code comments), which is a soft, best-effort mechanism,
  not a hard server-side reject. **Confidence: MEDIUM** (absence-of-evidence from a
  targeted grep, not an exhaustive trace of every proxy/middleware branch).
  **Risk: Post-Release-Acceptable today** (the legacy RPCs are intentionally kept
  backward-compatible so old clients don't need to be rejected), but worth flagging as a
  gap if/when a genuinely breaking mobile contract change is ever needed — there is
  currently no mechanism to force-upgrade or block a stale APK. Deferred: architect/backend
  if this becomes load-bearing.

### Deep links
- `mobile/lib/core/router/app_router.dart` — `redirect` callback (lines 38-86) runs
  **before every route resolution**, including the parent-tree and full-screen routes
  (`/plans`, `/stem-lab`, `/parent`). The very first check is unconditional:
  `if (!isAuth && !isLoginRoute) return '/login';` — this applies to `state.matchedLocation`
  for **any** attempted navigation, including ones arriving via deep link (GoRouter routes
  deep links through the same `redirect` pipeline as in-app navigation — there is no
  separate deep-link entry point that bypasses `redirect`). I did not find any route
  registered outside this redirect gate. **No leak into an unauthenticated screen found.**
  Confidence: HIGH for the routes enumerated in this file; I did not separately audit the
  native Android `intent-filter` (`android:scheme="com.alfanumrik.app"
  android:host="callback"`, per discovery doc) beyond confirming GoRouter's own gate — a
  malformed/malicious native deep link that GoRouter fails to parse would presumably
  fall through to Flutter's default unknown-route handling, not independently verified
  this pass.

### Shared business rules — XP/scoring
**Mobile does NOT hold its own copy of XP/scoring constants.** See §5 below for full detail —
this is the single most important correction to the task brief's assumptions.

### Play Store compliance
- `mobile/android/app/build.gradle`: `minSdkVersion 21` (Android 5.0 — reasonable floor,
  Flutter's own practical minimum), `targetSdkVersion flutter.targetSdkVersion` — **not
  hardcoded**, inherited from the Flutter SDK's own recommended default for the pinned
  toolchain version (3.41.9). This is good practice (Play Store's target-SDK floor moves
  every year; a hardcoded value would silently go stale) but means I could not read the
  exact numeric target SDK from `build.gradle` alone without invoking Gradle — **not
  independently pinned to a number in this pass**. `compileSdk flutter.compileSdkVersion`
  same pattern. R8 minify + `shrinkResources` enabled for release (per discovery doc,
  not independently re-read this pass), `multiDexEnabled true`.
- `applicationId "com.alfanumrik.app"`. Signing: `key.properties`/keystore conditionally
  loaded from `mobile/android/key.properties` (git-ignored, written at CI-release-time
  only from GitHub Secrets — confirmed by reading `mobile-release.yml`), falls back to
  debug signing when absent so CI's `flutter build apk --debug` (analyze/test/build gate)
  and local dev both still succeed without real signing material. No secret material is
  committed; `mobile-release.yml`'s cleanup step (`if: always()`) removes the decoded
  keystore/service-account JSON after use.
- No secrets in `build_apk.sh` beyond documented, expected env vars
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY` — RLS-protected publishable key, not a secret;
  `RAZORPAY_KEY_ID` — Razorpay's public/publishable key ID, not the secret) — fails fast
  with a clear message if `SUPABASE_URL`/`SUPABASE_ANON_KEY` are unset rather than
  silently building against a wrong/empty backend.
- `mobile/PLAY_STORE_LISTING.md` exists (140 lines per discovery doc pass — not
  independently re-read line-by-line this pass) but per the discovery doc's read, the
  Privacy Policy URL field is a literal placeholder
  (`(required — see privacy_policy.md)`) and no `privacy_policy.md` was found on disk.
  **I independently confirmed the absence**: `find mobile -iname "privacy*"` returned
  nothing. **A hosted Privacy Policy URL is a hard Play Console submission requirement**
  — if one doesn't exist elsewhere in the deployed web app already (e.g. `alfanumrik.com/privacy`),
  this blocks a real Play Store submission. **Confidence: HIGH the file is absent from
  `mobile/`. Confidence: LOW/NOT VERIFIED whether a hosted privacy policy page exists on
  the live web app** (that would be a frontend/ops check, outside my read this pass — a
  quick `find src/app -iname "*privacy*"` would resolve it; deferred to ops/frontend).
  **Risk: Should-Fix-Before-Release** if no such page exists anywhere; **Informational**
  if it does and just isn't cross-linked into this listing doc.

---

## Task 3 — API-route inventory contribution (reports 05/03)

`docs/audit/2026-07-02-certification/evidence/inventory/api-routes.csv` did **not exist**
at the time of this pass (checked `ls` on the `evidence/inventory/` directory — only
`pages.csv` and `super-admin-pages.csv` were present). Proceeded independently per
instructions; the full mobile→route inventory is the two tables under Task 2 above
("API parity" 12-row `/v2` table + "Non-`/v2` REST + RPC + Edge Function surfaces"
table). Recommend the backend agent's `api-routes.csv` be cross-checked against those two
tables in a follow-up pass once it lands — flagging so it isn't dropped.

---

## Independent re-verification worklist

### 1. REG-90 (mobile APK-compile / Android toolchain-drift gate)
**CONFIRMED — genuinely enforcing, not just `flutter analyze`.** Read
`.github/workflows/mobile-ci.yml` in full:
```yaml
- name: Regenerate /v2 Dart client (build_runner)
  working-directory: mobile/lib/api/v2
  run: |
    dart pub get
    dart run build_runner build --delete-conflicting-outputs
- name: flutter pub get
  run: flutter pub get
- name: flutter analyze
  run: flutter analyze
- name: flutter test
  run: flutter test
- name: flutter build apk --debug
  run: flutter build apk --debug
```
The last step (`flutter build apk --debug`) genuinely invokes the Android/Gradle/AGP/
Kotlin/NDK toolchain end-to-end, which `analyze`/`test` (Dart-only) cannot exercise. The
in-code comment on lines 3-14 explicitly documents this was added because of a real
prior regression (AGP `splits.abi` vs Flutter-injected `ndk.abiFilters` conflict).
**Also confirmed `mobile-release.yml` exists as a separate, tag/dispatch-only signed-AAB
+ Play Store upload pipeline** (fastlane, `environment: production` gated secrets,
never runs on PR code) — read in full, no secrets committed, cleanup step present.
**Confidence: HIGH. Status: verified, not a gap.**

### 2. XP/scoring constant drift — Tier 0
**NO DRIFT FOUND.** This flatly contradicts the "known divergence" table I was given at
task start. Full evidence:
- `mobile/lib/data/repositories/quiz_repository.dart` header doc (lines 1-56) states, in
  bold in-code language: *"P1/P6 invariant (BOTH paths): mobile MUST NOT compute
  `is_correct`, `score_percent`, or `xp_earned` locally... the device displays the
  server's values VERBATIM."*
- Grepped the entire file plus the whole `mobile/lib` tree for XP-shaped numeric literals
  (`per_correct`, `high_score_bonus`, `perfect_bonus`, `xp_earned =`, `quiz_daily_cap`) —
  the only hit outside comments is a **deserializer field assignment**
  (`mobile/lib/api/v2/lib/src/model/quiz_submit_result.dart:242:
  result.xpEarned = valueDes;`) reading the value **off the wire**, not computing it.
- Read the lines the task brief cited as hardcoded (old "line 77-79") — current content
  at those exact line numbers is a doc comment for `getQuestions()`, not XP arithmetic.
  `git log --follow` on this file shows commit `43c76815`
  ("feat(mobile): adopt server-authoritative quiz v2 + /api/foxy migration") as the fix
  that retired the old hardcoded-XP approach.
- Current web XP constants (`src/lib/xp-config.ts`, `xp-rules.ts` is now a re-export shim
  per its own header): `quiz_per_correct: 10`, `quiz_high_score_bonus: 20`,
  `quiz_perfect_bonus: 50`, `quiz_daily_cap: 200`. **None of these numbers appear
  anywhere in mobile source as computed XP** — they cannot drift because mobile never
  computes them; it only ever displays what the server returns
  (`QuizResult.fromV2`/`fromRpc`, verified by reading `quiz_repository_v2_test.dart`
  test names: *"reads score / xp / correct / total / flagged VERBATIM (P1+P2)"*).
- **Verdict: IN SYNC by construction. Confidence: HIGH.**

### 3. Usage limits — also NO DRIFT FOUND (bonus check, also contradicted the task brief)
`mobile/lib/data/repositories/dashboard_repository.dart:186-216` (`_normalizePlan`,
`_chatLimit`, `_quizLimit`) exactly matches `src/lib/usage.ts` `PLAN_LIMITS`:
free `5/5`, starter `30/20`, pro `100/999999`, unlimited `999999/999999` — byte-identical
numbers on both sides, including the `basic→starter`/`premium→pro`/`ultimate→unlimited`
alias table and the billing-cycle-suffix-stripping logic. **Verdict: IN SYNC. Confidence: HIGH.**

### 4. Plan codes — mostly in sync, but ONE real display bug found (not in the discovery doc)
- `mobile/lib/data/models/subscription.dart` (`Plans.all`, used by the pricing screen) —
  bare codes `starter`/`pro`/`unlimited`, prices `299/2399`, `699/5599`, `1099/8799` —
  **exact byte-match** to `src/lib/plans.ts` `PRICING`. IN SYNC.
- `mobile/lib/data/repositories/dashboard_repository.dart`'s `_normalizePlan` correctly
  strips billing-cycle suffixes and applies the `ultimate→unlimited` legacy alias,
  matching `src/lib/plans.ts`'s `normalizePlanCode`/`PLAN_ALIAS`. IN SYNC.
- **BUG (new finding, MEDIUM confidence, Should-Fix-Before-Release)**:
  `mobile/lib/data/models/student.dart:69-83`, the `planDisplayName` getter:
  ```dart
  String get planDisplayName {
    switch (planCode) {
      case 'starter_monthly':
      case 'starter_yearly':
        return 'Starter';
      case 'pro_monthly':
      case 'pro_yearly':
        return 'Pro';
      case 'ultimate_monthly':
      case 'ultimate_yearly':
        return 'Ultimate';
      default:
        return 'Free';
    }
  }
  ```
  This switch handles **only** the billing-cycle-suffixed legacy-alias shape. It has
  **no case for the bare canonical codes** (`'starter'`, `'pro'`, `'unlimited'`) and **no
  case for the canonical suffixed shape** (`'unlimited_monthly'`/`'unlimited_yearly'` —
  only the legacy-alias `'ultimate_*'` spelling is handled). I confirmed via
  `students.subscription_plan`'s DB `CHECK` constraint
  (`chk_student_plan_code`, `00000000000000_baseline_from_prod.sql:11645`) that **both**
  spellings are legally storable, and traced the **live, primary write path**
  (`payments/webhook/route.ts` → `canonicalizePlan(rawPlan)` → bare code → RPC
  `activate_subscription_locked`/`activate_subscription` → `UPDATE students SET
  subscription_plan = p_plan_code`, confirmed at
  `00000000000000_baseline_from_prod.sql:82,130`) writes the **bare** code
  (`'starter'`/`'pro'`/`'unlimited'`) with **no billing-cycle suffix**. Since the switch
  has no `default`-avoiding case for bare codes, **a currently-paying Starter/Pro/Unlimited
  subscriber whose plan was activated through the primary webhook path will see
  `planDisplayName` return `'Free'`** on the Dashboard header (`dashboard_screen.dart:85`)
  and Settings screen (`settings_screen.dart:121`) — while the separate, correctly-generic
  `isPremium` getter (`planCode != 'free'`, used for badge **color**) still reports
  premium. Net user-visible effect: a premium-colored badge with the text "Free"
  underneath it. **Does not affect entitlements/feature-gating** — `dashboard_repository.dart`'s
  `_normalizePlan`/`_chatLimit`/`_quizLimit` (the code that actually gates chat/quiz
  usage) is a **separate, correct** implementation unaffected by this bug. This is a
  display-only defect. Confidence: HIGH that the code has this shape;
  Should-Fix-Before-Release given it's user-facing and could generate support tickets
  from paying customers ("why does the app say I'm on Free?"). **Deferred: mobile** (own
  fix — the fix is a one-line change: route `planDisplayName` through the same
  `_normalizePlan`-style stripping `dashboard_repository.dart` already has, rather than a
  raw switch on `planCode`).
- The discovery doc (`05-mobile.md` §5) asserts plan codes are "IN SYNC" but only checked
  `subscription.dart`'s `Plans.all` — it did not examine `student.dart`'s
  `planDisplayName` getter, so this bug was not previously caught. Flagging as a genuine
  incremental finding from this independent pass.

---

## Confidence & risk summary

| Finding | Confidence | Risk | Tier |
|---|---|---|---|
| `flutter analyze` clean, `flutter test` 146/146 pass | HIGH (ran fresh, this pass) | Informational | — |
| `/v2` contract 12/12 route parity, zero orphans | HIGH | Informational | — |
| REG-90 CI gate genuinely builds APK (not just analyze) | HIGH | Informational (verified, not a gap) | — |
| XP constants NOT hardcoded on mobile — server-authoritative | HIGH | Informational (corrects a stale claim in my own task brief) | Tier 0 (XP) |
| Usage limits IN SYNC (free 5/5, starter 30/20, pro 100/∞, unlimited ∞/∞) | HIGH | Informational (corrects a stale claim) | — |
| Plan pricing IN SYNC (`subscription.dart` `Plans.all`) | HIGH | Informational | — |
| **`student.dart.planDisplayName` shows "Free" for bare-code paying subscribers** | HIGH (code shape) / MEDIUM (live-reachability inferred from webhook trace, not observed on a device) | **Should-Fix-Before-Release** | Plan-display (not entitlement) |
| **RPC-bypass gap: default (`useV2` OFF) mobile quiz path not covered by today's QUIZ-ACTIVE fix** | HIGH | **Should-Fix-Before-Release** | **Tier 0 (auth + XP integrity)** |
| Offline quiz replay (REG-91) client-side P2/P3/P6/P13 claims | HIGH (client code) | Informational (verified, not a gap) | Tier 0 (offline-replay-safety) |
| Offline replay server-side idempotency enforcement | NOT VERIFIED-DEFERRED (static pass, no backend access) | Unknown — needs Stage 2 live check | Tier 0 |
| Dead `foxy-tutor` Edge Function fallback branch + stale "rollback path" comment | HIGH | Post-Release-Acceptable (dormant) / Should-Fix (doc hygiene) | — |
| No server-side min-app-version gate | MEDIUM (targeted grep, not exhaustive) | Post-Release-Acceptable today | — |
| Session-expiry: no global 401/signOut → router redirect | MEDIUM | Should-Fix-Before-Release | Tier 0 (auth) |
| Deep links: no unauthenticated leak found | HIGH (GoRouter config) / not independently checked at native intent-filter level | Informational | — |
| Target/min SDK not numerically pinned in `build.gradle` (inherits Flutter default) | MEDIUM (good practice, but number not read) | Informational | — |
| Privacy Policy file absent from `mobile/` | HIGH (file absence confirmed) | Should-Fix-Before-Release IF no hosted page exists elsewhere (NOT VERIFIED — deferred to ops/frontend) | — |
| `DailyPlanRepository` appears unwired to any screen | MEDIUM | Informational | — |
| File count: 74 hand-written app-source files (vs discovery doc's 46) | HIGH (full file list captured) | Informational (documentation reconciliation only) | — |
| P15 3-layer onboarding failsafe not mirrored on mobile signup (single client insert only) | Reported by discovery doc, not independently re-verified this pass | NOT VERIFIED-DEFERRED | Tier 0 (onboarding) — deferred to architect/backend per discovery doc's own flag |

---

## Deferred (not mobile's authority to resolve alone)

- **architect**: RPC-layer `is_active`/`deleted_at` check for `start_quiz_session` /
  `submit_quiz_results_v2` (closes the mobile-reachable RPC-bypass gap; already the
  commit author's own stated follow-up, this pass just confirms mobile's default path is
  in-scope for it too).
- **backend/architect**: live (Stage 2) confirmation that server-side `Idempotency-Key`
  handling on `/v2/quiz/submit`/`submit_quiz_results_v2` actually short-circuits a
  retried drain rather than double-crediting XP — client-side contract is sound, server
  half unverifiable statically.
- **assessment**: sign-off that the RPC-bypass gap is correctly scoped as Should-Fix vs
  Blocker given the narrow precondition (already-suspended/soft-deleted account + live
  JWT).
- **ops/frontend**: confirm whether a hosted Privacy Policy page exists anywhere on the
  live web app (`alfanumrik.com/...`) — resolves whether the missing
  `mobile/privacy_policy.md` is a real Play Store submission blocker or just a
  cross-linking gap.
- **backend**: cross-check this report's two API-route tables once
  `evidence/inventory/api-routes.csv` lands (didn't exist at time of this pass).
- **mobile (self, future PR — not done in this read-only pass)**: fix
  `student.dart.planDisplayName`, add a global session-expiry → forced-logout listener,
  update/remove the dead `foxy-tutor` Edge Function fallback comment.
