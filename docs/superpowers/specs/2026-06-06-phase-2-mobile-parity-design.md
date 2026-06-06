# Phase 2 — Mobile Parity via One Contract (Design Spec)

**Status:** Proposed · **Author:** Orchestrator · **Date:** 2026-06-06
**Companion plan:** [docs/superpowers/plans/2026-06-06-phase-2-mobile-parity.md](../plans/2026-06-06-phase-2-mobile-parity.md)
**Parent spec:** [2026-06-06-consumer-minimalist-redesign-design.md](2026-06-06-consumer-minimalist-redesign-design.md) (Phase 2 section)
**Approval needed from:** CEO for (a) the TS→Dart codegen toolchain, (b) offline scope (mobile-first vs web+mobile), (c) parity scope (which screens land in Phase 2).

---

## 1. Goal
Bring the Flutter app to **full parity with web for students and add parents**, by making web + mobile **render one typed `/v2` BFF contract** instead of each re-implementing screens. Plus an **offline-tolerant Today queue** for Indian 4G. This converts mobile parity from a perpetual porting effort into "render the contract."

## 2. Grounded starting point (audit)
- `/v2` is **seeded** (`/api/v2/today`, `/api/v2/parent/encourage`) but there is **no contract standard** — v1 routes use 3 different response envelopes; `src/lib/api-response.ts` exists but is under-adopted.
- **No type-sharing/codegen.** Zod (`src/lib/validation.ts`) validates TS only; `src/types/database.types.ts` is Supabase-generated TS. Mobile models are **hand-written `fromJson` on both sides** — the core brittleness.
- **Mobile** (`mobile/`): student-only, Supabase-JWT (email/password), Dio client with Bearer interceptor + retry, Riverpod, Hive 5-min TTL cache. **Consumes zero `/v2`** (all Supabase RPC/table or v1). Missing entirely: Today home, Progress, Leaderboard, Exams, Parent portal. `connectivity_plus` + quiz idempotency keys already present; no offline queue/sync.
- **Edge**: `src/proxy.ts` already accepts **Bearer JWT** (mobile) and cookies (web) cleanly; RBAC + rate-limit are per-route.
- **Offline substrate**: `public/sw.js` does static + network-first caching + a background-sync **stub** (no durable queue). The **`state_events` spine is an idempotent durable sink** (unique idempotency key) — ideal for replaying offline-captured actions. Anti-cheat (P3) min-3s-avg would **reject stale-time replays** unless we timestamp capture and recompute at sync.

## 3. The contract standard (`/v2`)
Every `/v2` route MUST:
- Use the standard envelope from `src/lib/api-response.ts`: success `{ success: true, data }`, error `{ success: false, error, code }`. No raw-shape responses.
- Validate the request with a **Zod schema** via `validateBody()` (uniform 400s).
- Accept **both** Bearer JWT (mobile) and cookie (web); enforce RBAC via `authorizeRequest`.
- Be **read-only on learner state** unless it routes through the canonical RPC/event path (P4). Quiz/scoring endpoints preserve P1/P2/P3/P6 verbatim (assessment-reviewed).
- Declare a versioned `schemaVersion` in payloads.

## 4. One source of truth → TS + Dart (codegen pipeline)
Recommended: **Zod schemas are the single source of truth** → generate **OpenAPI 3.1** (`@asteasolutions/zod-to-openapi`) → generate **Dart client + models** (`openapi-generator`, dart-dio). This:
- Emits TS types (already have via Zod inference) AND Dart models from one definition.
- Kills hand-written `fromJson` drift on both sides.
- Lets CI fail on contract drift (generated client out of date).

Trade-off vs alternative (hand-maintained Dart models + a contract test): codegen has upfront toolchain cost but eliminates the recurring breakage the audit flagged across 8 mobile model files. **Recommendation: codegen.** (CEO/architect to ratify at Wave 2.1.)

## 5. Offline Today architecture (the hard part)
```
Today bundle (cached in Hive / IndexedDB):
  - resolved Today queue (/v2/today)
  - questions for each quiz action (+ server shuffle_map + difficulty snapshot)  ← P1/P6 integrity
  - capturedAt server timestamp
Offline action queue:
  - quiz submissions serialized with { idempotencyKey, responses, perQuestionTimes, capturedAt }
On reconnect:
  - replay via /v2/quiz/submit (idempotent RPC — safe re-send)
  - server recomputes time from capturedAt (NOT wall-clock at sync) so P3 anti-cheat holds
  - emits learner.quiz_completed / mastery_changed on the event spine (dedup by idempotencyKey)
```
Integrity rules: bundle the **server shuffle_map + difficulty** so offline scoring matches server (P1/P6); never trust client-computed score (server re-derives, P1); idempotency prevents double-XP (P2/P6).

## 6. Scope recommendation (what lands in Phase 2)
- **In**: contract standard + codegen; the consumer `/v2` endpoints; mobile migrated to `/v2` with generated models; **student parity** for Today + Learn + Foxy + Quiz + Progress + Leaderboard; **parent on mobile** (glance + encourage, riding the just-unified guardian-JWT); **offline Today queue (mobile-first)**; **mobile CI/CD**.
- **Defer**: full Exams/mock engine on mobile (heavy; after the unified-quiz Wave B decisions); web offline (mobile is the 4G-critical surface — do web SW upgrade as a fast-follow); pagination standard (v3).

## 7. Trade-offs
| Decision | Win | Risk | Mitigation |
|---|---|---|---|
| Zod→OpenAPI→Dart codegen | one source of truth, no drift | new toolchain | proof-of-concept on /v2/today first; fall back to contract-test if friction |
| Offline mobile-first | matches 4G reality, biggest user win | replay anti-cheat (P3) | capturedAt + server time recompute; idempotent replay |
| /v2 standard for all new routes | clean mobile rendering | refactor effort | only NEW /v2; v1 stays until migrated behind it |
| Parent on mobile now | captures mobile-first parents | depends on guardian-JWT (done) | reuse D-authunify auth + /v2/parent/* |

## 8. What to revisit at scale
- If codegen friction is high, a hand-maintained Dart contract + golden contract tests is the fallback.
- Offline conflict policy (last-write vs server-authoritative) — start server-authoritative (re-derive), revisit if UX demands optimistic.
- Web offline parity once mobile offline is proven.

## Invariants touched
P1 score / P2 XP / P3 anti-cheat / P4 atomic / P6 question quality (all quiz `/v2` endpoints + offline replay — must be byte-identical, assessment-gated) · P7 bilingual (mobile screens) · P8 RLS / P9 RBAC (every `/v2` route) · P10 bundle (web), mobile size budget · P12/P13 (Foxy on mobile, parent data) · P15 untouched.
