# Phase 1 — Consumer Minimalism Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Every wave ships behind its own feature flag (default OFF). No product-invariant formula (P1/P2/P3/P4/P6) may change — consolidation is UI/runtime only.

**Goal:** Shrink the student front door from 27 destinations to a 4-tab "one loop" model led by an adaptive **Today** home, unify the four quiz-like routes into one parameterized runtime, and replace the heavy 8-tab parent portal with a push-first **glance** home — without changing any scoring, XP, anti-cheat, or atomic-submit behavior.

**Companion spec:** [docs/superpowers/specs/2026-06-06-consumer-minimalist-redesign-design.md](../specs/2026-06-06-consumer-minimalist-redesign-design.md)

**Tech stack:** Next.js 16 App Router (`src/app/`), React 18, Tailwind, SWR, Supabase, `authorizeRequest` (`src/lib/rbac.ts`), resolver (`src/lib/state/learner-loop/`), feature flags (`src/lib/feature-flags.ts`), Vitest + Playwright.

**Rollout principle:** new surfaces are built next to the old ones behind flags; old routes keep working and become 301 redirects only after each flag goes GA. Nothing is deleted in Phase 1.

---

## Feature flags (all default OFF)

| Flag | Gates |
|---|---|
| `ff_today_home_v1` | Wave A — adaptive Today home + 4-tab nav |
| `ff_unified_quiz_v1` | Wave B — single quiz runtime (`mode` param) |
| `ff_parent_glance_v1` | Wave C — parent glance home + Encourage |
| `ff_parent_unified_auth_v1` | Wave D — guardian-role auth (E2 closure) |

---

## Wave A — Adaptive "Today" home (web first)

**Owners:** frontend (UI) ← assessment (defines what the queue must contain & ordering) · backend (BFF route)
**Risk:** medium (new front door; behind flag)

- [ ] **A1 (assessment):** Specify the Today queue contract — ordered item types (resume-in-progress, SRS-due, weak-topic ZPD pick, scheduled dive/synthesis), max items, tie-breaks. Confirm it reuses `resolve-next-action.ts`; **no new scoring logic**. Acceptance: written contract + example payloads for 3 learner states.
- [ ] **A2 (backend):** `GET /api/v2/today` returns the resolved queue via the existing resolver + scheduled-actions; `authorizeRequest(request, 'study_plan.view')`; read-only (no learner-state writes). Acceptance: typed response, RLS-safe, unit-tested, p95 < 400ms on warm cache.
- [ ] **A3 (frontend):** `/today` page + 4-tab nav (Today/Learn/Foxy/Me) gated by `ff_today_home_v1`. One Focus card + single Continue CTA + Up-next list + week sparkline. Bilingual (P7), loading/empty/error states, bundle within P10. Acceptance: renders all 3 learner states; Continue routes to the resolver's chosen surface.
- [ ] **A4 (frontend):** "Me" tab = progress hero + streak + rank + settings (composed from existing components, no new analytics). 
- [ ] **A5 (testing):** Unit tests for `/api/v2/today`; E2E for Today render + Continue dispatch across states; flag-off path unchanged.
**Review chain:** assessment → frontend → testing → quality. (Learner-state surface → assessment + frontend + testing per P14.)

---

## Wave B — Unified quiz runtime

**Owners:** assessment (defines invariant preservation) ← frontend (runtime) · backend (question source adapter)
**Risk:** high (touches quiz/scoring surface — formulas must be byte-identical)

