# RAG Grounding Integrity Rollout — Ops Runbook

**Owner:** ops (execution) + architect (reviewer) + founder (go/no-go at pilot)
**Source spec:** `docs/superpowers/specs/2026-04-17-rag-grounding-integrity-design.md` §11
**Related runbooks:** `voyage-outage.md`, `claude-outage.md`, `coverage-regression.md`, `verifier-queue-stuck.md`, `student-complaint-triage.md`, `scoring-integrity-epoch.md`
**Estimated elapsed:** 10-14 days end-to-end (Day 1 deploy → Day 10 full rollout)

## Prerequisites (before Day 1)

- [ ] All commits on `feat/grounded-rag` merged to `main` via PR with quality + testing sign-off
- [ ] Staging smoke: full flow works end-to-end on staging with `ff_grounded_ai_enabled=true` for at least one (grade, subject) pair
- [ ] Ops team (minimum 2 people) has read all 5 operational runbooks
- [ ] On-call rotation covers Day 1 → Day 10 window
- [ ] `npx tsx scripts/pre-rollout-checklist.ts` exits 0 against the main branch worktree
- [ ] Supabase DB has a recent verified backup (see `docs/BACKUP_RESTORE.md`)
- [ ] Sentry DSN configured for prod; `/monitoring` tunnel verified

## Day 1 — Apply migrations + deploy

**Actor:** architect (runs migrations) → ops (verifies) → architect (deploys functions)

- [ ] Snapshot prod DB (Supabase dashboard → Database → Backups → "Create on-demand backup")
- [ ] `supabase db push` against prod
  - New migrations from Phase 1-4 (13 files, timestamps `20260418100000` through `20260418120000`)
  - Watch for errors; if any migration fails, stop and investigate before proceeding
- [ ] Verify key tables exist with expected row counts:
  ```sql
  SELECT
    (SELECT count(*) FROM cbse_syllabus)                          AS cbse_syllabus_rows,
    (SELECT count(*) FROM question_bank WHERE deleted_at IS NULL) AS active_questions,
    (SELECT count(*) FROM feature_flags WHERE flag_name LIKE 'ff_grounded_ai_%') AS flag_rows,
    (SELECT count(*) FROM permissions WHERE code='super_admin.access') AS super_admin_perm;
  ```
  Expect: `cbse_syllabus_rows > 0`, `flag_rows = 5`, `super_admin_perm = 1`.
- [ ] Run backfill: `npx tsx scripts/backfill-cbse-syllabus.ts --prod`
  - Populates `cbse_syllabus` from the CBSE catalog files
  - Re-run verification count query; `cbse_syllabus_rows` should match expected CBSE catalog size
- [ ] Deploy Edge Functions:
  - [ ] `supabase functions deploy grounded-answer`
  - [ ] `supabase functions deploy verify-question-bank`
  - [ ] `supabase functions deploy coverage-audit`
- [ ] Schedule Edge Function crons:
  - [ ] `supabase functions schedule verify-question-bank --cron "*/30 * * * *"`
  - [ ] `supabase functions schedule coverage-audit --cron "30 21 * * *"` (03:00 IST — off-peak)
- [ ] Deploy Next.js app (Vercel auto-deploy on main merge, or manual): verify `/api/v1/health` returns 200 post-deploy
- [ ] **Flags stay OFF.** Confirm:
  ```sql
  SELECT flag_name, is_enabled FROM feature_flags WHERE flag_name LIKE 'ff_grounded_ai_%';
  ```
  All 5 rows must show `is_enabled = false`.

## Day 1-2 — Verifier drain begins

**Actor:** ops (monitoring only; no manual intervention)

- [ ] Open `/super-admin/grounding/verification-queue`
- [ ] Baseline: note `legacy_unverified` count (will be your entire current question_bank minus any legacy `verified_against_ncert=true` rows)
- [ ] Expected drain rate: ~1000 rows per 30-min cron tick off-peak (slower during peak hours due to Claude rate share)
- [ ] **Checkpoint T+2h**: `throughputLast24h.verified_per_hour` > 0 and backlog decreasing
- [ ] **Checkpoint T+12h**: backlog should be ~50% drained for typical question_bank size
- [ ] **If stuck**: see `verifier-queue-stuck.md`. Do NOT proceed to Day 3 until verifier is demonstrably working.

