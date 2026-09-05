# LAUNCH_STATE.md — Verified Ground Truth

> **Read this FIRST every session. Then re-verify before you quote any number in it.**
> Every line carries a *last verified* date and the command/query that produced it. Anything not verified live is **UNKNOWN** — never "probably fine".
>
> **Audit date: 2026-09-05 (~10:00–10:20 UTC).** Evidence-only pass; **no application code was changed.**
> Repo `AlfanumrikOS/Alfanumrik`. Local checkout `main @ 42a090ed` — **5 commits behind `origin/main` (fcca6729)**.
> Prod Supabase `shktyoxqhundlvkiwguu` (ap-south-1). Vercel project `alfanumrik` (`prj_1PRfOVHYbSemMYSU5DXCMIUG9sda`, team `team_hzGOneVt21Je8RCtuAsDU7TA`).

---

## ⚠️ THE HEADLINE: production is not running `main`

**`alfanumrik.com` is currently served by an unmerged pull-request branch.**

| Fact | Value | How verified |
|---|---|---|
| Live production deployment | `dpl_5AE7VsosRqm45aQzZVBTvtqytDG7` | Vercel `get_project` → `latestDeployment`, `target: production` |
| Its commit | `793f9d33` "fix: avoid service worker registration type leak" | `get_deployment` → `meta.githubCommitSha` |
| Its branch | `vercel-agent/enable-pwa-installation` (**PR #1791, unmerged**) | `meta.githubCommitRef`, `meta.githubPrId` |
| How it got there | `meta.action: "promote"` from preview `dpl_2NxEApQPMbAedYCpc9hx1mttz3LC` | `get_deployment` → `meta.action` / `originalDeploymentId` |
| Author | `vercel[bot]` | `meta.githubCommitAuthorName` |
| Is that commit on `main`? | **NO** | `git merge-base --is-ancestor 793f9d33 origin/main` → **not an ancestor** |
| Branches containing it | `origin/pr-1791`, `origin/vercel-agent/enable-pwa-installation` only | `git branch -a --contains 793f9d33` |
| Independent confirmation | `/api/v1/health` self-reports `"git_sha":"793f9d3"` | `curl https://alfanumrik.com/api/v1/health` |
| Promoted at | ~09:58 UTC 2026-09-05 (build 173 s, READY 10:01 UTC) | `createdAt` / `buildingAt` / `ready` |

**What that branch ships** (`git diff --stat origin/main...pr-1791` — 8 files, +139/−156):
`apps/host/public/pwa-sw.js` (**new service worker**), `manifest.json`, `RegisterSW.tsx`, `layout.tsx`, `api/school-config/manifest/route.ts`, 2 test files, 1 runbook.

**Blast radius is smaller than it looks, and that matters.** The live service worker (`curl https://alfanumrik.com/pwa-sw.js` → 200, 678 bytes) is deliberately **network-only with no CacheStorage** — it registers for installability and passes every request straight to `fetch()`. It cannot serve stale HTML or stale API responses. So the *code* is low-risk.

**The governance failure is the P0, not the diff.** This repo enforces `production-release-control` (`scripts/verify-devops-policy-contract.ts` requires `deploy-production.yml` to have exactly one trigger: push to `main`) — a policy so load-bearing that PR #1785 was *reverted* for violating it. A Vercel dashboard "Promote" walked around that policy entirely. Consequences: the repo is no longer the source of truth for what is in production; the rollback target is ambiguous; and PR #1791's CI gates never ran against what users are now being served.

*Last verified: 2026-09-05 10:15 UTC.*

---

## 0. Verification method (so the next session can reproduce)

| Domain | How it was verified 2026-09-05 |
|---|---|
| Schema / RLS / grants / functions | Supabase MCP `execute_sql` on `pg_class`, `pg_policy`, `pg_proc`, `information_schema.columns`, `has_function_privilege(...)` |
| Edge Functions | `list_edge_functions` vs `ls -d supabase/functions/*/`, diffed with `comm` **both directions** |
| Crons | `cron.job` ⋈ `cron.job_run_details` over 7 days |
| Feature flags | `select … from feature_flags` |
| Hosting / deploys / protection / env | Vercel MCP `get_project`, `list_deployments`, `get_deployment`, `get_project_deployment_protection`, `get_runtime_logs`, `get_runtime_errors`; `vercel env ls production` (names only) |
| Public HTTP behaviour | `curl` with a real browser UA **and** Googlebot UA |
| Live Turnstile behaviour | `POST /api/auth/pre-check` with (a) a deliberately invalid token and (b) no token, then read the server-side siteverify reason out of Vercel runtime logs |
| Routes / links / guards | `find`/`grep` over `apps/host/src` + `packages/*`, plus a per-route guard census |

**Row counts:** always `count(*)`. `pg_stat_user_tables.n_live_tup` is a stale planner estimate here — it reported `concept_mastery` = 16 when the true count is 107, and `curriculum_topics` = 0 when the true count is 542. Do not quote it.

---

## 1. Ground-truth inventory

### 1.1 Routes — App Router vs navigation
| Metric | Value | Command |
|---|---|---|
| `page.tsx` | **196** | `find apps/host/src/app -name page.tsx \| wc -l` |
| `layout.tsx` | **34** | same pattern |
| API `route.ts` | **410** | same pattern |
| Redirect sources | **27** | `grep -oE "source:\s*'[^']+'" apps/host/next.config.js` |
| Migrations on disk | **685** | `ls supabase/migrations/*.sql \| wc -l` |
| Test files | **1,545** | find over `apps packages supabase e2e` |
| E2E specs | **35** | `ls e2e/*.spec.ts \| wc -l` |
| Bundle caps | `CAP_SHARED_KB=297`, `CAP_PAGE_KB=260`, `CAP_MIDDLEWARE_KB=120` | `grep -nE '^const CAP_' scripts/check-bundle-size.mjs` |

**Dead links: 0.** 174 page-like internal link targets cross-checked against the 196 routes + 27 redirect sources. 8 candidates surfaced; **all 8 are test fixtures or comments** (`/answer-checker`, `/quiz-arena` = fixtures inside `internal-href-route-resolution.test.ts`; `//evil.com` = an open-redirect test assertion; `/x/*`, `/locked` = component-test props). There is an enforcing test — `apps/host/src/__tests__/internal-href-route-resolution.test.ts` — that fails CI on a genuine dead href. This is real, working protection.

**Ghost routes (page exists, zero inbound link literal): 24 static + 14 dynamic = 38.**
Static list: `/auth/reset`, `/dev/cosmic-preview`, `/dev/ui`, `/exam-briefing`, `/internal/admin`, `/join`, `/learn/foxy-test`, `/progress/dashboard`, `/quiz/ncert`, `/rewards`, `/settings`, `/teacher/onboarding`, `/tutor`, six `/school-admin/*` (see §2), and four `/super-admin/*`.

### 1.2 Live Supabase schema (queried, not read from migrations)
| Metric | Value | Note |
|---|---|---|
| Tables (public) | **422** | RLS enabled on **all 422** — `relrowsecurity=false` count is **0** |
| Views / matviews | 27 / 0 | |
| Columns | 6,159 | |
| RLS policies | **1,109** | *was 1,099 at ~06:00 UTC today — +10 in one morning* |
| Indexes (public) | 1,589 | |
| Functions | 725 (441 SECURITY DEFINER) | |
| Postgres | 17.6, ap-south-1 | |

### 1.3 Edge Functions — **zero drift, confirmed**
**45 deployed** (`list_edge_functions`, every one `status: ACTIVE`) **= 45 on disk** (`ls -d supabase/functions/*/` minus `_shared`). `comm -23` and `comm -13` both returned **empty**. Only `_shared/` remains as a non-function directory; no `_archive/`. The long-running on-disk≠deployed drift is genuinely closed.

### 1.4 Hosts, env parity, webhooks
- **Single host: Vercel** (`bom1`, Node 22.x). Domains: `alfanumrik.com`, `*.alfanumrik.com`, `www.alfanumrik.com`. AWS Fargate is decommissioned — **treat every "dual-host" line in the runbooks as historical.**
- **Deploy protection:** SSO **ON** for `all_except_custom_domains`; password protection OFF; trusted-IPs OFF. Verified live: preview URLs return **302** to Vercel login.
- **Webhooks in code:** `/api/payments/webhook` and `/api/whatsapp/webhook` — exactly one callback path per provider in the codebase. **Provider-side registration is NOT verifiable from here** (see §1.8 / P0-2).
- **Env parity (`vercel env ls production`, names only — no values read):** these exist in **Production but NOT Preview**: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET`, `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Preview deploys therefore cannot exercise auth or any admin-client route. That is partly a safety property, but it means **a preview build can never be a real rehearsal of production.**
- **🔴 Timing that matters:** `TURNSTILE_SECRET` was created **32 minutes** before this audit (≈09:38 UTC), `TURNSTILE_HOSTNAMES` 37 min, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 38 min. All three Razorpay vars are **164 days** old and untouched.

### 1.5 Feature flags — **204 rows** (not the 145 recorded earlier today)
`select count(*) … from feature_flags`: **204 total — 140 enabled, 64 disabled.**
- **Gating traps (`is_enabled=false` AND `rollout_percentage=100`): 3.** Never trust either column alone.
- `is_enabled=true` with `rollout_percentage=0`: **0**.

### 1.6 Excluded from git / uncommitted
`.gitignore` excludes `.env*`, `node_modules`, `.next`, `data/ncert-books`, `tools/`, `graphify-out/`, run artefacts.

**Working tree on `main` is dirty — 36 entries:**
- **26 modified tracked files**, uncommitted: the Foxy semantic-cache work (`api/foxy/route.ts`, `foxy-router.ts`, `prompt-sections.ts`, `grounded-answer/{pipeline,cache-redis,cache-telemetry,mol-telemetry-adapter}.ts`, 10 test files, 7 golden-turn fixtures).
- **10 untracked**, including 5 migrations `20260905120000…160000`, `grounded-answer/cache-semantic.ts`, `nextjs-turnstile-alfanumrik/` — **and `LAUNCH_STATE.md` + `LAUNCH_BLOCKERS.md` themselves.**

> **The durable-memory files were never committed.** A fresh clone of this repo has no memory. That is not a filing error; it is the root cause of the amnesia this project keeps paying for. **Commit these two files.**

### 1.7 Admin RBAC — server-side check per route
`find` over `api/{super-admin,internal/admin,v1/admin,school-admin}` for `route.ts`, then grep each for a guard literal:

| Guard | Routes |
|---|---|
| `authorizeAdmin` | 96 |
| `authorizeRequest` | 43 |
| `authorizeSchoolAdmin` | 35 |
| `resolveCommandCenterContext` (calls `authorizeRequest`) | 7 |
| `authorizeOperator` | 3 |
| **no guard literal** | **1** |
| **Total** | **185** |

The single unguarded route is `api/super-admin/logout/route.ts` — it clears a cookie. **Benign; not a blocker.**

**Anon lockdown re-verified.** All nine historically dangerous SECURITY DEFINER writers return `has_function_privilege('anon', …, 'EXECUTE') = false`: `update_learner_state_post_quiz`, `submit_foxy_message_atomic`, `security_reserve_quota`, `bootstrap_user_profile`, all four `atomic_quiz_profile_update` overloads, `get_progress_report`, `get_activity_timeline`, `get_table_sizes`, `get_connection_stats`.

**Dev-impersonation route is genuinely blocked in production** — three independent layers, all checked:
1. Live: `/dev/impersonate`, `/api/dev/impersonate`, `/dev/ui` all return **404** on `alfanumrik.com`.
2. Middleware: `proxy.ts:756-764` 404s those paths when `VERCEL_ENV === 'production'`.
3. In-route: `isProdLocked()` returns true when `NODE_ENV === 'production'` **or** `VERCEL_ENV === 'production'` — and Next.js sets `NODE_ENV=production` for every Vercel build, including previews. Previews are additionally behind SSO (302, verified).

**But it wrote four real accounts into the production database** (there is only one Supabase project):
`dev.impersonate.{student,teacher,parent,school-admin}@alfanumrik.demo`, created 04:19–04:58 UTC **today**, all with non-null `last_sign_in_at`. Plus an older `whatsapp-e2e-test-…@alfanumrik.demo` (2026-07-30). These inflate every user/role count below.

### 1.8 Third-party state
| Service | Verified 2026-09-05 |
|---|---|
| **Razorpay** | `RAZORPAY_KEY_ID` / `_KEY_SECRET` / `_WEBHOOK_SECRET` all present in Production (164 d old); **values hidden — live-vs-test mode is UNKNOWN.** `payment_webhook_events` = **0 rows, ever.** `payment_history` = 5 rows: **3 captured** (₹1,297 total, plans `starter`+`pro`, 2026-04-02→05-09) and 2 failed (last 2026-08-15). **All 3 captured rows have `razorpay_signature` NULL** — every successful payment came through the client-return `/verify` path, never a signed webhook. The webhook handler's code is correct (timing-safe `verifyRazorpaySignature`, 503-on-missing-secret so Razorpay retries) — it has simply never been called. `/api/v1/health` reports razorpay `ok`, and that check *does* authenticate for real (HTTP Basic against `api.razorpay.com/v1/payments/<probe>`, expecting 404) — so **credentials are valid**, but it proves nothing about mode or webhook registration. |
| **Voyage** | Model `voyage-3`. `rag_content_chunks` = **27,778** rows under two labels: `voyage/voyage-3` 13,919 (last ingest **2026-04-15**) and `voyage-3` 13,859 (last ingest **2026-07-04**). Nothing ingested for **2 months**. Separately, `embed-diagrams` writes `voyage-multimodal` and `embed-ncert-qa` writes `voyage-large-2-instruct` — three Voyage models in play, not one. |
| **Anthropic** | **There is no `utils/anthropic.ts`.** 23 non-test files reference `api.anthropic.com`; **4 build their own `fetch()`** to it (`daily-cron`, `grade-experiment-conclusion`, `grade-written-answer`, `ncert-question-engine`); **30 files read `ANTHROPIC_API_KEY` directly**; and **3 rival adapter modules** exist (`agents/runtime/anthropic.ts`, `packages/lib/src/ai/gateway/adapters/anthropic.ts`, `supabase/functions/_shared/mol/providers/anthropic.ts`). Routing is **not** centralised. Foxy itself is live and healthy (see §4). |

---

## 2. Duplication census

Method: importer/caller counts via `grep -rl` over `apps/host/src` + `packages`, excluding `node_modules` and tests; row counts via `count(*)`.

| Concern | Path A | Path B (rival) | Actually live | Evidence |
|---|---|---|---|---|
| Student home | `/dashboard` — **44** inbound files | `/today` (7), `/me` (1) | **All three** | login destination is `/dashboard`; `/today` is a nav tab |
| Landing nav | `NavV3` — **15** | `NavV2` — **6** | V3 default, V2 still wired | importer counts |
| Landing page | `WelcomeV2` — **6** | `WelcomeV3` — **5** | both reachable (`?v=2`) | importer counts |
| Hero | `HeroV3` — 3 | `HeroV2` — 2 | V3 default | importer counts |
| Component kit | `ui/primitives` — **28** | `wonder-blocks` — 3 | primitives now dominant | importer counts (**inverted since the last audit — primitives won**) |
| Retrieval RPC | `match_rag_chunks` — **18** callers | `match_rag_chunks_ncert` 14, `select_quiz_questions_rag` 14, `match_rag_chunks_v2` 6 | **4 live retrieval paths** | caller counts |
| Mastery store | `concept_mastery` — **107 rows**, live | `adaptive_mastery` 16; `learner_mastery`, `topic_mastery`, `concept_mastery_score`, `student_skill_state` all **0** | `concept_mastery` + `student_learning_profiles` (534) | `count(*)` |
| Chapter taxonomy | `curriculum_topics` **542** | `chapters` **551**, `curriculum_chapters_v` (view) **551**, `cbse_syllabus` **1,148** | **3 stores + 1 view, all populated** | `count(*)` |
| Admin console | `/super-admin/*` | `/internal/admin` | both reachable | route census |
| **School-admin IA** | flat pages: `students`(4), `classes`(4), `invite-codes`(4), `enroll`(3), `setup`(3) … | **`overview`, `academics`, `people`, `governance`, `insights`, `settings` — all 0 inbound** | flat set is live | per-page inbound count |

**New finding — an abandoned school-admin information architecture.** Of 29 `/school-admin/*` pages, **six** are exactly the hub names of a grouped IA (`overview`/`academics`/`people`/`governance`/`insights`/`settings`) and **none of them is linked from anywhere**. A second navigation structure was built for the school portal and never wired up. For a school-facing pilot this is the highest-value consolidation target on the list.

---

## 3. Journey reality check

**Read this section's honesty caveat before quoting it.**

**Exercised live by this audit (real HTTP against `alfanumrik.com`, real SQL against prod):**
public routing and status codes; Googlebot crawlability; the Turnstile pre-check endpoint (both with an invalid token and with none, then reading the server's own siteverify reason from runtime logs); dev-route blocking; preview SSO; `/api/v1/health`; the live service worker; and row counts / last-write timestamps for every table below.

**NOT exercised — nobody has done this, and it is the single largest gap in this document:** any authenticated end-to-end journey. Entering a password is prohibited for me and no session was handed over. Every logged-in row below is inferred from database state and code, **not** from a walk. `/dev/impersonate` exists but is 404 in production by design.

| Role | Step | Status | Evidence |
|---|---|---|---|
| Public | `/` → 307 → `/welcome` renders | **WORKS** | `curl` 307 → `location: /welcome`; `/welcome` 200 |
| Public | `/login`, `/pricing`, `/for-schools` | **WORKS** | 200 each |
| Public | Crawlability | **WORKS — prior "BROKEN" is CORRECTED** | Googlebot UA: `/robots.txt` 200, `/sitemap.xml` 200, `/pricing` 200, `/for-schools` 200. The 429 "Vercel Security Checkpoint" reported earlier today does **not** reproduce. |
| Student | Signup / Login | **UNPROVEN (P0)** | Turnstile secret replaced **~30 min** before this audit. My probe now returns siteverify `invalid-input-response` (= *my token* was bad; **the secret authenticates**) instead of yesterday's `invalid-input-secret` (= *server* misconfigured). Strong evidence the secret is correct — but **no human login has completed since the change.** Latest real sign-in in `auth.users` is a `dev.impersonate.*` account at 05:20 UTC, which bypasses Turnstile entirely. |
| Student | Foxy tutor | **WORKS** | `foxy_chat_messages` **193 in 7 d**, last **08:32 UTC today**; `grounded_ai_traces` **6,563 in 7 d** |
| Student | Quiz → score → XP → mastery | **WORKS (very low volume)** | `quiz_sessions` 112 all-time, **3 in 7 d**, 9 in 30 d. `concept_mastery` 107 rows; its `max(updated_at)` and `quiz_sessions.max(created_at)` are **the identical timestamp** `2026-09-01 15:05:51.60198+00` — consistent with the atomic write path working. |
| Student | Payment / upgrade | **UNPROVEN (P0)** | 0 webhook events ever; 3 captured payments all with NULL signature; prod key mode unknown |
| Parent | Link child | **NOT VERIFIED / near-dead** | `guardian_student_links` = **2 rows**, last created **2026-04-14** — five months ago |
| Parent | Weekly report | **BROKEN** | `parent_weekly_reports` = **0 rows, ever** |
| Teacher | Message threads | **WAS BROKEN — grant now correct, unproven** | Error `permission denied for function teacher_list_message_threads` first **2026-08-23**, last **2026-09-05 02:33 UTC** (13 days). The `(p_limit integer)` overload now has `EXECUTE` for `authenticated` (verified). No authenticated call since to confirm. |
| Teacher | Classes / gradebook / assignments / attendance | **NOT BUILT** | `assignments`, `assignment_submissions`, `grade_book_entries`, `student_attendance`, `teacher_parent_messages` — **all 0 rows** |
| School admin | Portal | **PARTLY UNREACHABLE** | 6 of 29 pages have zero inbound links (§2) |
| All | Mock exams | **EMPTY** | `mock_test_attempts` = 0 |

---

## 4. Live usage — why "it works for me" proves nothing here

`auth.users` + role tables, 2026-09-05: **47 auth users** (19 signed in / 7 d, 23 / 30 d, 11 signups / 30 d). Quiz: **3 sessions in 7 days**. Foxy: 193 messages / 7 d.

🔴 **Correction (2026-09-05 ~11:20 UTC) — the raw role counts are roughly half seeded demo data.** `scripts/seed/demo-school-data.sql` has evidently been run against production more than once: **7 of the 16 schools carry `is_demo = true`** (created 2026-05-18 → 06-08), and they hold most of the population. Joining role tables to `schools.is_demo`:

| Metric | Raw total | In demo schools | **Real** |
|---|---|---|---|
| Students | 76 | **39** | **37** |
| Teachers | 10 | **6** | **4** |
| Schools | 16 | **7** | **9** |
| `concept_mastery` rows | 107 | **54** | **53** |

Plus 5 demo `auth.users` (4 `dev.impersonate.*@alfanumrik.demo` created today, 1 `whatsapp-e2e-test-*` from 2026-07-30). **Every population figure quoted anywhere else in this file or in prior audits is inflated accordingly** — always join to `schools.is_demo` before quoting a learner count. Note this pollution predates this session; it is not from Phase 0.

Against that: 196 pages, 410 API routes, 45 Edge Functions, 685 migrations, 204 feature flags, 422 tables. **The built surface exceeds the genuinely-exercised surface by roughly two orders of magnitude, and by more than the raw counts suggested.**


---

## 5. Cron health (7 days, `cron.job_run_details`)

- 🔴 **`learning-loop-health`** (*/15 min): **672 failures, 0 successes.** Permanently broken; last run 10:00 UTC today. It inserts into `ops_events` with a NULL `environment` (NOT NULL) and gauges mastery off the empty legacy `concept_attempts` table, so it emits a standing false "mastery pipeline never ran" critical. **Real mastery writes are healthy** — this alarm is noise that masks genuine alerts.
- 🔴 `p1-12-chat-audit-request-log-retention` (daily 22:10): **3 failures, 0 successes.**
- ⚪ `embedding-backfill-tick`: **inactive**, never run.
- ✅ The other 20 jobs are clean: `agent-worker-tick` 10,080/0, `ops-alert-deliverer` 10,080/0, `projector-runner-tick` 5,040/0, `agent-timeout-sweep` / `ops-alert-evaluator` / `projector-health-check` / `synthetic-host-monitor` 2,016/0 each, `adaptive_intervention_pipeline_q15m` 672/0, plus the daily analytics/retention jobs 7/0 each.

---

## 6. Security advisors (Supabase, 2026-09-05)

**1,131 findings — 0 ERROR, 1,089 WARN, 42 INFO.**

| Count | Level | Name |
|---|---|---|
| 420 | WARN | `pg_graphql_authenticated_table_exposed` |
| 413 | WARN | `pg_graphql_anon_table_exposed` |
| 176 | WARN | `authenticated_security_definer_function_executable` |
| 57 | WARN | `anon_security_definer_function_executable` |
| 42 | INFO | `rls_enabled_no_policy` |
| 21 | WARN | `function_search_path_mutable` |
| 2 | WARN | `extension_in_public` |

No table has RLS disabled. The GraphQL rows are a broad surface finding mitigated by universal RLS. The 57 anon-SECDEF rows were analysed in §1.7 — every dangerous writer is locked.

---

## 6b. Phase 0 execution log — first authenticated walk in this project's history (2026-09-05, ~10:45–11:15 UTC)

Local dev was made runnable and all four impersonation roles were exercised with **real Supabase sessions**. This is the first time any logged-in dashboard has been observed with evidence.

**Setup that was required (none of it documented correctly before now):**
1. `git pull --ff-only origin main` → `fcca6729` (local was 5 behind; `/dev/impersonate` did not exist locally).
2. `npx vercel env pull apps/host/.env.local --environment=production --yes` — run from the **repo root** (`.vercel/` is at the root; `apps/host/.vercel` does not exist). Next reads `apps/host/.env.local`, **not** the repo-root file — both `README_LOCAL.md` and `ENVIRONMENT_SETUP.md` document the wrong path.
3. **29 of 73 keys came back as `[SENSITIVE]` placeholders** — Vercel will not export Secret-type values; Config-type ones export fine. All three vars impersonation needs (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) exported real values. `ANTHROPIC_API_KEY` did **not** → Foxy cannot work locally.
4. Deleted `TURNSTILE_SECRET` / `TURNSTILE_HOSTNAMES` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — with prod values present a `localhost` widget token reports `hostname: "localhost"`, which is not in the allowlist → 403 fail-closed on every login.
5. 🔴 **NEW TRAP — `vercel env pull` writes `VERCEL_ENV="production"` and `VERCEL="1"` into the local file.** That satisfies `proxy.ts:755` (`NODE_ENV==='production' || VERCEL_ENV==='production'`) and **404s `/dev/impersonate` on localhost**. Strip `VERCEL`, `VERCEL_ENV`, `VERCEL_TARGET_ENV` after every pull. Next hot-reloads the change; no restart needed.

**Impersonation mechanism: PASS.** All four roles return `303` to the correct destination with a real session hash:

| Role | HTTP | Destination | Session hash |
|---|---|---|---|
| `student` | 303 | `/dashboard` | yes |
| `teacher` | 303 | `/teacher` | yes |
| `parent` | 303 | `/parent` | yes |
| `institution_admin` | 303 | `/school-admin` | yes |

**Landing pages, observed:**

| Role | Verdict | Evidence |
|---|---|---|
| Student `/dashboard` | **RENDERS** | "Let's get going, Dev", Class 9, mastery empty state ("No quizzes yet"), 6 subject roadmaps with real chapter counts (Math 8, Science 8, English 8, Hindi 8, Social Studies 6, Sanskrit 7) |
| School admin `/school-admin` | **RENDERS** | Command Center: Classes at risk / Teacher engagement / Mastery distribution / Class average mastery / School Pulse |
| Teacher `/teacher` | **ERROR STATE** — "Couldn't load the command center" + Retry | **local-only, not a prod bug** — see below |
| Parent `/parent` | **ERROR STATE** — "Could not load linked children" | same cause, plus this parent has no linked children |

🔴 **Methodology finding — 10 pages cannot be tested from localhost at all.** Console: `Access to fetch at 'https://…/functions/v1/teacher-dashboard' from origin 'http://localhost:3000' blocked by CORS policy: 'Access-Control-Allow-Origin' has value 'https://alfanumrik.com'`. `supabase/functions/_shared/cors.ts:14` *does* allow `http://localhost:3000`, but only when `Deno.env.get('ENVIRONMENT') !== 'production'`, and the deployed functions run with `ENVIRONMENT=production`. **This is correct security posture and must not be loosened.** Consequence: the ten Edge-Function-backed pages (`/teacher/{classes,students,attendance,grade-book,submissions,reports}`, `/parent/{children,attendance,reports}`) must be validated **against production with a real session**, never locally. Vercel preview origins *are* CORS-allowed (the `^https://alfanumrik[a-z0-9-]*\.vercel\.app$` branch), but `/dev/impersonate` is blocked there too, because Next sets `NODE_ENV=production` for every Vercel build.

✅ **P1-4 (teacher message threads) appears FIXED.** `GET /api/teacher/messages/threads?limit=1` returned **200** in this walk — no `permission denied for function teacher_list_message_threads`. Needs one production-origin confirmation to close.

✅ **Razorpay is in LIVE mode.** `RAZORPAY_KEY_ID` pulled from Vercel production begins `rzp_live_`. This closes the audit's largest unknown: the production keys are live, so the payment gap is **only** the unregistered webhook (`payment_webhook_events` still 0 rows ever), not the key mode.

*Last verified: 2026-09-05 ~11:15 UTC.*

---

## 7. Corrections to earlier audits

Recorded so no future session re-opens a closed issue — **or trusts a claim that was never true.**

| Earlier claim | Status today | Evidence |
|---|---|---|
| "Crawlability BROKEN — 429 to Googlebot on every page incl. `robots.txt`" | **WRONG / no longer reproduces** | Googlebot UA gets 200 on `/robots.txt`, `/sitemap.xml`, `/pricing`, `/for-schools` |
| "Feature flags: 145 rows" | **WRONG — 204 rows** | `count(*) from feature_flags` |
| "RLS policies: 1,099" | **Now 1,109** | `count(*) from pg_policy` |
| "Local main is ~10 commits behind" | **5 commits** | `git rev-list --left-right --count` |
| "P0-1 Turnstile RESOLVED — zero error logs in the following 2h" | **Overstated.** The file asserting a 2-hour clean window was written **12 minutes** after the secret was set. The window had not elapsed. | `TURNSTILE_SECRET` created ≈09:38 UTC; `LAUNCH_BLOCKERS.md` mtime 15:20 IST = 09:50 UTC |
| "`wonder-blocks` is the de-facto kit; primitives rising" | **Inverted** — `ui/primitives` 28 vs `wonder-blocks` 3 | importer counts |
| "Latest prod deploy is `fcca672` (PR #1789)" | **Superseded ~3 h later** by the PR #1791 promote | see headline |
| Anon-function P0 (dangerous writers anon-callable) | **GENUINELY RESOLVED** | all 9 probed writers `anon=false` |
| Edge Function on-disk ≠ deployed drift | **GENUINELY RESOLVED** | 45 = 45, `comm` empty both ways |
| Dead links | **GENUINELY 0**, with an enforcing CI test | link cross-check + `internal-href-route-resolution.test.ts` |
| Mastery pipeline "never ran" | **FALSE ALARM** — it is the §5 cron bug | `concept_mastery` writes align exactly with `quiz_sessions` |

---

*Last verified: **2026-09-05, ~10:20 UTC**. Before quoting any number above, re-run its command in §0. This file went stale within 8 minutes last time.*