- [ ] **B1 (assessment):** Define the mode matrix `practice | pyq | mock | exam` — only *sourcing/timing/UI* differ; P1 score formula, P2 XP, P3 anti-cheat, P4 atomic `atomic_quiz_profile_update()`, P6 question quality are **identical across modes**. Acceptance: explicit "what changes vs what must not" table.
- [ ] **B2 (frontend):** One quiz runtime component accepting a `mode` prop; `/quiz`, `/pyq`, `/mock-exam`, `/exams` mount it with mode params behind `ff_unified_quiz_v1`. Old pages untouched while flag OFF. Acceptance: all four modes pass through the same submit path.
- [ ] **B3 (backend):** Question-source adapter (bank/PYQ-year/blueprint) feeding the unified runtime; submit still routes through the existing atomic RPC unchanged.
- [ ] **B4 (testing):** Regression tests proving score/XP/anti-cheat results are identical pre/post for each mode; add a catalog entry pinning formula parity across modes.
**Review chain:** assessment → frontend → backend → testing → quality. (Quiz/scoring → assessment defines behavior first; testing mandatory.)
**Gate:** assessment sign-off REQUIRED before any code (P1/P2/P3/P4/P6).

---

## Wave C — Parent glance home + Encourage + push digest

**Owners:** frontend (glance UI) · backend (encourage API + digest job) ← assessment (Moments summarization correctness, read-only)
**Risk:** medium

- [ ] **C1 (frontend):** `/parent` glance home behind `ff_parent_glance_v1` — Snapshot + Moments + Actions, one scroll, bilingual (P7), no charts on the home. Old 8-tab portal reachable via settings while flag OFF.
- [ ] **C2 (backend):** `POST /api/v2/parent/encourage` — sends a child in-app cheer; `authorizeRequest` with `child.view_progress` + guardian-link ownership check; rate-limited; **no PII in logs (P13)**.
- [ ] **C3 (backend):** Weekly digest push/WhatsApp via existing notification/`whatsapp-notify` path; reuses parent-report summary, no new PII surface.
- [ ] **C4 (testing):** Unit tests for encourage authorization + ownership; E2E parent glance render + Encourage; assert log redaction.
**Review chain:** frontend → backend → testing → quality; ops (notification type). (Notification types → backend + frontend + ops.)

---

## Wave D — Parent auth unification (E2 closure)

**Owners:** architect (auth design) ← backend (route migration) · frontend (login surface) · testing (E2E all roles)
**Risk:** HIGH — touches auth + **P15 onboarding integrity**. Architect must approve approach FIRST.

- [ ] **D1 (architect):** Design migration from HMAC `link_code` to Supabase guardian role + `guardian_student_links`; preserve every existing linked parent (no re-link required); RLS parity matrix. Acceptance: approach doc + back-compat guarantee.
- [ ] **D2 (backend):** Migrate parent API routes to `authorizeRequest`-based guardian auth behind `ff_parent_unified_auth_v1`; HMAC path remains until flag GA.
- [ ] **D3 (frontend):** Parent login uses standard Supabase auth; child-link flow preserved.
- [ ] **D4 (testing):** E2E for all three roles' onboarding (P15) + parent link + revoke; verify no existing parent loses access.
**Review chain:** architect → backend → frontend → testing (E2E all 3 roles) → quality.
**Gate:** CEO sign-off recommended (P15 is non-negotiable; this changes the auth path).

---

## Sequencing

```
Wave A  ───────────────┐  (independent; ship first — highest user impact)
Wave B  ──────┐        │  (assessment sign-off gates start; parallel to A)
Wave C  ──────┼────────┤  (parallel; independent files)
Wave D  ──────┘        │  (architect approval gates start; can trail A/B/C)
                       ▼
        testing (per wave) -> quality (per wave) -> flag ramp Pilot -> GA
```

Waves A, B, C touch disjoint files and may run in parallel. Wave D is gated on architect approval and carries the highest risk — schedule it to trail and treat its flag ramp conservatively.

---

## Definition of done (Phase 1)

- All four flags exist, default OFF, seeded via migration.
- Flag-OFF behavior is byte-identical to today (no regressions on the old routes).
- `npm run type-check`, `npm run lint`, `npm test`, `npm run build` all green; bundles within P10.
- Review chains complete per wave (Gate 5); no product-invariant formula changed.
- Spec + this plan committed; regression catalog updated for Wave B formula-parity.
