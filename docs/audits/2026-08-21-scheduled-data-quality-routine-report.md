# Scheduled data-quality routine — report, 2026-08-21

**Type:** Automated scheduled routine (student-education-data integrity, pipeline-bug, and
adaptive-learning-workflow-blocker check). **Not** an ad hoc investigation.

**Why this is a doc and not a push notification:** the `PushNotification` tool was tried first
this run (not assumed unavailable from reading yesterday's report) and returned
`Error: No such tool available: PushNotification is disabled for this session, in subagents as
well as here.` So the channel really is down again today, independently confirmed rather than
inherited on trust. Per the existing convention set by
`docs/audits/2026-08-20-scheduled-data-quality-routine-report.md`, findings are persisted here
instead of being lost. **If a future run has the tool back, the first finding below is the one
to lead with.**

**No code, DDL, migration, or grant was applied by this routine.** Docs-only output (this file
plus new rows appended to `docs/audits/FIX-LEDGER.md`).

---

## Status check on yesterday's HIGH-severity finding: STILL UNRESOLVED

Re-verified against `docs/audits/2026-08-20-answer-key-serving-chain-risk.md`,
`docs/audits/pending-migration-order-risk.md`, `docs/audits/FIX-LEDGER.md` (row DB-41), and the
current migration chain (`supabase db push` state as reflected on disk).

- **4 of 5 quiz-serving RPCs still emit `correct_answer_index` to every authenticated caller**
  in production (`select_quiz_questions_rag`, `select_quiz_questions_v2`, both
  `get_quiz_questions` overloads). Any logged-in student can also read the answer key straight
  off `question_bank` (`question_bank_authenticated_read`, `USING (true)`, all columns).
- **Partial progress since yesterday, confirmed on disk today:** migration
  `20260821061915_revoke_public_execute_quiz_serving_rpcs.sql` closes the **anonymous** path
  (revokes the `PUBLIC` EXECUTE grant that let the unauthenticated `anon` key call all five
  RPCs). This is real, committed, well-documented, and — per the migration's own header — was
  deliberately scoped to grants only, explicitly leaving the **authenticated**-caller payload
  leak (the one that matters for real students) untouched and tracked separately. Two of my own
  audit agents today (architect, ai-engineer) independently found and corroborated this
  migration without being pointed at it, which is good cross-validation that it's genuinely on
  disk and does what its header says.
- **The fix for the authenticated-caller leak (`20260814000023`) is still unapplied**, and still
  conflicts with a second pending migration (`20260820120000`) that would silently re-clobber it
  if landed first — last-`CREATE OR REPLACE`-wins, and the existing regression test
  (`apps/host/src/__tests__/security/keyless-question-serving.test.ts`) cannot see the clobber
  because it statically scans one hardcoded filename. None of this has changed since yesterday's
  audit; see that document for the full per-RPC evidence and the recommended resolution options.
- **Why this belongs in a *data-quality* routine, not just a security one:** every quiz attempt,
  score, XP award, and mastery/adaptive-learning signal collected while this is live is
  unreliable — a student who can see the correct index before submitting produces data that
  looks like mastery but measures nothing. This is the single highest-leverage fix for the
  routine's stated mandate ("ensure student education data is monitored and analysed properly
  for personalized and adaptive learning").

**Recommendation unchanged from yesterday: route to assessment (P6 sign-off) + architect
(migration ordering/grant fix), needs explicit CEO approval before deploy per the constitution's
P1/P6 approval-required list.**

---

## New findings from today's 5-agent parallel audit (assessment, ai-engineer, architect,
backend, ops — each covering a different slice of the personalization data pipeline)

### 1. AI-monitor / command-center dashboards are structurally blind (HIGH, new — backend agent)

`apps/host/src/app/api/internal/admin/ai-monitor/route.ts` and
`.../command-center/route.ts` read from `ai_usage_stats`, but **no code path anywhere in the
repo writes to that table** (grepped all migrations, all Edge Functions, all app code — zero
`INSERT`/`upsert`). The dashboard will always show `0` requests / `0%` errors — indistinguishable
from "everything is fine" — even if the AI pipeline is fully down. Compounding this: both routes
discard Supabase `.error` fields on every parallel query (`Promise.all` destructuring only
`.data`), so a genuine query failure reads identically to "zero traffic." Recommend ops +
architect decide whether to resurrect the `ai_usage_stats` writer or repoint these dashboards at
a currently-live source, and add error-field logging in the interim. Added as DB-43 in the
ledger (see below).

