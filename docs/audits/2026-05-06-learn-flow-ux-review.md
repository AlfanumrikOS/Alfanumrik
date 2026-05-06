# `/learn` UX Review

**Date:** 2026-05-06
**Prod SHA:** `088906f8`
**Files reviewed:** `src/app/learn/page.tsx`, `src/app/learn/[subject]/page.tsx`, `src/app/learn/[subject]/[chapter]/page.tsx` (~700 LOC), `src/app/learn/{error,loading}.tsx`.

---

## Headline

The page Phase 0's REPO_DIFF flagged as "missing" is in fact substantial and well-built. It is mobile-first, deeply bilingual (Hindi + English everywhere), plan-gated, and integrates with Foxy. It does **not**, however, render actual NCERT chapter prose — the "concepts" are titles + quick-check questions, not reading content. The infrastructure to render real text (RAG-RRF over `rag_content_chunks`) shipped in prod and is unused by this page.

## What works

- **Bilingual parity is real.** Every visible string branches on `isHi` from `useAuth()` — examples: completion-screen score labels (`page.tsx:209-215`), weak-concept callouts (`page.tsx:265`), CTAs (`page.tsx:292`). This is rare; many "Hindi-supported" products only translate static labels.
- **Foxy deep-link with chapter context** at `[chapter]/page.tsx:186` (`/foxy?subject=&mode=doubt&topic=`) and a second weak-concept Foxy CTA at line 276. The Phase 1 spec assumed this needed building; it's already wired.
- **Plan-based subject gating** via `useAllowedSubjects` + `getPlanConfig` (`src/app/learn/page.tsx:30, 79`). Locked subjects render greyed-out with an upgrade hint instead of being hidden — better UX than gating-by-omission.
- **Chapter completion is intelligent.** Score-conditional CTAs: ≥80% → "Excellent! mastered", ≥60% → "Take the quiz", <60% → weak-concept review with Foxy. Server-side progress write only at ≥60% (`[chapter]/page.tsx:124-129`).
- **"Continue where you left off"** via localStorage with a 7-day TTL (`learn/page.tsx:39-50`). Survives across sessions without a server round-trip.
- **Mobile-first layout.** `mesh-bg min-h-dvh pb-nav` + `app-container max-w-lg mx-auto` recur throughout. Designed for ~360-wide screens.

## What's missing or weak

- **No structured chapter reading content.** The page walks a student through a list of concept titles and quick-check questions, but there is no prose rendering of actual NCERT chapter text. The `rag_content_chunks` table is queried by the RAG pipeline for Foxy, but `/learn/[subject]/[chapter]` never reads it. A student opening Chapter 1 of Class 9 Math sees a list of concept names, not the chapter itself. This is the **largest real gap.**
- **No PostHog telemetry on the learning loop.** `posthog-js` and `posthog-node` are in `package.json`; `_shared/posthog.ts` exists for edge functions. `/learn/[subject]/[chapter]` emits zero PostHog events — no `started_chapter`, no `completed_concept`, no `chapter_passed_60pct`, no `viewed_weak_concept`. Without this, you can't tell which chapters students actually finish, where they drop off, or whether the Foxy CTA helps. Highest-ROI single fix in the page.
- **No inbound deep-link from quiz remediation.** A wrong answer on the quiz could deep-link to `/learn/[subject]/[chapter]?from=quiz&concept=` to drop the student into the right concept. The page doesn't parse that query string. The post-quiz remediation route (`src/app/api/foxy/remediation/route.ts`) exists; the wiring to `/learn` is missing.
- **Concept ↔ question pairing is loose.** `questions[currentIdx % Math.max(questions.length, 1)]` (`[chapter]/page.tsx:148`) means the question shown for concept N may not actually be about concept N. If `topics.length > questions.length` the page silently wraps. Either the data model needs `chapter_questions.concept_id` or the page needs to filter questions per concept.
- **`parseOptions` accepts string-or-array** (`[chapter]/page.tsx:132-135`). The defensive parse suggests `question_bank.options` is sometimes JSON-encoded text and sometimes a real array. Worth normalising at the DB or RPC boundary.
- **localStorage.setItem on every currentIdx change** (`[chapter]/page.tsx:104-116`). Minor — could batch via a debounce.
- **No skeleton during initial load.** `<LoadingFoxy />` blocks the entire screen while three queries run in parallel. Above-the-fold structure is known and could render with placeholders.

## Real gap rating: **MEDIUM**

The page is good for ~700 LOC of student-facing code and addresses the audit's "no chapter view" complaint. Two things keep it from "production-grade good":

1. The headline missing piece — no chapter prose rendering — is genuinely a feature, not a fix. Adding a "Read mode" toggle that pulls NCERT text from `rag_content_chunks` (RRF already shipped) is a 1-2 week ship.
2. The telemetry gap is a 2-day fix and turns the page from "we hope it works" into "we can see whether it works."

Together those two define a clean Phase 2 candidate: **`/learn` Read Mode + telemetry**, both leveraging infrastructure that already exists in prod. No new tables, no new edge functions, just (a) a toggle, a server-side RAG fetch, and a markdown-renderer, and (b) ~10 PostHog `capture()` calls.
