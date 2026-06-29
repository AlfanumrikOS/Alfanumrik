# SLC-1 — Mobile Contract Review (Flutter + offline replay)

**Author:** mobile agent (owner of `/mobile` + the mobile↔web API contract)
**Scope:** READ-ONLY investigation. Resolves the two BLOCKING questions the architect raised in `01-design.md` for the mobile/offline path.
**Date:** 2026-06-29
**Verdict (Q3):** **SAFE** — mobile is fully server-authoritative. No Flutter path (online or offline-replay) ever inserts a completed `quiz_sessions` row without going through `submit_quiz_results_v2` / `submit_quiz_results`.

---

## Q3 (BLOCKING) — Does Flutter ever create a COMPLETED `quiz_sessions` row WITHOUT the RPC?

**Answer: NO. SAFE.** Every quiz-completion path on mobile delegates scoring/XP/row-insert to a server RPC. There is **zero** `supabase.from('quiz_sessions').insert(...)` / `.upsert(...)` anywhere in `mobile/lib`. The only direct `quiz_sessions` access is a `SELECT` for the dashboard (read-only).

### The three completion paths — all route through the capped RPC

**Path 1 — Online, `useV2` ON (primary):** `POST /v2/quiz/submit`
- `mobile/lib/data/repositories/quiz_repository.dart:420` `_submitAttemptV2(...)` → `v2Client.quizApi.postQuizSubmit(...)`.
- This hits the SAME server route as web (`/v2/quiz/submit`), documented in-repo as a thin pass-through to `submit_quiz_results_v2` that does NO score/XP/anti-cheat math (`mobile/lib/api/v2/test/quiz_api_test.dart:30`). The RPC owns P1/P2/P3/P4 and inserts the `quiz_sessions` row.

**Path 2 — Online, `useV2` OFF (direct-RPC fallback):**
- v2 RPC: `quiz_repository.dart:341` `_client.rpc('submit_quiz_results_v2', params: {...})`.
- v1 legacy: `quiz_repository.dart:380` `_client.rpc('submit_quiz_results', params: {...})` (only when `sessionId` is null OR v2 throws a non-`session_not_started` error).
- Both are server RPCs that insert `quiz_sessions` and perform the atomic profile/XP update server-side. Mobile computes no correctness, score, or XP (`quiz_repository.dart:295-299`).

**Path 3 — Offline replay (REG-91, Wave 2.5.2):** `POST /v2/quiz/submit` with `attemptMode: offline_replay`
- Drain: `quiz_repository.dart:525` `submitOfflineReplay(QueuedQuizAttempt)` → `quiz_repository.dart:541` `v2Client.quizApi.postQuizSubmit(quizSubmitRequest: req, headers: {Idempotency-Key})`.
- Request built at `quiz_repository.dart:590` `buildOfflineSubmitRequest(...)` (`attemptMode = offline_replay`, `quiz_repository.dart:609`).
- Triggered on app foreground by the coordinator (`mobile/lib/app.dart:42-50`) via `offline_drain_service.dart` FIFO drain.
- This is the **offline twin of Path 1** — it submits to the identical `/v2/quiz/submit` route → `submit_quiz_results_v2` RPC. The offline path never persists or replays a `quiz_sessions` row itself; it only queues raw responses in Hive (`offline_quiz_store.dart`) and the SERVER inserts the row + awards XP on drain. Documented invariant: offline replay carries a verbatim immutable `Idempotency-Key` so a re-drain after a committed grade is short-circuited as an idempotent replay rather than double-granting XP (`quiz_repository.dart:509-513`, `offline_quiz_models.dart:211`).

### The only direct `quiz_sessions` touch is a READ
- `mobile/lib/data/repositories/dashboard_repository.dart:80` `_client.from('quiz_sessions').select('score_percent, created_at').eq('is_completed', true)...` — read-only, used to compute the dashboard average score. No write.

### Implication for the SLC-1 trigger removal
Because mobile **never** inserts a completed `quiz_sessions` row outside the RPCs, the legacy AFTER trigger `fn_quiz_session_sync_profile` is **not** the sole XP writer for any mobile path. Removing its duplicate XP award does **not** cause an XP under-award on mobile (online or offline-replay). The mobile de-dup is **SAFE**.