## Day 3 — Dashboards live

**Actor:** ops (review)

- [ ] Open `/super-admin/grounding/health` — verify all 5 tiles populate with non-error data:
  - callsPerMin (5 callers: foxy, ncert-solver, quiz-generator, concept-engine, diagnostic)
  - groundedRate (all 5 callers)
  - abstainBreakdown
  - latency (p50, p95, p99)
  - circuitStates (voyage + claude, all `closed`)
- [ ] Open `/super-admin/grounding/coverage` — verify severity distribution renders; no 500 errors
- [ ] Open `/super-admin/grounding/traces` — verify trace rows accumulate (even with flags off, verify-question-bank writes traces)
- [ ] Open `/super-admin/grounding/ai-issues` — empty is expected; verify page doesn't error
- [ ] If any dashboard 500s: do NOT proceed to pilot. File a frontend ticket, unblock before Day 4.

## Day 4 — Pilot (Grade 10 Science)

**Actor:** ops (flips flags) + founder (go/no-go call at 11:00 IST)

### 09:00 IST — Preconditions
- [ ] Verify pilot pair readiness:
  ```sql
  SELECT
    count(*) FILTER (WHERE verification_state = 'verified') * 1.0 / NULLIF(count(*),0) AS verified_ratio,
    count(*) AS total_questions
    FROM question_bank
   WHERE grade = '10' AND subject = 'science' AND deleted_at IS NULL;
  ```
  Required: `verified_ratio >= 0.9` AND `total_questions > 100` (non-trivial coverage)
- [ ] Verify chapters are ready:
  ```sql
  SELECT rag_status, count(*)
    FROM coverage_audit_snapshots
   WHERE created_at = (SELECT max(created_at) FROM coverage_audit_snapshots)
     AND grade = '10' AND subject_code = 'science'
   GROUP BY rag_status;
  ```
  Required: majority of chapters in `ready` status (tolerate 1-2 `partial` with low `request_count`)

### 09:15 IST — Flip flags
Apply all 6 flips as a single operation (or as close to atomic as ops tooling allows):
- [ ] `ff_grounded_ai_enabled = true` (global master switch)
- [ ] `ff_grounded_ai_foxy = true`
- [ ] `ff_grounded_ai_quiz_generator = true`
- [ ] `ff_grounded_ai_ncert_solver = true`
- [ ] `ff_grounded_ai_concept_engine = true`
- [ ] Via `/super-admin/grounding/verification-queue` → action `enable-enforcement`, payload `{ grade: "10", subject_code: "science" }` (the POST handler enforces the 0.9 precondition server-side; if it 400s, STOP and investigate)

### 09:30-10:30 IST — Internal smoke test (spec §11.4)
5 internal accounts, each runs through:
- [ ] Grade 10 Science Foxy conversation (3-5 turns) — verify grounded answers with chunk citations
- [ ] Grade 10 Science quiz (10 questions) — verify generation + submission
- [ ] Grade 10 Science NCERT solver (1 problem) — verify structured solution
- [ ] Submit one deliberate "Report issue" to confirm end-to-end complaint flow
Each account records: grounded:true rate, abstain reasons seen, latency perception, any weirdness.

### 11:00 IST — GO / NO-GO decision

Measure from `grounded_ai_traces` where `created_at > '09:30 IST'`:

| Criterion | Target | Measure how |
|---|---|---|
| Abstain rate | ≤ 10% | `count(*) FILTER (WHERE grounded=false) / count(*)` |
| Critical ops_events | 0 | `ops_events WHERE category LIKE 'grounding.%' AND severity='critical'` |
| P95 latency | ≤ 25s | `percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)` |
| Circuit trips | 0 | `circuitStates` tile on health dashboard |

- [ ] **GO** if all 4 pass: proceed. Announce in #ops. Monitor `/super-admin/grounding/health` for 2h.
- [ ] **NO-GO** on any failure: execute **Emergency Rollback** (below), document the failure mode, loop in ai-engineer + architect.

## Day 5-10 — Progressive rollout

**Actor:** ops (daily check-in; one new pair per 24h)

