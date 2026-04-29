# Foxy Endpoint Migration (Audit F7)

## Why
The mobile app historically called the `foxy-tutor` Supabase Edge Function,
which is self-marked `DEPRECATED` and uses FTS-only retrieval with weaker P12
safety rails. The web app uses `/api/foxy` (Next.js → grounded-answer service)
which provides Voyage RAG + RRF + rerank-2 + Sonnet, full P12 rails, and
IRT-aware question selection. P12 safety guarantees were not equivalent across
the two surfaces — that is the dual-surface risk this migration closed.

## What changed
A compile-time feature flag `FOXY_ENDPOINT` selects which backend Foxy calls:

| Value | URL | Retrieval | Safety rails | Default |
|---|---|---|---|---|
| `api` | `${apiBase}/foxy` | Voyage + RRF + rerank-2 | Full P12 | **YES (Phase 2)** |
| `edge` | `${supabaseUrl}/functions/v1/foxy-tutor` | FTS-only | Legacy | rollback only |

Set at build time:
```bash
# Default (Phase 2 onwards)
flutter build apk --dart-define=FOXY_ENDPOINT=api ...

# Rollback / legacy
flutter build apk --dart-define=FOXY_ENDPOINT=edge ...
```

## Rollout history
1. **Phase 1 (commit `eda79442`)** — shipped the endpoint switch with default
   `edge`. Zero behavior change. Both branches reachable in every build.
2. **Staging validation** — ops cut a staging APK with `FOXY_ENDPOINT=api`
   and confirmed: chat works, quota enforcement works (same
   `check_and_record_usage` RPC backs both surfaces), abstain UX works, latency
   acceptable on Indian 4G.
3. **Phase 2 (PR `feat/mobile-quiz-v2-and-foxy-route`)** — flipped default to
   `api` in `mobile/lib/core/constants/api_constants.dart` and `build_apk.sh`.
   New builds now route to the Next.js path; old builds in the wild still
   work because the Edge Function is preserved.
4. **Monitor 2 weeks** — watch ai-engineer dashboards for the new `caller=foxy`
   traffic from mobile clients.
5. **Deprecation removal** — once >95% of active mobile clients are on the new
   path (tracked via `client_version` on `foxy_chat_messages`), ai-engineer
   deletes `supabase/functions/foxy-tutor/` in a separate PR.

## Rollback
If `/api/foxy` misbehaves on mobile in production:
1. Cut a hotfix build with `FOXY_ENDPOINT=edge`:
   ```bash
   FOXY_ENDPOINT=edge ./mobile/build_apk.sh
   ```
2. Push to Play Store as an emergency update.

The legacy Edge Function stays deployed throughout the rollout window so any
client (old or new build) can fall back.

## Testing
Local verification:
```bash
# API path (new default)
flutter run --dart-define=FOXY_ENDPOINT=api

# Edge path (legacy / rollback)
flutter run --dart-define=FOXY_ENDPOINT=edge --dart-define=API_BASE_URL=https://staging.alfanumrik.com/api
```

Unit tests: `mobile/test/data/repositories/chat_repository_test.dart`
covers endpoint resolution and response-shape adapters for both surfaces.

## Quota source-of-truth
Both surfaces call `check_and_record_usage(p_feature := 'foxy_chat')`. Flipping
a user mid-day from `edge` → `api` does NOT reset their daily counter — the
RPC keys on `(student_id, feature, day)` regardless of which Foxy surface
called it. This is the property that made the cutover safe to flip
unilaterally.
