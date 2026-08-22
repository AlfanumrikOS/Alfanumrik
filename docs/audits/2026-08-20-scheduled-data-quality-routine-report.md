# Scheduled data-quality routine — report, 2026-08-20

**Type:** Automated scheduled routine (student-education-data integrity, pipeline-bug, and
adaptive-learning-workflow-blocker check). **Not** an ad hoc investigation.

**Why this is a doc and not a push notification:** this routine's normal notification channel (a
push notification to the CEO) was disabled for this session. Rather than lose the findings, the
routine is persisting them here as a docs artifact, mirroring the existing convention in this repo
of `docs/audits/*.md` read-only investigation writeups.

**No code, DDL, migration, or grant was applied by this routine.** Docs-only output. Findings below
summarize work already gathered by prior investigation this session — no new queries were re-run to
produce this file.

---

## HIGH severity — live answer-key leak in production quiz-serving RPCs (unresolved)

Primary sources (read these for full evidence; this section is a faithful summary, not a
re-derivation): `docs/audits/2026-08-20-answer-key-serving-chain-risk.md` and
`docs/audits/pending-migration-order-risk.md`.

- **4 of 5 live question-serving RPCs** (`select_quiz_questions_rag`, `select_quiz_questions_v2`,
  and both `get_quiz_questions` overloads) emit `correct_answer_index` in their outbound JSON
  payload in production **today**. Confirmed by direct `pg_proc` query against production project
  `shktyoxqhundlvkiwguu`.
- **No server-side P6 content-quality filter exists in production** — `public.question_bank_p6_valid`
  is not a deployed function (zero rows on lookup).
- Any logged-in student can also read the answer key **directly off `question_bank`** via RLS policy
  `question_bank_authenticated_read` (`USING (true)`, all columns).
- **`anon` still holds EXECUTE on all five RPCs** via a `PUBLIC` grant that an earlier
  `REVOKE EXECUTE ... FROM anon` never removed (revoking a role doesn't strip a `PUBLIC` grant); two
  of the five RPCs have no ownership guard at all.
- **Separate live scoring defect:** `start_quiz_session` does
  `COALESCE(v_question_meta.correct_answer_index, 0)` — a NULL answer key is silently graded as
  "correct = option 0" instead of being skipped.
- A fix exists on disk (`supabase/migrations/20260814000023_keyless_question_serving_and_server_side_p6.sql`)
  but is **NOT applied to production**, and conflicts with a second pending migration
  `20260820120000_reassert_select_quiz_questions_rag_staging_drift.sql` that would silently
  re-clobber it if it lands first (last-`CREATE OR REPLACE`-wins). The existing test
  `apps/host/src/__tests__/security/keyless-question-serving.test.ts` cannot catch this because it
  only statically scans one hardcoded migration filename, not the deployed/resolved RPC chain.
- **Impact:** directly threatens **P1 (score accuracy)** and **P6 (question quality)** product
  invariants — any quiz/adaptive-learning signal collected while this is live is unreliable, since
  students can see the correct answer before submitting.

**Status: UNRESOLVED as of this report.** Neither audit doc's findings have been folded into
`.claude/CLAUDE.md` or `.claude/regression/` yet.

**Recommendation:** route to **assessment** (P6/question-quality sign-off) and **architect**
(migration ordering + RLS/grant fix) before any further migration touches `question_bank` serving
RPCs. Because this touches P1/P6 invariants, per the constitution's "User Approval Required For"
list it needs explicit CEO approval before any fix is deployed.

---

## LOW / informational — IRT shadow-evaluation rollout not yet documented

An active, real rollout plan exists: `ff_irt_shadow_v1` (seeded OFF, migration `20260809000000`)
plus `get_irt_calibration_readiness()` RPC (migration `20260722099000`) — a Phase-3 "Foxy
North-Star" shadow-evaluation lane that logs what a v2 IRT selector would serve without changing
student-facing behavior, as a pre-step toward eventually promoting `ff_irt_question_selection`.

This isn't mentioned in `CLAUDE.md` yet. Not urgent — just flagging so a future
doc-reconciliation pass picks it up.

---

## Confirmed healthy / no new issues found

- Adaptive/personalization feature flags (`ff_school_pulse_v1`, `ff_adaptive_remediation_v1`,
  `ff_adaptive_loops_bc_v1`) are all correctly OFF, matching documented state. The DB-level trigger
  `trg_protect_feature_flags` (migration `20260722090100`) now blocks any direct-Postgres UPDATE
  from re-enabling a protected flag outside the `admin_flip_feature_flag` RPC — this closes the two
  earlier 2026 incidents where these flags were accidentally bulk-enabled (2026-06-21 and
  2026-07-20), both since remediated.
- No pipeline bugs found in `daily-cron`, `queue-consumer`, or the adaptive-remediation cron
  worker — their fail-soft catch blocks are deliberate and covered by existing tests, not silent
  failures.
- No event-registry drift found in `packages/lib/src/state/events/registry.ts`.
- The NCERT corpus coverage gap (~16,006 chunks / 750 of 761 syllabus rows) is unchanged from what's
  already documented in `CLAUDE.md` — not worsened, no new similar gap found elsewhere.
- `cognitive-engine.ts` does not directly read `correct_answer_index` (consumes post-scoring state
  only), so it is not itself exposed to the leak above, though it downstream-trusts the same
  `question_bank` rows the leaking RPCs serve.

---

## Closing note

This report was generated because the routine's normal notification channel was unavailable this
run; it is a **persistence-only artifact**, not a substitute for the CEO actually seeing and acting
on the HIGH-severity finding above.
