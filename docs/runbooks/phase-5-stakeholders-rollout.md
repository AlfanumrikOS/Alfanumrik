# Phase 5 Stakeholders + Play — Rollout Runbook

**Date:** 2026-08-05
**Owner:** ops (this runbook), backend/frontend/assessment (implementation)
**Branch:** `Alfanumrik/foxy-system-spec-22f565`
**Spec:** `docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md` §1.5–§1.7
**Regressions pinned:** REG-361..REG-366
**Constitution invariants exercised:** P1 (scoring untouched), P2 (XP unchanged
— K4/K7 do NOT award XP), P7 (bilingual), P8 (roster + school scope), P9
(RBAC), P10 (bundle boundary via K9 fold-in), P13 (data privacy — evidence
citations UUIDs-only, conversation prompts carry no transcript, leadership
read-model counts/averages only).

This is the FINAL rollout runbook for the Phase 5 Stakeholders + Play batch. It
covers five shipping surfaces on ONE branch and one breaking UI change:

1. K2 / K3 / K4 / K7 — teacher approve/override lane
2. K5 — draft-with-AI worksheet workflow
3. K8 — parent conversation_prompts + in-app weekly report
4. K9 — leadership dashboard folded into `/school-admin/reports?tab=leadership`
5. U10 — leaderboard percentile bands (breaking UI change; replaces absolute
   personal rank and `(You)`-tagged rows)

Also covered are S1.5/S1.6/U5/U7 (companion + play mission framework) and R5
(teacher escalation lane). These are already tested and shipped-inert behind
the same flags below — no additional rollout action.

## 1. Preflight (all rows before the first ramp step)

- [ ] All 5 migrations applied to production:
      `20260813000002_remediation_evidence_column.sql` (K3),
      `20260813000003_adaptive_interventions_teacher_decision.sql` (K4/K7),
      `20260813000004_teacher_assignment_drafts.sql` (K5),
      `20260813000005_leadership_readmodels.sql` (K9),
      `20260813000006_leaderboard_percentile_rpc.sql` (U10)
- [ ] `ff_school_pulse_v1` feature flag row exists and is currently `enabled:
      false` OR `rollout_percentage: 0` in production `feature_flags`. This
      flag gates K1 (unified student-needs-attention lane), the K9 leadership
      tab content, and continues gating the pulse surface. It is the single
      staged ramp for this batch.
- [ ] REG-366 pins pass on branch (leadership standalone route retired; nav
      deep-links to reports tab).
- [ ] REG-361..REG-365 pins pass on branch (percentile bands / evidence P13 /
      draft quarantine / teacher.override event / leadership read-model P13).
- [ ] Vitest full run green from `apps/host`.
- [ ] `npm run type-check` + `npm run type-check:scripts` both exit 0.
- [ ] `node scripts/foxy-alignment/analyze.mjs` verdict recorded. Pre-existing
      E3 (execution/decomposition) debt is expected to FAIL — do NOT try to
      close that here; it is scoped to Phase 4 R3 pipeline decomposition.

## 2. K4 / K7 teacher approve/override lane (K2 + K3 read paths ride along)

**What ships:** the `record_intervention_decision` teacher-dashboard action
writes an `adaptive_interventions.teacher_decision` row (approve / override /
dismiss); on `override` the 6-kind teacher.override event fires with a bounded
payload enum (no free-text `reason`/`comment` — REG-364); on `dismiss` the
adaptive-remediation cron worker (`apps/host/src/app/api/cron/adaptive-
remediation/route.ts`) treats the row as terminal and MUST NOT re-emit an
intervention for the same (student, chapter) window (dismissed-guard).

K2 (misconception clusters) and K3 (evidence citations, REG-362) are the read
side of the same lane. K3 evidence payloads are bounded fact records only —
attempts, incorrect count, hint_level_max, misconception_ids, timestamps,
UUIDs — never name/email/phone/free-text answer content or transcripts
(REG-362 P13 pin).

**Rollout:** no flag ramp; this is a code-path enable at merge. K2/K3/K4/K7
share the K1 teacher CommandCenter surface, which itself renders under
`ff_school_pulse_v1` (see §5).

**Monitor:**
- `adaptive_interventions.teacher_decision` write rate — expected: non-zero
  within 24h of merge in any tenant that has active teachers with roster
  alerts. Zero writes for 72h across all tenants = investigate the approve/
  override button wiring or the RBAC gate on the action.
