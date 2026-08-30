# 21 — Dependency Graph & Reclassified Launch Risks

**Status:** PLANNING ONLY. Evidence gathered 2026-08-30 via fresh live/code re-verification (not re-stating the original audit's prose without checking).

---

## Part A — Execution Dependency Graph

```
IMMEDIATE, NO DEPENDENCIES (can start today, in parallel):
├─ P1-03  CI Gate required-check          [GitHub settings only, ~30 min]
├─ P0-01  verify deploy + secret          [read-only verification, ~1 day]
├─ P1-05  webhook-dispatcher token fix    [single file, but investigate bearer-priority bug first]
├─ P1-06  streak-guardian idempotency     [single file, pattern already proven]
├─ P1-02 step 1  embedding-coverage query [single read-only SQL query — do this FIRST, gates the rest of P1-02]
└─ P-01 (5 routes)  admin PII projection  [5 independent single-file changes, parallelizable]

DEPENDS ON A DECISION, NOT ON OTHER WORK:
├─ P1-07  match_rag_chunks_ncert grant    [needs CEO/Eng-lead risk-acceptance decision — revoke vs. keep]
├─ P1-08  error-message leak scope        [needs scope-boundary decision — 3 fns vs +20 vs +700]
└─ P1-01 mobile blocker                   [needs product decision on adoption-gate threshold]

SEQUENCED (B depends on A's outcome):
├─ P1-02 step 1 (embedding query) → P1-02 step 2+ (retrieval tuning OR embedding backfill)
├─ P1-01 mobile fix + release → adoption monitoring → P1-01 DB column-ACL migration
└─ P1-04 Slack webhook provisioning (ops) → channel wiring (eng, trivial once URL exists)

RATE LIMITING (Packet 10) — coordinated batch, low interdependency:
├─ 3 payment routes (identical pattern) → ship together
└─ oauth/token + auth/bootstrap + auth/session → ship together (auth/session needs isolated careful testing per its CRITICAL AUTH PATH designation)

NEWLY SURFACED — NEEDS SCOPING BEFORE IT CAN BE SEQUENCED:
└─ P2-04→P1  RBAC check-not-enforced (3 routes) — file/line evidence not yet gathered, blocks nothing else but should not be silently dropped
```

### Suggested Critical Path

The **longest lead-time item is P1-01's mobile release cycle** (app store review + forced-upgrade adoption curve), not the RAG root-cause work. Recommend starting the mobile fix immediately in parallel with everything else, since it is very likely the pacing item for the whole launch-blocking set — even though the database-side change itself (the column ACL) is trivial once mobile adoption clears.

**Suggested week-1 batch** (no dependencies, low risk, fast): P1-03, P0-01 verification, P1-05, P1-06, P-01 (5 routes), rate-limiting cluster, P1-02 step 1 query.

**Suggested week-1 decisions needed from CEO/Eng lead** (does not block week-1 batch, but should not slip): P1-07 revoke-or-accept, P1-08 scope boundary, P1-01 mobile adoption-gate threshold.

**Suggested ongoing/longer-lead**: P1-01 mobile release, P1-02 remaining steps (pending step-1 result), P1-04 Slack webhook provisioning (ops-dependent, not eng-dependent).

---

## Part B — Reclassified Launch Risks

Per CEO instruction to reclassify any incorrectly deferred launch risks, each item below was **freshly re-verified** (not re-stated from the original audit) against live code and, where noted, live read-only Supabase queries against `shktyoxqhundlvkiwguu`.

### B1. Admin/service-client RLS bypass — RECLASSIFICATION: mostly confirmed-safe, with one real exception folded into Packet 11

`packages/lib/src/supabase-admin.ts` is imported in **289 of 410** route files (~70%, not exactly the original audit's 87%, but the same direction and scale). Sampled routes (`teacher/students`, `school-admin/classes`, `parent/calendar`, `super-admin/support`) all pair the service-role client with an explicit compensating authorization check (`canAccessStudent`, `authorizeSchoolAdmin`, `authorizeAdmin`, `rbac.ts`) — consistent with the original audit's "410/410 routes have auth checks" finding.

**However**, this same investigation re-confirmed a real, specific exception: **3 routes (teacher-dashboard, parent-portal, assessment) run a permission check but don't enforce its result** (originally filed as P2-04). This is folded into Packet 11 (`20-remediation-packets.md`) as a reclassified P1 item, since it's a genuine instance of exactly the failure mode this general concern worries about.

**Verdict: keep the general RLS-bypass pattern classified as acceptable (compensating-authz is real and widespread), but treat P2-04's 3 specific routes as a confirmed, must-fix P1 exception, not a general systemic risk.**

### B2. class_students vs class_enrollments — RECLASSIFY DOWNWARD

Original audit framed this as an open "duplicate/conflicting table" risk. Fresh evidence: this is a known, actively-governed item (**TSB-4**, `scripts/tsb4-canonical-membership-cutover.json`, CEO-gated). `class_enrollments` is canonical; `class_students` is legacy, kept in sync via bidirectional triggers (`20260702030000_class_membership_softdelete_sync.sql`); RLS/RBAC boundary readers already repointed to `class_enrollments`. A live re-run of the divergence-quantification query just now (2026-08-30) found: **19 total pairs, 100% `matched_or_both_inactive` — zero divergence currently.** The only remaining step is legacy-table retirement, explicitly gated on a CEO go/no-go decision that has nothing to do with data integrity risk.

**Verdict: this is a completed migration awaiting an executive decision, not an open bug. Reclassify from "P2/open risk" to "decision pending, no technical risk." Do not treat as launch-blocking.**

### B3. Deployed Edge Function drift — RECLASSIFY UPWARD, significantly

Original audit treated this as informational/P3 ("102 deployed vs ~49 on disk," framed as historical drift). Fresh live query (`list_edge_functions`) confirms **exactly 102 ACTIVE functions** vs **49 on-disk directories** — a 53-function gap. Investigation of individual function bodies found:

- Most of the 53 are genuinely tombstoned 410-GONE stubs per a documented 2026-07-13 through 2026-08-05 sweep (`docs/runbooks/edge-function-drift-report.md`) — high version numbers reflect pre-tombstone history, not live complexity. This part is benign.
- **`export-report` (v38, live) is real, functional, 300+ lines of permission-checked report-generation code, deployed via CI from a repo path that was deliberately deleted** — a git commit explicitly archived and removed it, believing "zero live coupling." Production is currently running code with **no current source of truth in the repository.**
- **New, undocumented drift has appeared since the runbook's own last update (2026-08-05):** `agent-orchestrator`, `agent-worker`, `auth-write-skeleton`, `embed-rag-remaining`, `rag-answer-v3/v4/v5`, `rag-query-v3`, `rag-ingest-batch/status`, `embed-ncert-books` — all created July–August 2026, **deployed directly, not via CI**, performing real writes to `agent_runs`, `audit_logs`, and `rag_content_chunks`. None appear in any runbook or the current repo tree.

**Verdict: this is not a stale one-time gap — it is an actively regrowing hole in code-review and version-control discipline. `export-report` is a live, undocumented, unreviewable function touching report generation; the newer batch performs real writes to `audit_logs` (a security-relevant table) and RAG content with no source control at all. Reclassify from P3/informational to a P1-equivalent — this directly implicates "secure privileged access" and deployed-component integrity, both explicitly retained in the CEO's essential-security scope.** Recommend: (1) recover source for `export-report` from its deleted repo path via git history and re-establish it under CI control; (2) audit each of the newer undocumented functions for what they actually do and who deployed them; (3) establish a policy/tooling gate preventing direct `supabase functions deploy` outside CI going forward.

### B4. Production feature-flag drift — RECLASSIFY UPWARD

Original audit treated this as P2/NOT-STARTED ("3 flags documented OFF but ON"). Fresh live query confirms all 3 flags (`ff_adaptive_remediation_v1`, `ff_adaptive_loops_bc_v1`, `ff_school_pulse_v1`) are `is_enabled: true`, `rollout_percentage: NULL`, last touched 2026-08-18 (~12 days before this investigation). Code confirms `rollout_percentage IS NULL` skips percentage gating entirely — **equivalent to 100% rollout, not 0%.** These are `constitution_pinned` flags requiring a DB-trigger-enforced sanctioned RPC (`admin_flip_feature_flag`) to change — very likely not a raw-SQL bypass, i.e., someone with legitimate access deliberately flipped them. But `docs/runbooks/phase-5-rollout-execution-tracker.md`'s progress ledger shows **zero stages checked off** (no staging drill, no 5%/10%/25% pilot) for systems whose own kill-switch/drain semantics exist specifically because full-blast activation was considered too risky to skip.

**Verdict: reclassify from P2/NOT-STARTED to a P1-equivalent process-integrity risk — three flags with explicit staged-rollout governance appear to have jumped straight to full production activation with the canary stages either skipped or undocumented.** This needs two things, not one: (1) an investigation into how/why the staged process was bypassed (governance question), and (2) a decision on whether to roll these back to a staged rollout now — which itself carries **data-mutation/user-impact risk**, since these are learning-facing adaptive features that may already have accumulated real usage under 100% rollout. **Do not silently revert without an explicit owner decision** — this is exactly the kind of item the CEO's "unresolved decisions" field exists for.

### B5. Grade encoding / content reachability — RECLASSIFY UPWARD, from theoretical to confirmed-live

Original audit cited "6,061 assets unreachable" as a general grade-encoding mismatch (`"Grade 11"` vs `"11"`), filed NOT-STARTED. Fresh investigation pinpointed a specific, currently-live, 100%-reproducible instance: `getTopicDiagrams()` (`packages/lib/src/supabase.ts:1473`) always converts to `"Grade N"` format before querying `topic_diagrams` — but a live query shows **all 3,168 rows in `topic_diagrams` are stored as bare digits** (`"11"`, not `"Grade 11"`). Result: **100% of diagram assets in that table are unreachable** via the student `/learn/[subject]/[chapter]` page, failing silently (no error, just an empty diagram strip).

**Verdict: reclassify from "theoretical mismatch, NOT-STARTED, P2-adjacent" to a confirmed, live, 100%-reproduction-rate product bug affecting every student on every chapter page with a diagram. This should move into the same remediation phase as the other confirmed P1 items — it is not launch-blocking in the security sense, but it is a live, currently-active defect the CEO should be aware is not merely a data-hygiene backlog item.** Recommended fix: change `getTopicDiagrams()` to query with the bare-digit format (matching what's actually stored), or normalize `topic_diagrams.grade` to match the `"Grade N"` convention used elsewhere — either is a small, low-risk change once decided.

### B6. Role orphans (user_roles.auth_user_id) — confirmed, slightly worse than sampled, but safe to defer

Live full-table query: **53/92 = 57.6%** of `user_roles` rows have no matching `auth.users` row (vs. the audit's 48% sample — the fuller count is worse, but not alarmingly so). No FK constraint anywhere references `user_roles`, confirmed via `information_schema` — cleanup is structurally safe. Orphans date back to 2026-03-28, several sharing the same `role_id`, consistent with incomplete cascade from an account-deletion/GDPR-purge flow (`account-purge` edge function exists) rather than fresh/ongoing corruption.

**Verdict: keep at P2/deferred — not launch-blocking, but flag as "safe, cheap, and should be scheduled soon" rather than left indefinitely, since it's a growing count if the purge-cascade gap isn't fixed at the source.**

### B7. Mastery/XP mismatch — RECLASSIFY: partially active, not purely legacy

Original audit's positive finding ("single canonical mastery write path") is contradicted by fresh evidence: `update_learner_state_post_quiz` is genuinely the canonical, actively-referenced RPC for quiz-driven `concept_mastery` writes — **but `apps/host/src/app/api/tutor/answer/route.ts:247` does a direct `.upsert()` on `concept_mastery`, bypassing that RPC entirely** — a second, independent write path originating from Foxy tutor practice answers.

**Verdict: reclassify the underlying mismatch finding from "legacy/historical data, NOT-STARTED, low active risk" to "at least two live, concurrent write paths with potentially different counting semantics — an active, not purely historical, data-integrity risk."** Recommend investigating whether `tutor/answer/route.ts`'s direct upsert uses consistent semantics with `update_learner_state_post_quiz` before writing off the mismatch as "just old data" — if the two paths count attempts/correctness differently, the mismatch will keep growing, not just persist.

### B8. Cron/queue races — no change, one nuance for precision

`queue-consumer`'s per-task mastery/XP writes use atomic RPCs (`update_concept_mastery_bkt`, `credit_quiz_xp`) with row-level locking — confirmed safe. The originally-flagged concern (P2-19) is specifically about the **task-claim step** (dequeuing pending rows from the task table itself), a distinct concern from the RPC-protected downstream processing. This investigation could not fully confirm or deny claim-step locking either way.

**Verdict: no reclassification — keep as originally classified, but mark the claim-step locking status explicitly as UNKNOWN (not verified true or false), per the CEO's instruction that UNKNOWN must not be treated as PASS. The downstream mastery/XP RPCs are confirmed safe and should not be conflated with the claim-step's unverified status.**

### B9. Backup and restore readiness — no material change

`14-backup-disaster.md` still accurately reflects current state: one successful restore drill (2026-08-23) against staging; staging inaccessible since; no RTO/RPO defined; no automated restore testing.

**Verdict: unchanged — CONDITIONAL GO stands as appropriate for a controlled pilot scale, not launch-blocking, but should not be considered "done."**

---

## Part C — Summary Table of Reclassifications

| Item | Original Classification | Reclassified To | Why |
|---|---|---|---|
| Admin/service-client RLS bypass (general) | P2/deferred | **Unchanged** (P2/acceptable) — but see below | Compensating authz confirmed widespread |
| → P2-04 (3 routes, check-not-enforced) | P2 | **P1** (folded into Packet 11) | Real, confirmed authz-bypass instance, not theoretical |
| class_students/class_enrollments | P2/open risk | **Lower — decision-pending, not a risk** | Zero live divergence confirmed; governed by TSB-4, CEO-gated |
| Edge Function drift | P3/informational | **P1-equivalent** | Actively regrowing; undocumented functions doing real writes to audit_logs/RAG content, one (export-report) has no source of truth at all |
| Feature-flag drift (3 constitution-pinned flags) | P2/NOT-STARTED | **P1-equivalent** | Confirmed live 100% rollout, staged-rollout governance apparently bypassed, zero canary stages completed |
| Grade encoding reachability (topic_diagrams) | P2/NOT-STARTED, theoretical | **Confirmed live, 100% reproduction rate** | Every student's chapter page silently shows no diagrams |
| Role orphans | P2/deferred | **Unchanged** (P2/safe-to-defer) | Confirmed safe to fix (no FK refs), just should be scheduled |
| Mastery/XP mismatch | "Legacy data," dismissed | **Active risk, not purely historical** | Second live write path found (tutor/answer/route.ts) bypassing canonical RPC |
| Cron/queue claim-step locking | P2 | **Unchanged, but status = UNKNOWN not verified** | Could not confirm either way — must not default to PASS |
| Backup/restore readiness | CONDITIONAL GO | **Unchanged** | No material change found |
