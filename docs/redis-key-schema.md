# Alfanumrik Redis Key Schema

All Redis keys used by the platform, their TTLs, purpose, and failure modes.

Infrastructure: Upstash Redis (REST-based, Edge-compatible).
Env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

## Rate Limiting (proxy.ts)

| Key Pattern | TTL | Purpose | Failure Mode |
|---|---|---|---|
| `rl:general:{ip}` | 60s (sliding window) | 200 req/min per IP | In-memory fallback |
| `rl:parent:{ip}` | 60s (sliding window) | 20 req/min for parent portal | In-memory fallback |
| `rl:admin:{ip}` | 60s (sliding window) | 60 req/min for admin | In-memory fallback |

## Session Validation (proxy.ts)

| Key Pattern | TTL | Purpose | Failure Mode |
|---|---|---|---|
| `sess:valid:{sessionId}` | 300s (5 min) | Cache session validity across instances | Fall through to Supabase REST |

## Idempotency (redis.ts)

| Key Pattern | TTL | Purpose | Failure Mode |
|---|---|---|---|
| `webhook:{eventType}:{entityId}` | 86400s (24h) | Prevent duplicate webhook processing | Allow (handler checks DB) |
| `bootstrap:{userId}` | 30s | Prevent concurrent bootstrap RPCs across instances | Allow (RPC uses ON CONFLICT) |

## Quiz Submission (supabase.ts, client-side)

Quiz submission dedup uses an in-memory `Set` (not Redis) because `submitQuizResults` runs in the browser. The server-side RPC (`submit_quiz_results` / `atomic_quiz_profile_update`) is already idempotent via ON CONFLICT.

| Guard | Scope | TTL | Purpose | Failure Mode |
|---|---|---|---|---|
| `_inflightQuizSubmissions` Set | Same browser tab | 300s (5 min) | Prevent double-click / SWR retry | Allow (RPC is idempotent) |

## Rules

1. Every key has an explicit TTL -- no unbounded keys
2. Redis failure = allow operation (safe default for all idempotency keys)
3. Idempotency locks are released on error so retries work
4. Rate limit keys use sliding window (1 minute)
5. Never store PII in Redis keys or values (P13)
6. Key prefixes are namespaced by function: `rl:`, `sess:`, `webhook:`, `bootstrap:`