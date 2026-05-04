# Mobile Sync Changelog

Follow-ups tracked from the mobile-web sync audits. Items here are
non-blocking deferrals; they do not gate any wave that has already shipped
on the web side.

## 2026-05-04 — Marking-authenticity Waves 1+2 sync audit (read-only)

Audited against web changes:

- `submit_quiz_results_v2` 9th param `p_idempotency_key UUID DEFAULT NULL`
  (migration `20260504100200_quiz_idempotency_key.sql`).
- `submit_quiz_results_v2` now RAISES `session_not_started` (SQLSTATE
  P0001) instead of silent zero-score (migration `20260504100100`).
- `atomic_quiz_profile_update` JSONB return shape
  `{ effective_xp, xp_capped, xp_uncapped }` (pre-existing,
  `20260427000003_enforce_daily_xp_cap.sql`).
- New `/api/quiz/submit` Next.js route (Phase 2.6, not yet enforced via
  `ff_server_only_quiz_submit`).

### Verified IN SYNC (no action this wave)

- Quiz submission path — `mobile/lib/data/repositories/quiz_repository.dart`
  uses positional-default friendly `params:` map. Web added the 9th
  parameter with a `DEFAULT NULL`, so existing mobile callers continue to
  work unchanged.
- Payment flow — `subscription_repository.dart` calls
  `/payments/create-order` and `/payments/verify` (same Razorpay account,
  same webhook). PostHog `payment_*` events fire server-side from web's
  webhook, so mobile-originated payments are covered without any mobile
  change.
- Score formula and XP/coin awards are server-authoritative
  (`submitAttempt` never recomputes `is_correct`, XP, or coins on
  device — see `quiz_repository.dart` lines 30-35, 166-170).
- XP-rules vs mobile constants — mobile has migrated to Performance Score
  (`score_config.dart`) + Foxy Coins (`coin_rules.dart`). The legacy
  hardcoded XP values from earlier mobile drift are gone; the QuizResult
  model surfaces server-returned `xp_earned` and `coins_earned` only,
  with no client-side computation. Web's `xp-rules.ts` is marked
  `@deprecated` and the same migration is in flight on web. No drift to
  reconcile.

### FOLLOW-UP NEEDED (non-blocking)

1. **`session_not_started` (P0001) error mapping.** ✅ DONE
   (2026-05-04). `quiz_repository.dart:submitAttempt` now matches the
   `'session_not_started'` substring in the caught exception and
   returns `ApiFailure('session_not_started: ...')` instead of falling
   through to v1 (which would mis-score against unshuffled data).
   `quiz_provider.dart:submitQuiz` reads the prefix and sets
   `state.sessionExpired = true`. The new `_SessionExpiredScreen` in
   `quiz_screen.dart` renders a bilingual recovery card (English +
   Hindi via device locale) with a "Restart Quiz" CTA that clears
   local state via `quizProvider.notifier.reset()`.

2. **`xp_capped` UI surfacing.** ✅ DONE (2026-05-04).
   `QuizResult.fromRpc` now reads three optional fields from the JSONB
   return: `xp_capped` (bool), `effective_xp` (int?),
   `xp_uncapped` (int?). All three are nullable for forward
   compatibility with deploys that don't yet pass them through. The
   new `_DailyCapBanner` widget in `quiz_screen.dart` renders above
   the stats row when `xpCapped == true`, using existing warm/orange
   tokens (`AppColors.warning`) — no new design tokens. The XP stat
   tile prefers `effectiveXp` over `xpEarned` when the cap fired so
   the headline number reflects what the student actually got.

3. **`p_idempotency_key` from mobile.** ✅ DONE (2026-05-04).
   Added `uuid: ^4.3.3` to `pubspec.yaml`. `QuizNotifier.startQuiz`
   generates a v4 UUID exactly once and stores it on
   `QuizState.idempotencyKey`. `QuizNotifier.submitQuiz` forwards it
   to `QuizRepository.submitAttempt`, which only includes the
   `p_idempotency_key` RPC param when it is non-null (so older RPC
   builds without the parameter still work). On
   `idempotent_replay: true` the notifier skips
   `dashboardProvider.refresh()` so XP gain is not re-animated for
   the same attempt.

4. **Server-only quiz submit cutover.** When
   `ff_server_only_quiz_submit` flips TRUE, the web route
   `/api/quiz/submit` becomes the only entry. Mobile must migrate from
   direct RPC to this REST route at the same time, otherwise the flag
   only protects the web surface. Coordinate with backend before flip.
   Owner: mobile + backend. Priority: blocking when flag flips.

5. **PostHog client-side events.** Mobile does not emit PostHog events
   today. If mobile begins emitting client-side `quiz_graded` /
   `xp_awarded` events, coordinate `$insert_id` keying with web's
   server-side emissions to avoid funnel double-count.
   Owner: mobile + ops. Priority: deferred (no work in flight).