- Adaptive-remediation cron dismissed-guard: watch for `dismissed` rows that
  reappear on the next cron tick for the same (student, chapter). MUST NOT
  happen; if seen, disable the dismissal path via feature-flag hot-patch and
  file a P0.

## 3. K5 draft-with-AI workflow

**What ships:** `teacher_assignment_drafts` table (migration
`20260813000004`, REG-363) with EXACTLY TWO RLS policies — `teacher_own_all`
and `service_role_all`. There is DELIBERATELY NO student, parent, or generic
authenticated read path. Drafts stay quarantined to the authoring teacher
until the publish action stamps `published_assignment_id`, at which point the
existing assignments surface takes over.

Flow: teacher opens draft-with-AI → `bulk-question-gen` Edge Function
generates candidates → `draft-question-validator` oracle-gate rejects
anything failing the REG-54 quality bar (bloom range, distractor uniqueness,
correct_answer_index 0..3, non-empty explanation, no template markers) →
teacher reviews + edits → publish action promotes into `assignments`.

**Rollout:** no flag; oracle gate is fail-closed at the code level. If the
oracle rejection rate exceeds ~30% steady-state, hold on wider rollout and
raise with ai-engineer — indicates the generator is drifting off-spec.

**Monitor:** oracle rejection rate on `bulk-question-gen` calls originating
from the drafts surface. Also watch for any INSERT into `assignments` that
does not have a matching `teacher_assignment_drafts.published_assignment_id`
back-pointer — indicates the publish action is being bypassed.

## 4. K8 parent conversation_prompts

**What ships:** `parent-report-generator` Edge Function's LLM prompt is
extended to emit a `conversation_prompts[]` array (dinner-prompts style)
inside the weekly report JSON. Frontend `/parent/progress/page.tsx` replaces
its prior stub with in-app rendering via `ConversationPromptsCard.tsx`. A
zod schema validates the payload; on validation failure the deterministic
bilingual template fallback (already live for the parent summary body per
REG-302) provides safe copy so the render surface can never show raw model
output. NO transcript exposure — the existing parent-portal no-transcript
guard stays.

**Rollout:** no flag; wired at merge. If model drift makes the LLM emit
malformed prompts, the fallback kicks in and the render is safe; still
alert on fallback trigger rate >10%.

**Monitor:**
- Weekly `conversation_prompts` render rate on `/parent/progress` — expected
  non-zero within one weekly cycle post-merge.
- Zod validation failure rate for the prompts field — steady-state should be
  <2%. Sustained >10% = raise with ai-engineer to retune the prompt.

## 5. K9 leadership dashboard fold-in

**What ships (REG-366):** the standalone route `/school-admin/leadership` is
retired. `LeadershipTab.tsx` mounts inside the existing school-admin
`reports` page tab strip, deep-linked as
`/school-admin/reports?tab=leadership`. The consolidated school-admin nav
exposes ONE Leadership entry, resolving to that deep-link. LeadershipTab is
NOT statically imported by any other page under `apps/host/src/app/school-
admin/**/page.tsx`, so the leadership bundle loads only when a school-admin
actually opens the Reports page (P10 boundary, mirrors the Phase 1
safeguarding fold-in).

Data source unchanged: the two SECURITY DEFINER RPCs from migration
`20260813000005` (REG-365) — `get_school_safeguarding_counts`,
`get_school_competency_summary` — return counts and averages only, guarded
by an active-school-admin scope check, with PUBLIC/anon revoked and EXECUTE
granted only to authenticated.

**Rollout:** staged behind `ff_school_pulse_v1`:

| Step | Flag posture | Duration | Go/no-go gate |
|---|---|---|---|
| 1 | rollout_percentage=5, enabled=true | 24h | Zero 5xx on the two RPCs; LeadershipTab first-paint p95 < existing reports tab p95 + 400ms |
| 2 | rollout_percentage=25 | 48h | Same gate; also check `/api/school-admin/leadership/*` error rate |
| 3 | rollout_percentage=100, enabled=true | steady state | — |

Ramp only via the super-admin protected-flag console (REG-285 typed-
confirmation gate applies). Rollback = set flag back to `enabled:false` OR
`rollout_percentage:0`; the tab renders a coming-soon placeholder and the
data path is not called.

**Monitor:**
- `get_school_safeguarding_counts` and `get_school_competency_summary` RPC
  invocation count + error rate.
- `/api/school-admin/leadership/*` route error rate.
- 404 rate on `/school-admin/leadership` — expected to spike to ~roster size
  on merge as bookmarks resolve; should decay to near-zero within 7 days.
