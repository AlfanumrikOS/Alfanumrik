# LAUNCH_BLOCKERS.md

> Every blocker numbered, with severity, a one-line root cause (or "root cause unknown — needs X"), **the specific verification that proves it fixed**, and size (S/M/L).
> **Severity:** **P0** = blocks a school using this on Monday · **P1** = embarrassing in a school demo · **P2** = post-launch.
> Established **2026-09-05 (~10:20 UTC)** from live evidence — see `LAUNCH_STATE.md`. **Audit only; no application code was changed.**
>
> ## Bottom line: **3 P0 blockers.**

A note on how to read this file: a blocker is only "fixed" when its **Verification** line has actually been executed and the result recorded here with a date. Three separate times this project has marked something resolved on the strength of a code change, a grant, or an env-var edit, without ever running the check. Two of those are re-opened below.

---

## P0 — must be true before any real cohort

### P0-1 — Production is serving an unmerged pull-request branch
- **Severity:** P0
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

### P0-3 — No authenticated journey has ever been verified, for any role
- **Severity:** P0
- **Root cause:** this is the structural blocker underneath most of the others. Login is **unproven**: the production `TURNSTILE_SECRET` was replaced **~30 minutes** before this audit, and no human login has completed since — the most recent real sign-in in `auth.users` is a `dev.impersonate.*` account, which bypasses Turnstile entirely. Beyond login, no signup → onboarding → core-loop → payment walk has been executed with evidence for **any** of the four roles. Every "works" claim for a logged-in surface in this project's history is inferred from code or database state.
- **What the evidence does support:** yesterday's hard failure is very likely fixed. On 2026-09-04 prod logged siteverify `invalid-input-secret` (server misconfigured → *all* logins fail closed, 4 errors / 1 user). Today my probe with a deliberately invalid token returns `invalid-input-response` — meaning the request **authenticated** and only my token was rejected. That is strong evidence the secret is now correct. It is not evidence that a person can log in.
- **Fix:** run the walk. One real signup and one real login on `alfanumrik.com` from a browser, then the core loop for each role, on a mid-range Android phone over 4G — not desktop broadband.
- **Verification:** for each of student / parent / teacher / school admin: a new `auth.users` row created from the form (not `/dev/impersonate`); prod logs show siteverify `success: true` and zero `invalid-input-*`; the role's dashboard renders with real data; a student completes one quiz and `concept_mastery` + `student_learning_profiles` both update. Record the date and who ran it **in `LAUNCH_STATE.md` §3**.
- **Size:** M
- **Blocked on you:** a test account per role, or a session handed to me. See §"What I could not verify".

---

## P1 — embarrassing in a school demo

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

### P1-8 — `learning-loop-health` cron: 672 consecutive failures, drowning real alerts
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
