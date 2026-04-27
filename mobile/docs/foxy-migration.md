# Foxy Endpoint Migration (Audit F7)

## Why
The mobile app currently calls the `foxy-tutor` Supabase Edge Function, which is
self-marked `DEPRECATED` and uses FTS-only retrieval with weaker P12 safety
rails. The web app already uses `/api/foxy` (Next.js → grounded-answer service)
which provides Voyage RAG + RRF + rerank-2 + Sonnet, full P12 rails, and
IRT-aware question selection. P12 safety guarantees are not equivalent across
the two surfaces — that is the dual-surface risk this migration closes.

## What changed
A compile-time feature flag `FOXY_ENDPOINT` selects which backend Foxy calls:

| Value | URL | Retrieval | Safety rails |
|---|---|---|---|
| `edge` (default) | `${supabaseUrl}/functions/v1/foxy-tutor` | FTS-only | Legacy |
| `api` | `${apiBase}/foxy` | Voyage + RRF + rerank-2 | Full P12 |

Set at build time:
```bash
flutter build apk --dart-define=FOXY_ENDPOINT=api ...
```

Default stays `edge` so this change is behavior-neutral for builds already in
the wild.

## Rollout
1. **This PR** — ship the switch with default `edge`. No behavior change.
2. **Staging build** — ops cuts a staging APK with `FOXY_ENDPOINT=api` and
   validates: chat works, quota enforcement works, abstain UX works, latency
   acceptable on Indian 4G.
3. **Production build** — ops flips `FOXY_ENDPOINT=api` default in
   `build_apk.sh` and ships a new mobile release.
4. **Monitor 2 weeks** — watch ai-engineer dashboards for the new `caller=foxy`
   traffic from mobile clients.
5. **Deprecation removal** — once >95% of active mobile clients are on the new
   path (tracked via `client_version` on `foxy_chat_messages`), ai-engineer
   deletes `supabase/functions/foxy-tutor/` in a separate PR.

## Rollback
If `/api/foxy` misbehaves on mobile in production:
1. Cut a hotfix build with `FOXY_ENDPOINT=edge` (or simply omit the flag — the
   default is `edge`).
2. Push to Play Store as an emergency update.

The legacy Edge Function stays deployed throughout the rollout window so any
client (old or new build) can fall back.

## Testing
Local verification:
```bash
# Edge path (legacy)
flutter run --dart-define=FOXY_ENDPOINT=edge

# API path (new)
flutter run --dart-define=FOXY_ENDPOINT=api --dart-define=API_BASE_URL=https://staging.alfanumrik.com/api
```

Unit tests: `mobile/test/data/repositories/chat_repository_test.dart`
covers endpoint resolution and response-shape adapters for both surfaces.
