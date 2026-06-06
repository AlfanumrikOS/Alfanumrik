# Phase 2 — Mobile Parity Implementation Plan

> Implement wave-by-wave. Everything ships behind flags / a mobile staged rollout. No quiz/scoring invariant (P1/P2/P3/P4/P6) changes — `/v2` quiz endpoints and offline replay must be byte-identical and assessment-gated.

**Goal:** web + mobile render one typed `/v2` contract; full student parity + parent on mobile; offline Today queue.
**Companion spec:** [docs/superpowers/specs/2026-06-06-phase-2-mobile-parity-design.md](../specs/2026-06-06-phase-2-mobile-parity-design.md)
**Tech:** Next.js 16 `/v2` routes, Zod, `src/lib/api-response.ts`, `@asteasolutions/zod-to-openapi` + `openapi-generator` (dart-dio), Flutter/Riverpod/Dio/Hive, `state_events` spine, Vitest + Playwright + `flutter test`.

---

## Wave 2.1 — `/v2` contract standard + codegen pipeline (foundation)
**Owners:** architect (standard + pipeline) ← backend, mobile (consumers), quality
**Risk:** medium (new toolchain)
- [ ] 2.1.1 (architect) Write the `/v2` contract standard doc: envelope (`api-response.ts`), error codes, Bearer+cookie auth, `schemaVersion`, pagination convention. Add a CI lint that every `src/app/api/v2/**` route uses the envelope + a Zod schema.
- [ ] 2.1.2 (architect) Stand up the codegen pipeline: register Zod schemas in an OpenAPI registry (`@asteasolutions/zod-to-openapi`) → emit `openapi/v2.json` → generate a Dart client (`mobile/lib/api/v2/` via openapi-generator dart-dio). Add `npm run gen:openapi` + a Flutter codegen step. CI drift-check: regenerate and fail if dirty.
- [ ] 2.1.3 (architect) Proof: retrofit the EXISTING `/v2/today` + `/v2/parent/encourage` into the registry; emit their Dart models. Acceptance: `openapi/v2.json` builds; Dart models compile.
**Review chain:** architect → backend, mobile, quality.
**Decision gate (CEO/architect):** ratify codegen vs hand-maintained-contract before 2.1.2.

## Wave 2.2 — `/v2` consumer endpoints
**Owners:** backend (routes) ← assessment (quiz/scoring correctness), architect (contract), testing
**Risk:** medium-high (quiz endpoints touch P1-P6)
- [ ] 2.2.1 (backend) Student: `/v2/student/profile`, `/v2/student/dashboard` (or reuse `/v2/today`), `/v2/student/progress`, `/v2/student/leaderboard` — wrap existing domain logic/RPCs; standard envelope + Zod.
- [ ] 2.2.2 (backend) Learn: `/v2/learn/curriculum` (subjects/chapters/topics), `/v2/learn/concept`.
- [ ] 2.2.3 (backend + assessment) Quiz: `/v2/quiz/questions`, `/v2/quiz/start`, `/v2/quiz/submit` — MUST route through the existing `atomic_quiz_profile_update` path; P1 score, P2 XP, P3 anti-cheat, P6 quality byte-identical. **Assessment sign-off REQUIRED before code.**
- [ ] 2.2.4 (backend) Foxy: `/v2/foxy` (or document reuse of `/api/foxy`). Parent: `/v2/parent/glance`, `/v2/parent/children` (+ existing `/v2/parent/encourage`).
- [ ] 2.2.5 (testing) Contract tests per endpoint (envelope, Zod, RLS/RBAC, Bearer+cookie). Parity test: `/v2/quiz/submit` == legacy for identical inputs.
**Review chain:** assessment (quiz) → backend → architect (contract) → testing → quality.

## Wave 2.3 — Mobile migration to `/v2` + generated models + student parity
**Owners:** mobile ← backend (contract), assessment (quiz UI), testing, quality
**Risk:** high (large refactor)
- [ ] 2.3.1 (mobile) Adopt generated Dart models (replace 8 hand-written `fromJson`); wire the generated `/v2` client into the Dio stack (reuse Bearer interceptor).
- [ ] 2.3.2 (mobile) Migrate the 6 repositories (auth/dashboard/quiz/learning/chat/subscription) to `/v2`, behind a `useV2` env/flag; keep legacy path until parity proven.
- [ ] 2.3.3 (mobile) New parity screens: **Today** home (the centerpiece adaptive queue, renders `/v2/today`), **Progress**, **Leaderboard**; round out Learn (per-chapter progress) + Quiz (results/history) + Foxy (grounding labels). 4-tab nav (Today/Learn/Foxy/Me) to mirror web.
- [ ] 2.3.4 (testing) `flutter test` for repositories + a smoke E2E on a device/emulator; verify quiz scoring matches server.
**Review chain:** mobile → assessment (quiz parity) → testing → quality.

