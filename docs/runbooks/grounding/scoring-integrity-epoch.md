# Scoring Integrity Epoch — P1 Shuffle/Index Mismatch Fix

**Owner:** architect + assessment
**Created:** 2026-04-18
**Related migration:** `supabase/migrations/20260418110000_fix_quiz_shuffle_scoring.sql`
**Related client commits:** `aa4ed51`, `a641a90` (client-side), this migration's commit (server-side)
**Invariants touched:** P1 (score accuracy), P3 (anti-cheat — preserved), P4 (atomic submission — preserved)

## Summary

For 8 revisions of `submit_quiz_results` (last revision before this fix:
`20260408000005_wire_session_id_dedup.sql`) the RPC compared:

- `selected_option` — the SHUFFLED display index the client clicked
- `question_bank.correct_answer_index` — the ORIGINAL pre-shuffle index

These are different coordinate spaces. Because every MCQ quiz goes through
the shuffle in `src/app/quiz/page.tsx`, ~75% of shuffled quizzes were
silently miscounted. The authoritative writes to `quiz_sessions.correct_answers`,
`quiz_sessions.score_percent`, `quiz_responses.is_correct`, `xp_total`,
`concept_mastery`, `bloom_progression`, and `cme_concept_state` are all
affected.

The commit landing this migration is the **scoring integrity epoch**. Data
written before the epoch is NOT backfilled — shuffle maps were never stored,
so miscounts cannot be recomputed.

## Integrity Epoch Timestamp

The epoch is the `created_at` of the `quiz_sessions` row inserted by the
first production submission AFTER this migration is deployed. In practice
use the migration's deploy-to-production commit timestamp as a conservative
lower bound:

```
EPOCH = <migration commit timestamp>
```

This value will be filled into the ops runbook index after production
deployment. For staging, use the staging deploy timestamp.

## What Changed

1. **Schema:** `quiz_responses` gained `shuffle_map INTEGER[]` (nullable).
   Every MCQ row post-epoch carries the permutation used to render options.
2. **RPC:** `submit_quiz_results` translates `selected_option` through
   `shuffle_map` before comparing to `correct_answer_index`. Algorithm
   mirrors `src/lib/quiz-scoring.ts::resolveOriginalIndex`.
3. **Client payload:** `QuizResponse` (`src/lib/types.ts`) gained optional
   `shuffle_map: number[] | null`. The web quiz sends the map on every MCQ
   submission; mobile and non-shuffled surfaces send `null` or omit it.
4. **Canary:** the RPC emits `ops_events` rows
   (`category = 'grounding.scoring'`, `severity = 'warning'`) when the
   client's asserted `is_correct` disagrees with the server's recomputed
   value.

## Analytics Guidance — Filtering for Trustworthy Data

For any query that reads `quiz_sessions.correct_answers`,
`quiz_sessions.score_percent`, `quiz_responses.is_correct`, or any
downstream metric derived from those columns (XP velocity, mastery,
accuracy trends, leaderboard ranks, ZPD accuracy, Bloom mastery), filter
to post-epoch rows:

```sql
SELECT ...
FROM quiz_sessions qs
WHERE qs.created_at >= '<EPOCH>'::timestamptz
```

For `quiz_responses`:

```sql
SELECT ...
FROM quiz_responses qr
JOIN quiz_sessions qs ON qs.id = qr.quiz_session_id
WHERE qs.created_at >= '<EPOCH>'::timestamptz
```

Pre-epoch rows should be treated as **noisy observations** — they cannot
be re-scored without the original shuffle map. Super-admin dashboards,
parent reports, teacher heatmaps, and accuracy-trend widgets should either
(a) hide data before the epoch, or (b) watermark it with "data quality:
legacy (pre-2026-04-18)".

## Forensic Dispute Investigation

When a student or parent disputes a score ("I clicked the right one but it
said I was wrong"), post-epoch the row carries enough information to
replay:

```sql
SELECT
  qr.id,
  qr.question_id,
  qr.selected_option,     -- shuffled display index the student clicked
  qr.shuffle_map,         -- permutation used at render time
  qr.is_correct,          -- what the RPC recorded
  qb.correct_answer_index -- original pre-shuffle index
FROM quiz_responses qr
JOIN question_bank qb ON qb.id = qr.question_id
WHERE qr.id = '<response_id>';
```

Reconstruction steps:
1. `displayed_correct_at = array_position(shuffle_map, qb.correct_answer_index) - 1`
   (0-indexed display slot that showed the right answer)
2. If `selected_option = displayed_correct_at` and `is_correct = false`,
   the row is broken — escalate to architect + assessment.
3. If `shuffle_map IS NULL`, the surface did not shuffle (mobile,
   diagnostic, pyq, learn). `selected_option` should equal
   `correct_answer_index` when `is_correct = true`.

## Canary Events — `grounding.scoring`

Post-fix, these should never fire. When they do, something went wrong:

```sql
SELECT
  occurred_at,
  context->>'student_id'     AS student_id,
  context->>'session_id'     AS session_id,
  context->>'question_id'    AS question_id,
  context->>'client_flag'    AS client_is_correct,
  context->>'server_flag'    AS server_is_correct,
  context->>'selected_option' AS selected,
  context->'shuffle_map'     AS shuffle_map
FROM ops_events
WHERE category = 'grounding.scoring'
  AND source = 'submit_quiz_results'
  AND occurred_at >= NOW() - INTERVAL '24 hours'
ORDER BY occurred_at DESC
LIMIT 100;
```

Likely causes if these appear:
1. A new non-web client (mobile app update, third-party integration)
   started shuffling options client-side but is not sending `shuffle_map`.
2. The client helper (`src/lib/quiz-scoring.ts::resolveOriginalIndex`)
   and the RPC drifted — re-read the migration comment and confirm
   algorithmic parity.
3. Adversarial payload injection — an attacker sent a fabricated
   `is_correct: true` hoping the server would trust it. The server does
   not trust the flag; the canary is purely an observability signal.

Escalation: any spike > 5/min across any hour → page architect on-call.

## Rollback

If this migration is reverted:

1. The `shuffle_map` column stays (dropping a column requires user
   approval per P14). It simply becomes unused.
2. The RPC reverts to the previous definition
   (`20260408000005_wire_session_id_dedup.sql`) — broken scoring
   returns.
3. The client continues to send `shuffle_map` in its payload. Postgres
   JSONB silently ignores unknown keys, so the payload is valid and does
   not throw — the server simply ignores the field.
4. Mobile clients already omit `shuffle_map`; rollback is transparent to
   them.

There is no compensating migration — rolling back reinstates the P1 bug.
Only do this if the new RPC is throwing on live traffic and the scoring
bug is the lesser evil (it is not, but the runbook must state the option).

## Related

- `src/lib/quiz-scoring.ts` — the pure JS mirror of the RPC's translation
- `src/__tests__/quiz-shuffle-scoring-fix.test.ts` — client 384-perm test
- `src/__tests__/quiz-server-shuffle-integration.test.ts` — algorithm-parity
  + canary simulation tests
- `docs/runbooks/SRE_RUNBOOK.md` — general incident response
- Super-admin ai-issues forensic workflow (Phase 3, Task 3.17) — uses
  `quiz_responses.shuffle_map` as an audit-trail column