Every 24h after Day 4 GO:
- [ ] Select next 2-3 (grade, subject) pairs to expand. Suggested expansion order (biggest-impact first):
  - Day 5: (10, math), (9, science)
  - Day 6: (9, math), (11, physics)
  - Day 7: (11, chemistry), (11, math)
  - Day 8: (12, physics), (12, chemistry)
  - Day 9: (12, math), (8, science)
  - Day 10: remaining grades 6-8 subjects in bulk
- [ ] Per pair precondition check (run the Day 4 09:00 queries for the new pair): `verified_ratio >= 0.9` AND majority chapters `ready`
- [ ] Flip enforcement via `/super-admin/grounding/verification-queue` POST `enable-enforcement` — server rejects if precondition fails
- [ ] Monitor the new pair's traces for 24h before adding the next one

## Post-rollout (first 7 days of full enforcement)

**Actor:** ops (daily) + founder (weekly digest)

Daily:
- [ ] Student-reported wrong answers rate target: ≤ 1 / 1000 Foxy turns (see `student-complaint-triage.md` query)
- [ ] Foxy `grounded:true` rate target: ≥ 75%
- [ ] Circuit trips per caller target: ≤ 5 / day (fewer is better; each trip is a red flag)
- [ ] P95 latency target: ≤ 25s steady state
- [ ] Triage any `ai_issue_reports` daily; do not let pending queue exceed 24h (per runbook)

Weekly:
- [ ] Generate founder digest from `/super-admin/grounding/health` screenshot + complaint rate query
- [ ] Review `coverage_audit_snapshots` for any new `partial`/`missing` chapters

## Post-30-days — Legacy cleanup

**Actor:** architect + ai-engineer (code changes)

After 30 days of stable enforcement across all pairs:
- [ ] Delete legacy inline AI code paths in:
  - `src/app/api/foxy/route.ts` — remove pre-grounded branch
  - `src/app/api/quiz/route.ts` — remove pre-grounded branch
  - `src/app/api/ncert-solver/route.ts` — remove pre-grounded branch
- [ ] Delete `GRADE_SUBJECTS` constant and all its usages (search `src/`)
- [ ] Remove soft-fail `try/catch` blocks that fall back from grounded-answer to legacy
- [ ] Resolve TODO-1 (subjects/chapters table deletion) — confirm no consumers left
- [ ] Remove `ff_grounded_ai_*` flags from feature_flags (they become permanent `true`)
- [ ] Update `ARCHITECTURE.md` to remove "legacy AI path" references
- [ ] Note: the scoring integrity epoch fix (commit `e53f07c`) is ALREADY a permanent fix — does NOT need to be rolled back at this stage.

## Emergency rollback

Apply in order of increasing blast-radius; stop as soon as the problem is contained.

### Per-pair rollback (minimum impact — affects one (grade, subject))
```sql
UPDATE ff_grounded_ai_enforced_pairs
   SET enabled = false, auto_disabled_at = now(), auto_disabled_reason = 'manual_rollback'
 WHERE grade = '<G>' AND subject_code = '<S>';
```
Or DELETE the row entirely. Students for that pair fall back to the non-enforced service path (still grounded but lenient).

### Per-caller rollback (affects one surface)
Flip one of:
- `ff_grounded_ai_foxy = false`
- `ff_grounded_ai_quiz_generator = false`
- `ff_grounded_ai_ncert_solver = false`
- `ff_grounded_ai_concept_engine = false`

Only that surface reverts to the legacy inline AI path.

### Global kill switch (maximum impact — all surfaces)
```
UPDATE feature_flags SET is_enabled = false WHERE flag_name = 'ff_grounded_ai_enabled';
```
Entire grounded-answer service disabled; all 4 callers use legacy inline. Use this only for service-wide incidents (Voyage + Claude both down, security issue, founder call).

See spec §10.4 for the full kill-switch decision tree.

## Contacts

- Ops on-call: see PagerDuty rotation
- ai-engineer: for AI/RAG/prompt issues
- architect: for DB/schema/deploy issues
- assessment: for CBSE pedagogy / content correctness issues
- founder: for Day 4 GO/NO-GO and any rollback decision beyond per-pair