- School-admin shell first-paint JS (P10 canary) — MUST NOT grow; the fold-in
  is expected to shrink it.

## 6. U10 leaderboard percentile bands (breaking UI change)

**What ships (REG-361):** the personal-rank surface stops rendering an
absolute integer rank or a `(You)`-tagged row. The new
`/api/v1/leaderboard/me` returns ONLY a percentile band descriptor —
`top_10` / `top_25` / `top_50` / `keep_going` — rendered by
`PercentileBandCard.tsx`. The top-N leaderboard tiles are UNCHANGED (they
never exposed weaker students; only personal rank did). `/me` responses are
private-cached so a student's band value never leaks across sessions.

**Approval:** A7 granted (per spec §1.5 U10). This is CEO-approved user-
facing copy/behavior change; no additional approval gate at rollout.

**Rollout:** no flag; ship at merge alongside the percentile-band RPC
migration `20260813000006`. This is a breaking UI change — comms to schools
(via existing school-admin change log surface) should note the shift.

**Monitor:**
- `/api/v1/leaderboard/me` call volume — expected to match the pre-change
  personal-rank endpoint's baseline. Sustained drop >30% = investigate
  frontend wiring (may indicate the card is not rendering).
- Client-side error rate on `PercentileBandCard.tsx`.
- Parent/support ticket volume mentioning "rank" or "leaderboard" — expected
  small bump at cutover; monitor for 14 days and route to product if
  sustained.

## 7. Cross-cutting monitoring hooks

- **P13 sweep** — nightly grep of `alfabot_messages`, `notifications`, and
  `admin_audit_log` for the new K4/K7 event kinds must not surface any row
  containing name/email/phone patterns (REG-364 payload enum guarantees this
  at write time; the sweep is defense in depth).
- **Flag posture canary** — REG-286 nightly protected-flag canary already
  covers `ff_school_pulse_v1`; verify it is watching post-ramp.
- **Cron heartbeat** — REG-304 adaptive-loops health cron already emits a
  `job_health` heartbeat every 24h; the new dismissed-guard branch is
  covered by the existing ceiling=0 storm rule.

## 8. Rollback

Full-batch rollback is `git revert` of the merge commit — no schema drops
required (all 5 migrations are additive; no CHECK narrowings, no column
drops, no policy removals). The K9 fold-in is behavior-neutral under flag
OFF (LeadershipTab renders coming-soon; no RPC calls). Per-surface partial
rollback:

- K1/K9: flip `ff_school_pulse_v1` back to `enabled:false` / `rollout_
  percentage:0` via the super-admin console. Instant.
- K4/K7: no rollback flag; a git revert of the teacher-dashboard action is
  required. Interventions already written stay in place — the
  `teacher_decision` column is nullable and downstream consumers tolerate
  NULL.
- K5: no rollback flag; git revert. Existing draft rows are preserved (RLS
  keeps them teacher-scoped) and can be discarded via a service-role
  cleanup if needed.
- K8: git revert of `parent-report-generator` prompt change reverts to the
  pre-K8 weekly report shape; the frontend `ConversationPromptsCard`
  degrades to empty state on missing field.
- U10: git revert of `/api/v1/leaderboard/me` and `PercentileBandCard`
  restores absolute rank. Note this is user-visible.

## 9. Sign-off gate

Before flipping `ff_school_pulse_v1` past step 1 (5%):

- [ ] Vitest green on this commit hash in CI
- [ ] `node scripts/foxy-alignment/analyze.mjs` verdict recorded and
      reviewed (pre-existing E3 debt FAIL is acceptable and expected)
- [ ] REG-361..REG-366 all reported `E` (existing + passing) in the last CI
      run against this commit
- [ ] Ops on-call handoff acknowledged
- [ ] Change log entry queued for schools if U10 is shipping with this batch

## References

- Spec: `docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md`
- Tracker: `docs/trackers/foxy-north-star/tracker.json`
- Regression pins: `.claude/regression/07-teacher-school.md` (REG-366),
  `.claude/regression/03-quiz-integrity.md` (REG-361/362/364),
  `.claude/regression/10-rbac-rls.md` (REG-363/365)
- Phase 1 fold-in precedent (safeguarding): see the same-file safeguarding
  runbook and REG-348/349/350
- Adaptive-loops on-call baseline: `docs/runbooks/adaptive-loops-oncall.md`