### 2. IRT calibration: code is healthy, but production data says it isn't landing

My ai-engineer and architect agents both read `apps/host/src/app/api/cron/irt-calibrate/route.ts`
and independently called the pipeline "healthy" / "working as designed" — correct as a
*code-quality* read (solid validation, clamping, fail-open per-student writer, no swallowed
errors). But `docs/audits/FIX-LEDGER.md` row **DB-33** (a live production query from
2026-08-20) shows **471 of 478 students still at default theta/SE** despite the nightly cron
running. Code correctness and production outcome disagree — worth a live-DB check on *why*
calibration writes aren't landing (permissions? a silently-empty response count threshold? the
`MIN_RESPONSES` gate never being met for most students?) before trusting the "healthy" read.
Not something either agent could see from source alone.

### 3. Adaptive/personalization feature flags remain deliberately OFF (informational, reconfirmed)

`ff_adaptive_remediation_v1`, `ff_adaptive_loops_bc_v1`, `ff_school_pulse_v1` are all still OFF
in production, `constitution_pinned`, DB-trigger-protected against re-flipping. This matches
documented CEO-approved staged-rollout policy — not a defect — but it does mean Loops A-D and
Student/School Pulse are fully built, tested, monitored, and dormant. Flagging again only
because the task brief specifically asked about blockers to adaptive features "functioning as
intended" — this is the honest answer for personalization specifically (Daily Rhythm is live;
the closed-loop remediation program is not).

### 4. Everything else audited today — clean

- Adaptive-remediation cron worker, Student Pulse API boundary (`canAccessStudent`),
  `adaptive_interventions` RLS (all 4 read patterns present, writes service-role-only), the
  quiz-generator oracle gate (P6, REG-54), the RAG retrieval module, and the cme-engine
  tombstone replacement (event-driven state runtime / BKT writer) — no data-quality defects,
  no unhandled exceptions, no silent data drops found across ~15 files read in full by 5
  independent agents. Cron scheduling has no duplicate/conflicting entries; error isolation via
  `Promise.allSettled` in `daily-cron` means one failing step doesn't take down the others.
- Minor, low-severity items only (doc drift on retired `cme-engine`/`foxy-tutor` in
  `.claude/skills/ai-integration/SKILL.md`; `daily-cron`'s Deno logging isn't Sentry-backed the
  way the Vercel-side cron is; `subject_content_readiness_daily` isn't surfaced in the
  super-admin ops panel yet, only in a school-admin route) — see the five subagent transcripts
  for full detail if needed; not urgent enough to repeat in full here.

---

## Existing repair-program ledger (`docs/audits/FIX-LEDGER.md`) — not re-derived, referenced

That file independently tracks 42+ findings from a 2026-08-20/21 live-production audit spanning
well beyond this routine's scope (payment/RLS, secrets, XP-ledger drift, grade-encoding splits,
notification-recipient integrity, question-bank quality, embeddings pipeline). Several rows are
directly in this routine's mandate and remain **NOT-STARTED**: DB-3 (XP ledger drift, 14
students), DB-13 (concept_mastery counters never written, 40% of rows), DB-14 (XP source
disagreement, 30.7% gap), DB-28 (BKT absorbing at 1.0, can't decrease after a wrong answer),
DB-31 (an active MCQ with only 1 distinct option — unanswerable), DB-32 (32% of active questions
unreachable by topic/chapter, 12 of 23 subjects have zero curriculum topics), DB-33 (IRT never
calibrated, see above), DB-34 (100% of question embeddings NULL, ingestion queue stalled since
2026-08-01), DB-41 (the answer-key leak, detailed above). This routine did not re-verify these
against live production (no DB credentials available in this environment) — they are cited from
the existing ledger, which states its own `Before` values were measured live on 2026-08-20 and
recommends re-running detection queries before acting on any row.

---

## Closing note

Two consecutive runs of this routine (2026-08-20, 2026-08-21) have now found the push
notification channel unavailable and had to fall back to a docs artifact. That pattern itself is
worth a human look — either the channel is genuinely down and needs fixing, or something is
suppressing it. This file, like yesterday's, is a **persistence-only artifact, not a substitute
for the CEO actually seeing and acting on the unresolved HIGH-severity finding above.**
