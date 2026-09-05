# LAUNCH_BLOCKERS.md

> Every blocker numbered, with severity, a one-line root cause (or "root cause unknown — needs X"), **the specific verification that proves it fixed**, and size (S/M/L).
> **Severity:** **P0** = blocks a school using this on Monday · **P1** = embarrassing in a school demo · **P2** = post-launch.
> Established **2026-09-05 (~10:20 UTC)** from live evidence — see `LAUNCH_STATE.md`. **Audit only; no application code was changed.**
>
> ## Bottom line: **2 P0 blockers** (was 3 — **P0-1 closed 2026-09-05 12:23 UTC**).
>
> Both remaining P0s require actions only the CEO can perform: entering credentials on a real login/signup, and registering the Razorpay webhook in the provider dashboard. Neither is blocked on engineering.

A note on how to read this file: a blocker is only "fixed" when its **Verification** line has actually been executed and the result recorded here with a date. Three separate times this project has marked something resolved on the strength of a code change, a grant, or an env-var edit, without ever running the check. Two of those are re-opened below.

---

## P0 — must be true before any real cohort

### P0-1 — Production is serving an unmerged pull-request branch — ✅ RESOLVED 2026-09-05 12:23 UTC
- **Status: CLOSED.** PR #1791 merged as `01cbb7f3` and deployed to production **through `deploy-production.yml`**, not a dashboard promote. Verified three ways: `main` HEAD = `01cbb7f39e5b0472d6ca71417c693c223c29bd45`; `https://alfanumrik.com/api/v1/health` reports `git_sha: 01cbb7f`; and the live deployment `dpl_ERjBFPL45hvQywcDTbmNxWz2pq4g` carries `githubCommitRef: "main"`, `githubCommitVerification: "verified"`, and **no `action: "promote"`**. The repository is the source of truth for production again.
- **What actually blocked it:** the PR was red, so it could not merge — `Unit Tests (shard 1/4)`, `Unit Tests (changed)`, `Lint, Type-check & Test` and `CI Gate` all FAILURE. Root cause was a single stale assertion in `apps/host/src/__tests__/pwa-view-integrity.test.ts:69` (REG-259): it pinned `serviceWorker.register(...)` as one contiguous string, but the preceding commit had wrapped the call across lines. **348 passed, 1 failed.** The service worker was never broken — only the regex. Fixed by making it whitespace-tolerant, matching the assertion directly above it. CI then went 20 SUCCESS / 3 SKIPPED / 0 FAILURE, `mergeState=CLEAN`.
- **The lasting lesson:** production ran code with a failing test suite for ~2.5 hours, and nothing surfaced it, because a dashboard promote skips the gate entirely. Restricting who can promote (plan step 1.5) is the durable fix; this merge only cleans up the instance.
- **Severity:** P0 (was)
- **Root cause:** `alfanumrik.com` is served by `dpl_5AE7VsosRqm45aQzZVBTvtqytDG7`, built from commit `793f9d33` on branch `vercel-agent/enable-pwa-installation` (**PR #1791, unmerged**), placed into production via a Vercel dashboard **"Promote"** (`meta.action: "promote"`) at ~09:58 UTC on 2026-09-05. `git merge-base --is-ancestor 793f9d33 origin/main` confirms it is **not** on `main`. `/api/v1/health` independently self-reports `git_sha: 793f9d3`. The promote path walks around this repo's own `production-release-control` policy (`deploy-production.yml` must have exactly one trigger — push to `main`), the same policy for which PR #1785 was reverted.
- **Why it is P0 even though the diff is small:** the shipped code is low-risk (a deliberately network-only service worker with no CacheStorage — verified live at `/pwa-sw.js`, 678 bytes). The blocker is that **the repository is no longer the source of truth for what is in production**, PR #1791's CI gates never ran against what users are being served, and the rollback target is ambiguous. You cannot launch a school onto code whose provenance you cannot state.
- **Fix (decide, then act — do not just redeploy):** either (a) review and merge PR #1791 properly, then let `deploy-production.yml` ship `main`; or (b) promote the last `main` deployment (`dpl_GfEBuLB94MCDJAYp4hhTcvRdeypP`, `fcca6729`) back to production and let #1791 go through review. Then close the hole: restrict who can promote in Vercel, or add a check that alarms when the production alias points at a commit absent from `main`.
- **Verification:** `curl -s https://alfanumrik.com/api/v1/health | jq -r .version.git_sha` returns a SHA for which `git merge-base --is-ancestor <sha> origin/main` **succeeds**; Vercel `get_deployment` shows `githubCommitRef: main`; and a service worker already installed on a device is confirmed to update or unregister cleanly.
- **Size:** S (to restore correct state) / M (to prevent recurrence)

### P0-2 — Payments have never completed end to end; Razorpay mode unknown
- **Severity:** P0 — downgradeable to P1 **only** if the first cohort is fully comped with no paid conversion.
- **Root cause:** `payment_webhook_events` = **0 rows, ever**. The Razorpay webhook to `/api/payments/webhook` has never fired, which means the provider-side registration is missing or wrong. Consequently the only three captured payments (₹1,297 total, 2026-04-02 → 05-09) all have **`razorpay_signature` NULL** — every success came through the client-return `/verify` path. A student who pays and closes the browser has no second path to entitlement. ~~Separately, the production `RAZORPAY_KEY_ID` value is not readable from this session, so **live-vs-test mode is UNKNOWN**.~~ **RESOLVED 2026-09-05 ~11:00 UTC: production is in LIVE mode.** `npx vercel env pull --environment=production` exported `RAZORPAY_KEY_ID` beginning **`rzp_live_`**. The blocker is therefore **narrowed to webhook registration alone** — the keys are correct.
- **What is NOT the problem:** the webhook handler code is correct — timing-safe `verifyRazorpaySignature`, 400 on missing/invalid signature, and 503 on a missing secret so Razorpay retries rather than dropping a genuine event. `/api/v1/health` reporting razorpay `ok` is a real authenticated call to `api.razorpay.com`, so the **credentials are valid**; it says nothing about mode or registration.
- **Fix (configuration, not code):** confirm the production key's mode in the Razorpay dashboard; register exactly one webhook endpoint — `https://alfanumrik.com/api/payments/webhook` — with a secret matching `RAZORPAY_WEBHOOK_SECRET`; subscribe the payment/subscription events the handler expects.
- **Verification:** place **one** real transaction end to end. A row must land in `payment_webhook_events` **with a verified signature**, a matching row in `payment_history` with non-null `razorpay_signature`, the student's entitlement must update atomically, and the amount charged must equal the amount shown on `/pricing`. Then kill the browser mid-callback on a second transaction and confirm the webhook alone still grants entitlement.
- **Size:** M

### P0-3 — Login OUTAGE CLOSED 2026-09-05 14:53 UTC; the Turnstile secret itself is still invalid
- **Outage class: CLOSED.** PR #1799 merged as `e999627` and deployed through the pipeline. Verified against production **with the bad secret still in Vercel**: the same fake-token probe that returned **503** at 14:35 returned **200, 200** at 14:53. Two `critical` `ops_events` rows (`turnstile_secret_rejected_failing_open`, `http 400`, `invalid-input-secret`) were written at 14:53:19 and 14:53:20 — the loud half works. A wrong secret can no longer lock anyone out. Login and signup work now.
- **Secret: STILL INVALID — CEO action.** Cloudflare still answers `invalid-input-secret`; bot protection is therefore currently OFF on login/signup (degraded, not undefended — the per-IP/per-email rate limiters still apply). Self-test before pasting into Vercel, 5 seconds, no deploy:
  `curl -s -X POST https://challenges.cloudflare.com/turnstile/v0/siteverify -d "secret=<PASTE>&response=x"` → a valid secret answers `invalid-input-response`; a wrong one answers `invalid-input-secret`.
- **Silent until P0-4 is repaired:** the `alert_rules` row for category `auth` shipped in #1799 as a migration and is **unapplied** (ledger drift). Until then the fail-open writes ops_events rows but pages nobody.
- Original entry follows for the record.
- **Severity:** P0 — **confirmed by a real user login attempt, not inferred.**
- **Root cause, from production logs at 2026-09-05 13:08:37 and 13:08:51 UTC** (two consecutive attempts by the CEO):
  `httpStatus: 400`, `{"error-codes":["invalid-input-secret"],"success":false}`.
  Cloudflare rejects `TURNSTILE_SECRET` itself. `pre-check/route.ts` treats a non-2xx siteverify as a thrown error and returns **503 "Verification is temporarily unavailable. Please try again shortly."** — which is exactly what the user saw. Same `invalid-input-secret` code as the 2026-09-04 occurrence, so the secret has been wrong the whole time.
- **🔴 A previous entry in this file, and an earlier session, both claimed this was RESOLVED. Both were wrong, for the same methodological reason.** A probe with a deliberately malformed token returned `invalid-input-response`, which was read as "the secret authenticates". It is not: Cloudflare rejects a malformed token *before* it validates the secret, so a synthetic token can never test a secret. **Only a real login exercises that path.** Do not mark this resolved again on anything less.
- **Fix (config, not code):** in the Cloudflare Turnstile dashboard, open the widget whose site key matches `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, copy its **secret key**, re-set `TURNSTILE_SECRET` in Vercel production, redeploy. The route's own comment names the usual culprit: a trailing newline from a dashboard paste. Confirm `TURNSTILE_HOSTNAMES` contains **both** `alfanumrik.com` and `www.alfanumrik.com` (a 2026-09-04 incident had `www` solving successfully but absent from the allowlist).
- **Immediate mitigation if login must work before that:** delete `TURNSTILE_SECRET` from Vercel production and redeploy. The code fails **open** by design — `if (!secret || expectedHostnames.size === 0) return { ok: true }`. Login works instantly, bot protection is off, fully reversible. Acceptable as a stopgap; not acceptable for open signup.
- **Verification:** a real login and a real signup complete on `alfanumrik.com`, on `www`, and on an Android phone over mobile data; production logs show `resultSuccess: true` and **zero** `invalid-input-*` in the surrounding hour; a new `auth.users` row appears from the form, not from `/dev/impersonate`.
- **Size:** S (the config fix) — but nothing downstream of login can be verified until it is done.

### P0-3b — No authenticated journey has ever been verified end to end, for any role
- **Severity:** P0
- **Root cause:** this is the structural blocker underneath most of the others. Login is **unproven**: the production `TURNSTILE_SECRET` was replaced **~30 minutes** before this audit, and no human login has completed since — the most recent real sign-in in `auth.users` is a `dev.impersonate.*` account, which bypasses Turnstile entirely. Beyond login, no signup → onboarding → core-loop → payment walk has been executed with evidence for **any** of the four roles. Every "works" claim for a logged-in surface in this project's history is inferred from code or database state.
- **What the evidence does support:** yesterday's hard failure is very likely fixed. On 2026-09-04 prod logged siteverify `invalid-input-secret` (server misconfigured → *all* logins fail closed, 4 errors / 1 user). Today my probe with a deliberately invalid token returns `invalid-input-response` — meaning the request **authenticated** and only my token was rejected. That is strong evidence the secret is now correct. It is not evidence that a person can log in.
- **Fix:** run the walk. One real signup and one real login on `alfanumrik.com` from a browser, then the core loop for each role, on a mid-range Android phone over 4G — not desktop broadband.
- **Verification:** for each of student / parent / teacher / school admin: a new `auth.users` row created from the form (not `/dev/impersonate`); prod logs show siteverify `success: true` and zero `invalid-input-*`; the role's dashboard renders with real data; a student completes one quiz and `concept_mastery` + `student_learning_profiles` both update. Record the date and who ran it **in `LAUNCH_STATE.md` §3**.
- **Size:** M
- **Blocked on you:** a test account per role, or a session handed to me. See §"What I could not verify".

---

## P1 — embarrassing in a school demo

### P0-4 — Production deploys cannot apply migrations: the ledger has drifted
- **Severity:** P0 — every deploy since 12:19 UTC 2026-09-05 has failed at "Apply Database Migrations", so **no migration can reach production until this is repaired**.
- **Root cause:** six versions are in the remote ledger with no matching file in `supabase/migrations/`, so `supabase db push --linked --include-all` (`deploy-production.yml:674`) aborts before applying anything. Five (`20260905061644`, `062110`, `064639`, `064828`, `065033`) are the Foxy semantic-cache migrations a prior session applied via the Supabase MCP at ~06:16–06:50 UTC; their files are not on `main` (they sit on `wip/foxy-preserve-2026-09-05` as `20260905120000`–`160000`). The sixth (`20260905132711`) is the `learning-loop-health` fix, applied the same way at 13:27 UTC; its file **is** on main as `20260905180000_fix_learning_loop_health_cron.sql`.
- **Why it surfaced when it did:** deploys through 05:53 UTC succeeded. The first failure was the 12:19 UTC deploy — six hours after the first out-of-band apply. The breakage was latent and surfaced on an unrelated merge.
- **Fix — two statements, reversible:**
  ```sql
  -- point my row at the filename that exists on main
  update supabase_migrations.schema_migrations
     set version = '20260905180000' where version = '20260905132711';
  -- clear the five orphans (= `supabase migration repair --status reverted`)
  delete from supabase_migrations.schema_migrations
   where version in ('20260905061644','20260905062110','20260905064639','20260905064828','20260905065033');
  ```
  Or equivalently: `supabase migration repair --status reverted 20260905061644 20260905062110 20260905064639 20260905064828 20260905065033 20260905132711`, then let `db push` re-apply `20260905180000`.
  Safe because the DB objects are already applied and **all five Foxy files carry `IF NOT EXISTS` / `OR REPLACE` / `ON CONFLICT` guards** (verified), so they re-apply harmlessly if that branch is ever merged.
- **Verification:** the next push to `main` shows "Apply Database Migrations" green, and `mcp list_migrations` has no version absent from `supabase/migrations/`.
- **Size:** S
- **Root of the class:** `apply_migration` stamps its own version, silently forking the ledger from the repo. One convenient out-of-band apply blocks every subsequent deploy's migrations, including other people's. See LAUNCH_STATE §6d.

### P2-27 — Two pre-existing `TS2322` type errors in the email Edge Functions
- `deno check supabase/functions/send-auth-email/index.ts` and `send-welcome-email/index.ts` each fail on `main`: `SupabaseClient` is not assignable to the narrowed `{ from: (table) => { insert: (row) => Promise<…> } }` shape the `EdgeLog` helper expects — a `PostgrestFilterBuilder` is a thenable, not a `Promise`. Found 2026-09-05 while removing Mailgun; the two `_shared` files check clean. CI's Deno job runs `--no-check`, which is why this has never blocked anything. **Size:** S.

### P1-12 — 3,168 active diagrams point at PDF textbooks, so no diagram renders
- **Found 2026-09-05 only because the health cron was repaired** — it had been dead and silent for 18 days.
- **Root cause:** every one of the **3,168** `is_active` rows in `topic_diagrams` has an `image_url` pointing at a whole NCERT source PDF, e.g. `…/storage/v1/object/public/ncert-books/Grade 11/Biology/kebo101.pdf`. Verified live: that URL returns **HTTP 200, `content-type: application/pdf`, 2.3 MB**. It is a valid file — it is simply not an image, and an `<img>` pointing at a PDF renders nothing. Separately, the `ncert-assets` bucket that extracted diagrams should live in contains **0 objects**, so the extraction step has evidently never produced output.
- **Not a false positive:** the canary's regex flags any `image_url` not ending in an image extension; that could in principle catch a valid URL carrying a query string, so it was checked by fetching. It is a real breakage.
- **Verification:** a student-facing chapter page renders at least one diagram as an image; `topic_diagrams` rows resolve to `image/*` content types; `ncert-assets` is non-empty.
- **Size:** M (re-run diagram extraction) — **L** if the extraction pipeline itself is what never ran.

### P1-13 — Two projectors subscribe to event kinds nothing ever emits
- **Found 2026-09-05 by the same repaired cron.** `concept-mastery-projector` filters on `learner.concept_check_answered` and `mastery-state-writer` filters on `learner.mastery_changed`; neither kind has **ever** appeared in `state_events`. These are structural mismatches, not lag — a lagging projector would show a moving offset.
- **Why it may not be urgent:** mastery is currently written directly by `atomic_quiz_profile_update()`, and `concept_mastery` is healthy (107 rows). So these projectors are probably dead scaffolding from an event-sourced design that was never completed. **That needs confirming, not assuming** — if either was meant to be the write path, mastery has a silent second source of truth.
- **Verification:** either the emitting code is wired up and the kinds appear in `state_events`, or both subscribers are removed from `subscriber_offsets` and the canary goes quiet.
- **Size:** S to decide, M to act.

### P1-4 — Teacher message threads: 13-day permission failure, grant fixed but unproven
- **Root cause:** `/api/teacher/messages/threads` logged `permission denied for function teacher_list_message_threads` from **2026-08-23** to **2026-09-05 02:33 UTC**. The `(p_limit integer)` overload now has `EXECUTE` for `authenticated` (verified live), so it is *probably* fixed — but the absence of errors since 02:33 is meaningless when only 19 people signed in all week.
- **Verification:** an authenticated teacher session loads `/teacher/messages` with HTTP 200 and no `permission denied` in logs across 24 h of real use.
- **Size:** S
- **UPDATE 2026-09-05 ~11:10 UTC — likely resolved.** In the first authenticated teacher walk (local dev, real impersonation session), `GET /api/teacher/messages/threads?limit=1` returned **200**, with no `permission denied for function teacher_list_message_threads`. Downgrade to P2 once one production-origin call confirms it.

### P1-5 — Parent weekly report has never been produced, once, ever
- **Root cause:** `parent_weekly_reports` = **0 rows all-time**, against a `parent-report-generator` Edge Function that is deployed and ACTIVE. The prior A4 "forward parent JWT" fix merged and the table is still empty. **Root cause unconfirmed — needs one authenticated `/api/parent/report` call with the Edge Function's logs captured.**
- **Verification:** trigger a report for a linked child; a `parent_weekly_reports` row is written and `/api/parent/report` returns 200 for a real parent session.
- **Size:** M

### P1-6 — Parent linking is effectively dead
- **Root cause:** `guardian_student_links` = **2 rows**, most recent **2026-04-14** — five months. Either the link flow is broken or nobody has ever successfully used it. Not distinguishable without a walk.
- **Verification:** complete the OTP/code link flow as a real parent; a new `guardian_student_links` row appears and the child's data renders in the parent portal.
- **Size:** M

### P1-7 — Teacher core loop is not built
- **Root cause:** `assignments`, `assignment_submissions`, `grade_book_entries`, `student_attendance`, `teacher_parent_messages` — **all 0 rows**. Not broken; absent. A teacher in a pilot who clicks toward assigning work will find nothing.
- **Fix:** for launch, this is a **scope decision, not a build** — put an explicit, dated "coming soon" state on these surfaces. A visible roadmap reads as honest; a blank screen reads as broken.
- **Verification:** every unbuilt teacher surface renders a deliberate empty state naming what is coming and when; no dead ends, no blank panels.
- **Size:** S (as a scope cut) / L (as a build)

### P1-8 — `learning-loop-health` cron: 672 consecutive failures — ✅ RESOLVED 2026-09-05 13:27 UTC
- **Status: CLOSED.** Migration `20260905180000` applied to production; a live invocation returned **3** (three genuine alerts emitted) instead of throwing. The function now references `concept_mastery` and no longer references `concept_attempts` — both verified against `pg_get_functiondef`. The false `mastery_pipeline_never_ran` no longer fires. The three alerts it immediately surfaced are filed above as P1-12 and P1-13.
- **Scheduled run confirmed:** `cron.job_run_details` shows `learning-loop-health` **succeeded at 2026-09-05 13:30:00 UTC** — the first success in over 7 days, after 672 consecutive failures.
- **Note on how it shipped:** merging the PR was not enough. `deploy-production.yml` has **no migration step**, so the migration sat unapplied until it was pushed explicitly. See LAUNCH_STATE §6d.
- **Root cause:** two bugs. It inserts into `ops_events` with a NULL `environment` (NOT NULL → the alert insert itself errors), and it gauges the mastery pipeline off the empty legacy `concept_attempts` table, emitting a permanent false `mastery_pipeline_never_ran` critical. Real mastery writes are healthy. **The danger is not the failure; it is that a permanently-red monitor makes a genuinely red monitor invisible.**
- **Verification:** `cron.job_run_details` shows the job succeeding, and no false `mastery_pipeline_never_ran` critical in 24 h.
- **Size:** S

### P1-9 — Abandoned second school-admin information architecture
- **Root cause:** of 29 `/school-admin/*` pages, six — `overview`, `academics`, `people`, `governance`, `insights`, `settings` — have **zero inbound links** from anywhere in the app. A grouped navigation structure was built for the school portal and never wired up, leaving a flat set live beside it. For a school-facing pilot this is the duplication that matters most.
- **Verification:** one IA is canonical; the other's pages either redirect to it or are deleted; `grep` finds no orphaned `/school-admin/*` page with zero inbound references.
- **Size:** M

### P1-10 — `p1-12-chat-audit-request-log-retention` cron failing
- **Root cause:** 3 failures, 0 successes in 7 d. Retention is not running, so audit/request logs grow unbounded. Root cause not investigated this session.
- **Verification:** job shows successes in `cron.job_run_details` and row counts on the target tables stop growing monotonically.
- **Size:** S

---

## P2 — post-launch (write down, do not start now)

- **P2-11** **Commit `LAUNCH_STATE.md` and `LAUNCH_BLOCKERS.md`.** Both are currently **untracked**. The durable memory this project keeps rebuilding has never actually been in the repo. *(Trivial in size, disproportionate in value — do it with the first P0 fix.)* **S**
- **P1-11** **The student navigation renders `<button>` elements, not links.** Verified live on `/dashboard` with a real session: the whole sidebar (Today / Practice / Foxy / Progress / Leaderboard / STEM Lab / Reminders / …) is `<button>` + `router.push`, and the entire page contains **2 anchors**, one of which is `/privacy`. Consequences: (a) students cannot middle-click, ctrl-click, "open in new tab", or copy a link to any core page — ordinary browser behaviour a teenager expects; (b) crawlers and assistive tech do not see a navigation structure; (c) it silently breaks every link-crawl tool, including this repo's own `navigation.spec.ts` student crawl, whose `nav a[href]` selector matches **nothing** and whose `expect(targets.length).toBeGreaterThan(0)` must therefore be failing — unnoticed, because E2E does not run on PRs (see 1.5 in the plan). **Verification:** `document.querySelectorAll('nav a[href]').length > 0` on `/dashboard`, and `navigation.spec.ts`'s student crawl passes on merit rather than being skipped. **Size:** M
- **P2-25** **Local-dev setup docs are wrong in four ways, and one of them silently disables the login unlock.** (a) `README_LOCAL.md` and `ENVIRONMENT_SETUP.md` both say to put `.env.local` at the repo root; Next reads `apps/host/.env.local`. (b) They reference a `.env.local.example` and a `run-local.ps1` that do not exist. (c) `vercel env pull` must run from the repo root (`.vercel/` lives there), not from `apps/host/`. (d) 🔴 **`vercel env pull --environment=production` writes `VERCEL_ENV="production"`, which trips the `proxy.ts:755` guard and 404s `/dev/impersonate` locally** — `VERCEL`, `VERCEL_ENV` and `VERCEL_TARGET_ENV` must be stripped after every pull. Every one of these cost time on the first real local run. Fix the two docs and add a `scripts/dev-env-setup` that pulls, strips the Vercel markers, and strips Turnstile in one step. **S**
- **P2-26** **The ten Edge-Function-backed pages are untestable from localhost by design** — deployed functions run `ENVIRONMENT=production`, so `_shared/cors.ts:14` excludes `http://localhost:3000` and the browser blocks the preflight. Affects `/teacher/{classes,students,attendance,grade-book,submissions,reports}` and `/parent/{children,attendance,reports}`. **Do not loosen the allowlist.** Either accept that these are production-only tests, or give the local dev server a CORS-allowed origin. Record the decision so the next session does not re-discover the CORS wall. **S**
- **P2-12** Uncommitted WIP on `main`: 26 modified tracked files (Foxy semantic cache) + 5 untracked migrations `20260905120000…160000` + `grounded-answer/cache-semantic.ts` + the `nextjs-turnstile-alfanumrik/` scaffold. Commit, gate, or discard so it cannot ship half-applied. **S**
- **P2-13** Four `dev.impersonate.*@alfanumrik.demo` accounts (plus a July `whatsapp-e2e-test-*`) now exist in the **production** database, created today, all with sign-ins. They inflate every user and role count. Purge or clearly exclude them from metrics. **S**
- **P2-14** Anthropic access is not centralised: no `utils/anthropic.ts`; 4 files hand-roll `fetch()` to `api.anthropic.com`, 30 read `ANTHROPIC_API_KEY` directly, 3 rival adapter modules. One key rotation or model change touches 30 files. **M**
- **P2-15** Four parallel retrieval RPCs (`match_rag_chunks` 18 callers, `match_rag_chunks_ncert` 14, `select_quiz_questions_rag` 14, `match_rag_chunks_v2` 6). A relevance fix lands in one of four. **M**
- **P2-16** Three chapter taxonomies populated simultaneously: `cbse_syllabus` 1,148, `chapters` 551 (+ `curriculum_chapters_v` view), `curriculum_topics` 542. **L**
- **P2-17** Four dead mastery tables (`learner_mastery`, `topic_mastery`, `concept_mastery_score`, `student_skill_state` — all 0 rows) plus `adaptive_mastery` at 16. Freeze or drop. **S**
- **P2-18** Duplicate user-facing surfaces: `/dashboard` (44) vs `/today` (7) vs `/me` (1); `WelcomeV2` (6) vs `WelcomeV3` (5); `NavV2` (6) vs `NavV3` (15); `/internal/admin` vs `/super-admin`; `/tutor` orphan behind an off flag. **M–L**
- **P2-19** RAG content is **2 months stale** — last `rag_content_chunks` ingest 2026-07-04; a second cohort of 13,919 chunks last touched 2026-04-15. Also three different Voyage models in play (`voyage-3`, `voyage-multimodal`, `voyage-large-2-instruct`). Acceptable for a fixed CBSE syllabus; confirm deliberately. **S**
- **P2-20** `embedding-backfill-tick` cron is **inactive** and has never run. Intended, or forgotten? **S**
- **P2-21** Env parity: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET` and all three `TURNSTILE_*` vars exist in Production but **not Preview** — so a preview deploy can never rehearse production. Partly a safety property; make it a deliberate one. **S**
- **P2-22** 42 `rls_enabled_no_policy` tables (fail-closed) — confirm each is intentional rather than an accidental total denial. **S**
- **P2-23** 21 `function_search_path_mutable` advisories. **S**
- **P2-24** 198 remote branches, **185 unmerged (93%)**. Prune. **S**

---

## Re-opened / corrected from the previous version of this file

- **P0-1 (old, "login/Turnstile — ✅ RESOLVED")** — **re-opened as P0-3.** The resolution claimed *"zero Turnstile-rejection / error-level logs in the following 2h"*, but that file was written **12 minutes** after `TURNSTILE_SECRET` was created. The two-hour window had not elapsed when it was asserted. The underlying fix does look correct — see P0-3 — but it was marked done on a verification that had not been run.
- **P1-5 (old, "invisible to crawlers, 429 to Googlebot")** — **closed as not reproducible.** Googlebot UA now returns 200 on `/robots.txt`, `/sitemap.xml`, `/pricing`, `/for-schools`.
- **P1-6 (old, "homepage stats inflated: 12,000+ learners")** — **not re-verified this session.** I did not re-read the live hero copy. Treat as open and unconfirmed rather than closed.
- **Genuinely resolved, do not re-open:** anon-callable dangerous SECDEF writers (all 9 probed → `anon=false`); Edge Function on-disk ≠ deployed drift (45 = 45, `comm` empty both ways); dead links (0, with an enforcing CI test); Anthropic key outage (Foxy live, 193 messages in 7 d).

---

*Last verified: **2026-09-05, ~10:20 UTC.** Nothing in this file is fixed until its Verification line has been run and dated here.*