## Wave 2.4 — Parent on mobile
**Owners:** mobile ← backend (parent /v2), architect (auth), testing
**Risk:** medium (rides done D-authunify guardian-JWT)
- [ ] 2.4.1 (mobile) Role-aware auth: a guardian Supabase-JWT logs into a parent nav tree (reuse the unified guardian auth from D-authunify; mobile already holds the Supabase session).
- [ ] 2.4.2 (mobile) Parent glance screen (Snapshot/Moments/Actions) rendering `/v2/parent/glance`; Encourage via `/v2/parent/encourage` (preset picker from the shared catalog).
- [ ] 2.4.3 (testing) Parent login + glance + encourage flow; student login still works (role fork).
**Review chain:** mobile → backend → testing → quality.

## Wave 2.5 — Offline Today queue + sync (mobile-first)
**Owners:** mobile + backend ← assessment (anti-cheat replay), architect (event sink), testing
**Risk:** high (P3 replay)
- [ ] 2.5.1 (backend + assessment) `/v2/quiz/submit` accepts `capturedAt` + `shuffle_map` + `difficulty` snapshot; server recomputes per-question time from `capturedAt` (not sync wall-clock) so P3 holds; idempotent replay (P2/P6). **Assessment sign-off REQUIRED.**
- [ ] 2.5.2 (mobile) Hive "today bundle" (queue + questions + shuffle/difficulty + capturedAt) prefetch; offline submission queue; drain on `connectivity_plus` restore.
- [ ] 2.5.3 (architect) Confirm replayed submissions land on the `state_events` spine idempotently (dedup by idempotencyKey); add `learner.offline_sync_replay` telemetry.
- [ ] 2.5.4 (testing) Offline→online quiz cycle: same score/XP/anti-cheat verdict as online; no double-count.
**Review chain:** assessment + architect → backend + mobile → testing → quality.

## Wave 2.6 — Mobile CI/CD + release
**Owners:** architect (CI) + mobile, ops
**Risk:** low-medium
- [ ] 2.6.1 (architect) `.github/workflows/mobile-ci.yml`: `flutter analyze` + `flutter test` + build APK/AAB (debug). Can start early, parallel to 2.1.
- [ ] 2.6.2 (architect + ops) Signed AAB + Play Store track (internal → closed → prod) via fastlane; versioning strategy; secrets (keystore, Play service account).
**Review chain:** architect → ops, testing.

---

## Sequencing
```
2.1 contract+codegen ─┬─> 2.2 endpoints ──┬─> 2.3 mobile migrate+parity ─┬─> 2.5 offline
                      │                    └─> 2.4 parent on mobile ──────┘
2.6 mobile CI ────────┘ (start early, parallel)
```
2.1 gates everything. 2.3 and 2.4 can overlap once 2.2 lands the relevant endpoints. 2.5 (offline) last (needs 2.3 quiz path). 2.6 runs in parallel from the start.

## Definition of done (Phase 2)
- `/v2` standard + codegen pipeline live; CI drift-check green; Dart models generated.
- Consumer `/v2` endpoints shipped, contract-tested, RLS/RBAC enforced; quiz endpoints assessment-verified byte-identical (P1-P6).
- Mobile renders `/v2` via generated models; student parity (Today/Learn/Foxy/Me + Progress/Leaderboard); parent login + glance + encourage on mobile.
- Offline Today queue works mobile-first with safe (P3-preserving, idempotent) replay.
- Mobile CI builds; release track established.
- `npm run type-check`/lint/test/build green; `flutter analyze`/`flutter test` green.

## Open decisions (CEO)
1. Codegen toolchain (Zod→OpenAPI→Dart) vs hand-maintained Dart + contract tests — recommend codegen.
2. Offline scope: mobile-first (recommended) vs web+mobile together.
3. Parity scope: confirm Today+Progress+Leaderboard in; Exams deferred (pending Wave B decisions).
4. Mobile release cadence + Play Store track ownership.