**One server-side caveat (out of mobile's domain — flag to architect/assessment):** mobile's safety depends on BOTH server RPCs (`submit_quiz_results_v2` AND the legacy v1 `submit_quiz_results`) invoking `atomic_quiz_profile_update` (or otherwise awarding XP themselves) once the trigger stops awarding. Mobile still exercises the v1 RPC in the `useV2`-OFF / no-session fallback (`quiz_repository.dart:380`). If SLC-1 removes the trigger's XP award, confirm the **v1** `submit_quiz_results` RPC still awards XP on its own — otherwise the v1 fallback path would under-award. Mobile does not own that RPC; this is the only residual risk and it is server-side, not a mobile direct-write.

---

## Q1 — `streak_days` / `longest_streak` liveness in mobile

**Answer:** Mobile **reads and displays `students.streak_days`** in three surfaces. Mobile does **NOT** read `longest_streak` anywhere, and does **NOT** read `student_learning_profiles.streak_days` (it reads the `students` column, not the profile column).

### What mobile reads
- Source read: `dashboard_repository.dart:70` `.from('students').select('xp_total, level, streak_days, plan_code')` → mapped to `streak_days` at `dashboard_repository.dart:102`.
- Model: `mobile/lib/data/models/student.dart:14,44` (`streakDays` ← `students.streak_days`); `mobile/lib/data/models/dashboard_data.dart:14,47`.

### Where it is displayed (LIVE on screen)
- Dashboard stat tile "🔥 Day Streak": `mobile/lib/ui/screens/dashboard/dashboard_screen.dart:149` (`'${dash.streakDays}'`).
- Leaderboard row "🔥 Nd": `mobile/lib/ui/screens/leaderboard/leaderboard_screen.dart:278,281` (`entry.streak`, server-provided via `LeaderboardEntry.streak`).
- Parent Glance "N-day streak / N-दिन की स्ट्रीक": `mobile/lib/ui/screens/parent/parent_glance_screen.dart:341-342` (`snapshot.streakDays`, server-provided).

### Implication for SLC-1 streak side-effect (Option A drop vs Option B keep)
- The streak value mobile renders is `students.streak_days`. The authoritative `atomic_quiz_profile_update` RPC already maintains the per-day streak (skill Quiz-Integrity Invariant 3, step 4: "Updates streak if first activity today"). So the column mobile depends on stays live via the RPC regardless of the trigger.
- If the legacy trigger's only streak side-effect targets `student_learning_profiles.streak_days` and/or `longest_streak` (the profile columns), those are **DEAD from mobile's perspective** — mobile reads neither. Option A (full drop of those profile columns/side-effect) has **no mobile impact**.
- If the trigger writes `students.streak_days` directly, mobile reads it — but the RPC also maintains it, so the trigger write is redundant for mobile. Mobile imposes **no requirement to keep the trigger's streak write**, provided the RPC remains the streak writer for `students.streak_days`.

**Mobile bottom line on streak:** `students.streak_days` must keep being written by the RPC (it already is). `longest_streak` and `student_learning_profiles.streak_days` have **no mobile readers** → no mobile objection to Option A.

(Note: mobile's coin/lab-streak constants in `mobile/lib/core/constants/coin_rules.dart` and `student_lab_streaks` are a separate STEM-lab streak system, unrelated to the quiz `streak_days` / `longest_streak` columns in scope here.)

---

## Summary

| Question | Verdict | Key citation |
|---|---|---|
| Q3 — mobile direct/under-award `quiz_sessions` path? | **SAFE** — none. All 3 paths go through `submit_quiz_results_v2` / `submit_quiz_results`. | `quiz_repository.dart:341,380,420,525`; only direct touch is a SELECT at `dashboard_repository.dart:80` |
| Q3 residual (server-side) | Confirm v1 `submit_quiz_results` RPC still awards XP post-trigger-removal (mobile uses it as fallback). | `quiz_repository.dart:380` |
| Q1 — streak liveness | Mobile reads/displays `students.streak_days` only; never `longest_streak` or `student_learning_profiles.streak_days`. | `dashboard_repository.dart:70,102`; `dashboard_screen.dart:149`; `parent_glance_screen.dart:341` |
