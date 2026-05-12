# ADR-001: The Learner Loop — Unifying Subjects, Study Plan, Review, Compete, Scan, Revise, Begin Lesson

| Field | Value |
|---|---|
| **Status** | Accepted (2026-05-12) — Phase 1 landed on `feat/learner-loop-phase-1` |
| **Date** | 2026-05-12 |
| **Author** | Pradeep Sharma (with Claude, acting as principal architect) |
| **Deciders** | CEO sign-off required before Phase 1 build |
| **Composes with** | [Pedagogy v2 — Three-Speed Rhythm](../superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md) (this ADR is its connective-tissue addendum), [White-Label Foundation PR #558](../../) (tenant-scoped throughout), [Agent Mesh α](../../agents/README.md) (consumes the same signals) |
| **Replaces** | Nothing. Every existing surface stays addressable; only its *role* changes. |

---

## 1. Context — Why "the seven things feel useless"

The CEO's verdict on the current student surfaces — **Subjects & Chapters, Study Plan, Flashcard Review, Compete, Scan, Revise, Begin Lesson** — is correct. Each works in isolation. None of them works *as one product*. The root cause is not feature quality; it is **the absence of a single coordinating loop**.

Verified ground truth (repo HEAD `5da2d6d9`, 2026-05-12):

| Feature | Route | Tables / Engines | State today |
|---|---|---|---|
| Subjects & Chapters | `/learn`, `/learn/[subject]/[chapter]` | `rag_content_chunks`, `chapter_progress` | Works. Browse + Read mode. Knows nothing about what student is weak at. |
| Study Plan | `/study-plan` | `study_plans`, `study_plan_tasks` | Works. Generates 5–7 day plan with 8 task types. Has its own scheduler that ignores SRS queue. |
| Flashcard Review | `/review` | `review_cards` (SM-2) | Works. Three sources (quiz wrong / Foxy save / study plan). Push-only — completions don't promote topics in BKT. |
| Compete | `/challenge`, `/leaderboard` | `daily_challenges`, `student_challenges` | Works. Concept Chain game + leaderboard. Decoupled from student's weak topics — daily challenge is grade-wide, not personalised. |
| Scan | `/scan` | `image_uploads`, edge fn `scan-ocr` | Works. Extracts `{subject, chapter, questions[], topics[]}` from homework photo. **Output is a dead end** — questions don't enter the queue. |
| Revise | *no route* | — | **Does not exist as a destination.** A `revision` task-type lives inside study plan, and a single "Re-read Chapter N" CTA lives on `QuizResults` (Phase 3-D). The BottomNav has no Revise entry. The CEO felt this — there's a verb on his list with nothing to grab onto. |
| Begin Lesson | dashboard `AboveFoldHero`, dashboard `FocusDashboard`, study-plan tasks, daily-rhythm queue | resolves to `/learn/[subject]/[chapter]` or `/quiz` | **Means five different things depending on where it's clicked.** No single resolver. |

The unification design already exists on paper — [Pedagogy v2: Three-Speed Rhythm](../superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md). The daily layer is partially built (`/api/rhythm/today`, `DailyRhythmQueue` component, gated by `ff_pedagogy_v2_daily_rhythm`). **What is missing is the connective tissue that makes the seven features collapse into that loop.** This ADR specifies that tissue.

## 2. Decision

Adopt **The Learner Loop** as the canonical mental model and runtime spine for every student surface. The Loop has five phases — **Sense → Score → Schedule → Show → Reward** — and three time horizons — **Daily, Weekly, Monthly** — already specified in Pedagogy v2.

Each of the seven features becomes a **role** in the Loop, not an island:

```
                      ┌──────────────────────────────────────────┐
                      │           THE LEARNER LOOP               │
                      │                                          │
   ┌─── Scan ─────┐   │   SENSE         (signals enter)          │
   │  Quiz attempt│ ──┼─► quiz, scan, foxy, review, lesson event │
   │  Foxy chat   │   │                                          │
   │  Review tap  │   │            │                             │
   │  Lesson done │   │            ▼                             │
   └──────────────┘   │   SCORE         (BKT + mistake taxonomy) │
                      │   • per-topic mastery delta              │
                      │   • Bloom-level inference                │
                      │   • ZPD difficulty bin                   │
                      │   • Ebbinghaus decay clock               │
                      │                                          │
                      │            ▼                             │
                      │   SCHEDULE      (one queue, three speeds)│
                      │   • Daily: 5 SRS + 1 ZPD + 1 reflection  │
                      │   • Weekly: 1 dive (60 min)              │
                      │   • Monthly: 1 synthesis artifact        │
                      │                                          │
                      │            ▼                             │
   ┌── Subjects ──┐   │   SHOW          (one resolver)           │
   │  Study Plan  │ ◄─┤   GET /api/learner/next                  │
   │  Review      │   │     → LearnerAction discriminated union  │
   │  Revise      │   │   Every "Begin Lesson" button calls this │
   │  Compete     │   │                                          │
   │  Begin Lsn   │   │            ▼                             │
   └──────────────┘   │   REWARD        (mastery-gated)          │
                      │   • XP / coins / streak / badge          │
                      │   • Tied to mastery delta, not activity  │
                      │                                          │
                      └────────────┬─────────────────────────────┘
                                   │
                                   ▼
                              Loop continues
```

**Two architectural commitments make the Loop real**, not just a diagram:

### Commitment A — One Next-Action Resolver

A single server function, `resolveNextLearnerAction(studentId, context?)`, is the **only** thing that answers "what should this student do right now?" Exposed as `GET /api/learner/next`. Every entry point — dashboard hero, study-plan tap, post-quiz CTA, daily-rhythm-queue item, deep-link from notification — routes through it. Today there are at minimum **five** competing answers to this question; after Phase 1 there is exactly one.

### Commitment B — One Signal Bus

A single typed signal type, `LearnerSignal`, is the input contract for **every** event that mutates learner state — quiz attempts, scan extractions, Foxy turns, review card grades, lesson completions, weekly-dive artifacts. Today these write to seven different tables with seven different shapes; after Phase 1 they all also publish a `LearnerSignal` to the event bus (`src/lib/events/`, landed in PR #558). BKT + mistake taxonomy + SRS scheduling subscribe to the bus, not to the individual writers. **This is what makes Scan stop being a dead end.**

---

## 3. The Seven Features — Re-mapped

| Feature | Role in the Loop | Concretely changes how |
|---|---|---|
| **Subjects & Chapters** (`/learn`) | **Library mode** — browse-by-curriculum entry. Stays as-is for self-directed access. *But* the default ordering becomes mastery-aware (weak chapters first, then due-for-review, then unexplored). The "Continue last topic" card on the dashboard delegates to `resolveNextLearnerAction`. |
| **Study Plan** (`/study-plan`) | **Calendar projection of the Schedule** — a 5-to-7-day window onto the unified queue. The plan is no longer a separate scheduler with its own task-type heuristics. `generateStudyPlan` becomes `projectScheduleAsPlan(scheduler.output, days)`. Tasks that are SRS reviews link to `/review?card=…`; ZPD problems to `/quiz?topic=…`; dives to `/dive`. |
| **Flashcard Review** (`/review`) | **Daily-layer SRS slice** — today's due reviews only. Completing a card publishes a `LearnerSignal` of kind `review_graded` which updates BKT (currently it does not). Quality 4–5 reviews promote a topic above the "weak topics" threshold; quality 0–3 enqueue a Revise action. |
| **Compete** (`/challenge`, `/leaderboard`) | **Mastery-tied competitive layer.** Today's Concept Chain is grade-wide; rebuild it as a *personalised* daily challenge whose chain nodes are selected from the student's weak-topic set (still mastery-bounded so it's fair). Leaderboard becomes per-topic-mastery percentile within the student's class, not raw XP. |
| **Scan** (`/scan`) | **Sense input only — not a destination.** The page captures the photo and shows the extraction result, but its primary success state becomes "Added 6 questions to your queue." The extracted questions enter the unified queue tagged `source: 'scan'` and are surfaced through the normal Daily slots and Study Plan, not as a separate `/scan/results/[id]` flow. |
| **Revise** *(new `/revise` route)* | **First-class post-mistake surface.** Distinct from Review: Revise = re-encounter the *source content* (chapter section, Foxy explainer, worked example) for topics where BKT has decayed below threshold. Review = recall the flashcard. Today's "Re-read Chapter N" CTA on `QuizResults` becomes one of many entry points into `/revise`. The page shows a stack of "topics that need a second look" with the optimal modality (read / explainer / worked example) chosen per topic. |
| **Begin Lesson** | **Not a feature — a single global verb.** Every button labelled "Begin Lesson", "Continue learning", "Start Today's Quiz", "Next task" calls `resolveNextLearnerAction` and routes to the returned `LearnerAction.url`. The student never sees five inconsistent CTAs again. |

---

## 4. Contracts (the load-bearing types)

These four types are the only new public surface. Everything else is implementation.

```typescript
// src/lib/learner-loop/types.ts

/** Every learning event publishes one of these to the event bus. */
export type LearnerSignal =
  | { kind: 'quiz_attempted';    studentId: string; topicId: string; questionId: string;
                                 correct: boolean; bloomLevel: BloomLevel; difficulty: 1|2|3;
                                 timeMs: number; source: 'quiz'|'mock-exam'|'pyq'|'challenge'; }
  | { kind: 'review_graded';     studentId: string; cardId: string; topicId: string;
                                 quality: 0|3|4|5; previousInterval: number; }
  | { kind: 'lesson_completed';  studentId: string; topicId: string; chapterNumber: number;
                                 modality: 'read'|'concept-walk'|'worked-example';
                                 timeMs: number; }
  | { kind: 'foxy_turn';         studentId: string; topicId: string|null;
                                 mode: 'socratic'|'explainer'|'homework'|'rapid';
                                 sentimentDelta: number; }
  | { kind: 'scan_extracted';    studentId: string; uploadId: string;
                                 detectedTopics: string[]; questions: ExtractedQuestion[]; }
  | { kind: 'dive_artifact';     studentId: string; topicId: string;
                                 artifactKind: 'notebook'|'diagram'|'essay'|'problem';
                                 evaluatedQuality: 1|2|3|4|5; }
  | { kind: 'synthesis_emitted'; studentId: string; monthKey: string; /* YYYY-MM */
                                 chaptersTouched: string[]; masteryGain: number; };

/** The Resolver's output: a tagged action the UI can dispatch unconditionally. */
export type LearnerAction =
  | { kind: 'continue_lesson';     url: string; topicId: string; reason: string; }
  | { kind: 'start_quiz';          url: string; topicId: string; zpdBin: 1|2|3; reason: string; }
  | { kind: 'review_due_cards';    url: string; dueCount: number; reason: string; }
  | { kind: 'revise_decayed_topic';url: string; topicId: string; daysSinceLastTouch: number;
                                   recommendedModality: 'read'|'explainer'|'worked-example'; reason: string; }
  | { kind: 'weekly_dive';         url: string; suggestedPrompt: string; reason: string; }
  | { kind: 'monthly_synthesis';   url: string; reason: string; }
  | { kind: 'cold_start_diagnostic'; url: string; reason: string; }; // first-ever signal

/** A slot in the daily/weekly/monthly schedule, persisted in scheduled_actions. */
export interface ScheduledSlot {
  studentId: string;
  horizon: 'daily' | 'weekly' | 'monthly';
  rank: number;                  // order within the horizon
  action: LearnerAction;
  generatedAt: string;
  expiresAt: string;             // daily: 04:00 IST next day; weekly: Sunday 23:59 IST; monthly: month-end
  completedAt: string | null;
  source: 'scheduler' | 'manual_pin' | 'teacher_override';
}

/** The Resolver. Pure-ish — reads, never writes (writes happen via the bus). */
export function resolveNextLearnerAction(
  studentId: string,
  context?: { currentRoute?: string; sessionTimeBudgetMin?: number; mood?: 'focused'|'tired'|'unknown' },
): Promise<LearnerAction>;
```

**Resolver ordering (deterministic):**

1. **Hard gate** — cold-start diagnostic if `learner_state.signals_count < 5`.
2. **Today's due reviews** — if `dueReviewCount >= 5`, return `review_due_cards`. (Tomorrow's reviews compound; don't let them stack.)
3. **Decayed topics above threshold** — any topic with `bkt_p_mastery > 0.6` that hasn't been touched in `> retentionWindow(p_mastery)` days returns `revise_decayed_topic`.
4. **Today's ZPD problem** — if not yet attempted today and student is in a focus window, `start_quiz` at the right ZPD bin.
5. **Continue last lesson** — if there's an in-progress chapter ≥ 50% complete, `continue_lesson`.
6. **Weekly dive** — Sundays default to `weekly_dive`.
7. **Monthly synthesis** — month-end day defaults to `monthly_synthesis`.
8. **Fallback** — recommended next chapter from BKT-curriculum-graph.

Every step is unit-testable in isolation. The resolver returns within ≤50ms for a warm cache; cold cache budget is ≤250ms (a single Supabase RPC).

---

## 5. Options Considered

### Option A — Status Quo + Polish (rejected)

Keep all seven features as independent surfaces; invest in cross-links (more "Re-read Chapter" CTAs, more "From your scan" labels in Study Plan).

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | 1–2 weeks |
| Scalability | Bad — every new feature requires N² wiring |
| Team familiarity | High |

**Pros:** Cheap, no breaking changes, ships in days. **Cons:** Treats the symptom, not the cause. The CEO's "useless" verdict will return the moment we add an eighth feature. We have already done this twice (Phase 3-D Re-read CTA; Pedagogy v2 daily-rhythm queue) and the seven features still feel disjoint.

### Option B — Full Rewrite of Student Surface (rejected)

Tear down `/dashboard`, `/learn`, `/study-plan`, `/review`, `/challenge`, `/scan` and ship a single React Native–style "learner home" with no sub-routes.

| Dimension | Assessment |
|---|---|
| Complexity | Very high |
| Cost | 8–12 weeks; 17,000+ LOC at risk |
| Scalability | Excellent if done well |
| Team familiarity | Low — would discard the dashboard rewrite from 2026-05-05 |

**Pros:** Cleanest mental model. **Cons:** Throws away the 900-LOC dashboard rewrite that just landed, throws away `BottomNavComponent`'s grade-gated nav, breaks every existing deep link from notifications and Foxy citations, and burns the budget for the first paying school. Wrong move pre-launch.

### Option C — The Learner Loop (recommended) ✅

Keep every existing route. Add **one resolver, one signal bus, one shared scheduler**. Each feature mutates from *island* to *role*.

| Dimension | Assessment |
|---|---|
| Complexity | Medium (new types, new tables, new API; existing pages stay) |
| Cost | ~6 weeks across 5 phases, each behind its own flag |
| Scalability | Strong — adding feature #8 requires implementing the LearnerSignal contract, nothing else |
| Team familiarity | High — composes Pedagogy v2 + event bus + BKT, all already in-tree |

**Pros:** Reversible (flag off → status quo). Composes with the white-label work (every contract is `tenantId`-scoped). The agent-mesh L5 evaluators can subscribe to `LearnerSignal` for `learning_eval` (currently a stub). Pedagogy v2 spec finally has a runtime spine.

**Cons:** Requires discipline — every new feature *must* publish a signal, not write directly. Mitigated by a unit-test rule (Phase 1 below) that fails CI if a route writes to a state table without publishing the corresponding signal.

### Option D — Adopt the Agent Mesh as the Resolver (deferred, not rejected)

Let L1/L2 of the agent mesh decide the next action by orchestrating L4 workers per student per session.

| Dimension | Assessment |
|---|---|
| Complexity | Very high |
| Cost | Indeterminate — runtime is not yet shipped |
| Scalability | Excellent at horizon, unproven today |
| Team familiarity | Low — only scaffolding has landed (Phase α, 2026-05-11) |

**Pros:** The eventual end-state. **Cons:** The mesh runtime is one real cycle old as of 2026-05-11; we cannot put the student experience behind it for a B2B launch. **Verdict:** Build Option C now; the mesh consumes the same `LearnerSignal` bus when ready. Option D becomes a drop-in replacement for `resolveNextLearnerAction`'s body in 2026-Q3 with zero contract change.

---

## 6. Consequences

**What becomes easier**

- "What should I do now?" is a one-line call. New surfaces (parent app, teacher recommend-mode, agent-mesh suggestions) get it free.
- Scan output stops dying on the page. Quiz mistakes stop being trapped in `quiz_attempts`. Foxy "saves" stop being trapped in chat threads.
- The Pedagogy v2 spec finally has a referent — every primitive in `cognitive-engine.ts` lights up because the scheduler asks for it.
- The agent mesh's `learning_eval` evaluator (currently a stub in `EVALUATOR_SCRIPTS`) becomes implementable — it diffs `LearnerSignal` rates and BKT trajectories per cycle.

**What becomes harder**

- Every new student-facing PR now carries a "publish a signal?" obligation. Add to PR template (Phase 1.5).
- Two writers for the daily queue exist for one phase: legacy study-plan generator + new scheduler. This is the transition cost. Mitigation: per-tenant flag, per-student flag, deterministic resolution order (scheduler wins if both exist).
- BottomNav grows by one slot (`/revise`). Today the "More" sheet has 11 items; adding Revise pushes it to 12. Acceptable — the existing UX already groups items in a sheet.

**What we will need to revisit**

- **Within 6 months** — the resolver's static ordering becomes a learnt policy. Until then it is heuristic with PostHog instrumentation on every branch.
- **Within 12 months** — `LearnerSignal` becomes the input contract for the agent mesh's L1 inbox. The bus moves from in-process EventEmitter to durable (Kafka or Supabase Realtime+pgmq).
- **Pricing implication** — revise + personalised compete are mastery-aware features. We should decide whether free tier sees the resolver at all, or whether free tier sees only the library-mode browse path. Out of scope for this ADR.

---

## 7. Phased Rollout (each behind its own flag, all default OFF)

| Phase | Flag | Scope | Acceptance signal |
|---|---|---|---|
| **1. Bus + Resolver skeleton** | `ff_learner_loop_v1` | New tables `learner_signals` and `scheduled_actions`. `LearnerSignal` type. `publishSignal()` writes to both bus and table. `resolveNextLearnerAction` lands with a deterministic body using current data. New endpoint `GET /api/learner/next`. **No UI changes.** | Resolver returns within 250ms p95. Five PostHog events: `learner_signal_published`, `learner_next_resolved`, plus per-action-kind counter. |
| **2. Wire signals from existing writers** | `ff_learner_loop_v1` (same) | Every existing writer to `quiz_attempts`, `image_uploads`, `foxy_turns`, `review_cards`, `chapter_progress` *also* calls `publishSignal()`. Unit test asserts parity (every write produces a signal). | Signal-write ratio = 1.0 across all five writers, sustained for 7 days. |
| **3. Dashboard hero + study-plan use Resolver** | `ff_learner_loop_dashboard_v1` | `AboveFoldHero` and the study-plan "Today" view delegate their CTA to `/api/learner/next`. Legacy paths stay live behind flag off. | 10% canary, then 100%. Quiz-start and lesson-start rates do not regress (or improve). |
| **4. `/revise` route ships** | `ff_revise_route_v1` | New page lists decayed topics with recommended modality. Adds Revise to BottomNav "More" sheet. `QuizResults` "Re-read" CTA deep-links to `/revise?topic=…`. | Decayed-topic completion rate measurable in PostHog. 1+ Revise interaction per active session p50. |
| **5. Scan output joins the queue + Compete becomes personalised** | `ff_scan_to_queue_v1`, `ff_personalised_compete_v1` | After scan extraction, button changes from "View results" to "Add 6 questions to your queue." Compete daily challenge selects chain nodes from student's weak-topic set. | Scan→quiz funnel completes within 24h for ≥40% of scans. Compete completion correlates with topic mastery delta. |

Total flight time **~6 weeks solo-developer**, identical cadence to Phase 2 of the production-truth memo. Every phase is rollback-safe (`UPDATE feature_flags SET is_enabled=false`).

---

## 8. Composition with Adjacent Work

- **White-Label Foundation (PR #558 et seq.)** — `LearnerSignal` and `ScheduledSlot` both carry `tenantId`. Tenant config exposes `learner_loop.aggressiveness` (conservative / standard / assertive) on the existing `tenant_configs` table — no migration. Schools with the AI module disabled (`tenant_modules`) skip the resolver entirely; library-mode `/learn` remains.
- **Agent Mesh α** — `eval/learning-eval/run.ts` (new evaluator, command-wrapper pattern from `eval/_lib/command-evaluator.ts`) ingests last-7-days `learner_signals` per task's affected students and verdicts on mastery trajectory regression. Registered in `EVALUATOR_SCRIPTS`. Falls back to `pass` with reason `"no signals"` for tasks that don't touch student-facing code.
- **Multi-Role Launch Plan (Teacher / Parent)** — teacher recommend-mode (`/teacher/students/[id]`) consumes the same `resolveNextLearnerAction` to surface "If they had 15 minutes right now…" Parent weekly digest (HMAC link-code) ingests `synthesis_emitted` signals.
- **Phase 2-B Read mode / Phase 3-D deep-link** — the `?from=quiz` deep-link is the first instance of a `LearnerAction.url` in the wild. Preserve it byte-for-byte; the resolver simply learns to emit the same URL.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| The legacy study-plan generator and the scheduler disagree during Phase 3 transition | Medium | Per-student deterministic resolution: scheduler-output wins; legacy plan archived (`status='superseded'`) — never deleted. Reversible via flag flip. |
| Cold-start cost for first-time users (no signals) | Low | `cold_start_diagnostic` action kind — surfaces a 5-question diagnostic, exactly the existing `/diagnostic` flow. No new UX. |
| Signal volume balloons (every Foxy turn is a signal) | Low-Medium | Bus is in-process (PR #558) — no network overhead. Table writes batched within a single Supabase transaction per session. Pricing plan: free tier capped at 100 signals/day/student. |
| Resolver becomes a hidden god-object | Medium | Branch tests required — every branch has its own unit test with synthetic state. Branch count enforced (≤ 8) by a CI rule. When a 9th branch is needed, the discussion is "should we re-rank?" not "add another `if`." |
| Locks us into 7 features forever | Low | The opposite — adding feature #8 means: publish a signal of one of the existing kinds (or add a kind), expose a route, the resolver picks it up by mastery rules. Zero scaffolding per new feature. |

---

## 10. Action Items

### Phase 1 — Bus + Resolver skeleton (weeks 1–2)

1. [ ] Migration `2026MMDDhhmmss_learner_loop_foundation.sql` — tables `learner_signals` (event log, append-only, partitioned by month) and `scheduled_actions` (rolling window of upcoming slots). RLS service-role-only writes; student-scoped reads. Seeds `ff_learner_loop_v1` OFF.
2. [ ] [src/lib/learner-loop/types.ts](../../src/lib/learner-loop/types.ts) — the four types above.
3. [ ] [src/lib/learner-loop/publishSignal.ts](../../src/lib/learner-loop/publishSignal.ts) — writes to the in-process bus (`src/lib/events/`) **and** to `learner_signals`. Idempotent on `(studentId, kind, sourceId)`.
4. [ ] [src/lib/learner-loop/resolveNextLearnerAction.ts](../../src/lib/learner-loop/resolveNextLearnerAction.ts) — the 8-branch resolver. Each branch is its own exported helper.
5. [ ] [src/app/api/learner/next/route.ts](../../src/app/api/learner/next/route.ts) — thin wrapper, 5-min cache header.
6. [ ] Unit tests — one per resolver branch, plus an integration test that exercises the full Sense→Score→Schedule→Show path with a fixture student.
7. [ ] PostHog events — `learner_signal_published`, `learner_next_resolved`, `learner_resolver_branch_chosen`.

### Phase 2 — Wire existing writers (week 3)

1. [ ] Add `publishSignal('quiz_attempted', …)` in `src/app/api/quiz/submit/route.ts` (or equivalent).
2. [ ] Add `publishSignal('review_graded', …)` in `src/lib/domains/profile.ts` review-grade path.
3. [ ] Add `publishSignal('lesson_completed', …)` in chapter-progress writers.
4. [ ] Add `publishSignal('scan_extracted', …)` in the scan-OCR success branch.
5. [ ] Add `publishSignal('foxy_turn', …)` in the Foxy route post-response.
6. [ ] Lint rule: any new file under `src/app/api/**/route.ts` that imports `supabase` and calls `.insert(` to one of the five tracked tables must also import `publishSignal`. Custom ESLint rule, fails CI.

### Phase 3 — Resolver lights up the dashboard (week 4)

1. [ ] `AboveFoldHero` "Continue learning" card delegates to `/api/learner/next` when `ff_learner_loop_dashboard_v1` is on.
2. [ ] Study-plan "Today" view becomes a projection of `scheduled_actions` for `horizon='daily'`.
3. [ ] 10% canary, monitor `learner_next_resolved` and `learner_signal_published` in PostHog for 7 days, then 100%.

### Phase 4 — `/revise` ships (week 5)

1. [ ] [src/app/revise/page.tsx](../../src/app/revise/page.tsx) — new route. Lists `LearnerAction.kind === 'revise_decayed_topic'` from `scheduled_actions`. Card per topic with recommended modality button.
2. [ ] BottomNav: add Revise to `MORE_ITEMS` and to `SIDEBAR_SECTIONS` under "Review".
3. [ ] `QuizResults` Re-read CTA → `/revise?topic=…` instead of direct `/learn/[s]/[c]?mode=read`.
4. [ ] Three flashcards-to-revision regression tests against the fixture student.

### Phase 5 — Scan and Compete personalise (week 6)

1. [ ] Scan results page: success CTA = "Add N questions to your queue" → POST `/api/learner/queue-from-scan?uploadId=…`.
2. [ ] Concept Chain daily challenge: node selection draws from `weakTopicsForStudent(studentId)` instead of `daily_challenges` grade-wide table.
3. [ ] Leaderboard: rank by topic-mastery percentile (default tab) with raw-XP as secondary tab.

### Cross-cutting

1. [ ] [docs/learner-loop/CONTRIBUTING.md](../../docs/learner-loop/CONTRIBUTING.md) — "How to add a feature without making it useless." One page. The rule is: *publish a signal, expose a route, the resolver decides surfacing.*
2. [ ] PR template addendum: "Does this change emit a `LearnerSignal`? If a new write, why not?"
3. [ ] PostHog dashboard `Learner Loop Health` — `signal_publish_rate`, `resolver_branch_distribution`, `next_action_completion_rate`, `cross-feature handoff success` (scan→quiz, quiz→revise, revise→review).

---

## 11. Open Questions (do not block Phase 1)

1. **Compete fairness** — if Concept Chain nodes are drawn from each student's weak set, two students see different challenges. Leaderboard comparability needs a per-topic normalisation. Specifying that algorithm is Phase 5 work, not Phase 1.
2. **Hindi parity for `revise_decayed_topic`** — recommended modality "read" presumes Hindi `rag_content_chunks` coverage. As of 2026-05-06 that is ~5% of English. Phase 4 ships English-first with a banner on Hindi fallback (same pattern as `fellBackFromHindi`).
3. **Teacher override** — does the teacher's "recommend this for Class 9-A tonight" inject a `manual_pin` slot, or does it raise the rank of an existing scheduler-emitted slot? The `source` enum on `ScheduledSlot` already supports both; UX call deferred to Phase 4.5.
4. **Pricing tier coupling** — free tier may see only the library-mode `/learn` path with no resolver. Decision deferred to first-paying-school launch readouts.

---

## 12. Sign-off

This ADR is **proposed**. Phase 1 work does not begin until the CEO accepts the framing — specifically that **The Learner Loop replaces seven competing answers to "what should I do now?" with one**.

If accepted, the squash-merge sequence will be one PR per phase, each landing the migration + types + tests + flag seed in a single commit, mirroring the cadence of #549–#557.

If rejected or modified, the dependency tree is: Phases 2–5 cannot ship without Phase 1; Phase 4 cannot ship without Phase 3 in some form (the resolver must exist before `/revise` has anything to surface). Phase 5 sub-items are independent and can be reordered.

— Architect, 2026-05-12

---

## Addendum (2026-05-12) — Phase 1 implementation pivot

Between when this ADR was drafted and the moment Phase 1 began, the repo had moved further than the project memory reflected. The substrate Phase 1 was going to build *already existed*:

| Originally proposed | Already in repo |
|---|---|
| `learner_signals` table | `public.state_events` (migration `20260516180000` + `20260521100000` rename) |
| `LearnerSignal` discriminated union | `DomainEvent` discriminated union in [src/lib/state/events/registry.ts](../../src/lib/state/events/registry.ts) — already has 5 learner.* kinds, ai.foxy_session_*, parent.*, etc. |
| `publishSignal()` | `publishEvent()` in [src/lib/state/events/publish.ts](../../src/lib/state/events/publish.ts) — Zod-validated, flag-gated by `ff_event_bus_v1`, idempotent on `idempotency_key` |
| Per-learner mastery projection | `learner_mastery` table (migration `20260517100000`) + `buildStudentState()` + `weakestChapter()` helper |
| `scheduled_actions` projection table | **Deferred to Phase 3** — the resolver works without it; the table joins when Study Plan is rewired |

**Phase 1 collapsed from ~10 files to 4 application files + 1 migration + 1 test file**:

1. **`src/lib/state/events/registry.ts`** — added two event kinds: `learner.review_graded` (SM-2 grade with quality 0/3/4/5 + source) and `learner.scan_extracted` (uploadId + OCR-detected subject/chapter + question count). Both join `ALL_EVENT_KINDS`.
2. **`src/lib/state/learner-loop/types.ts`** — the `LearnerAction` discriminated union (7 kinds), the `ResolveNextResponse` envelope, the `LEARNER_LOOP_CONFIG` tuning constants (cold-start threshold, review-stacking threshold, retention windows, ZPD bins).
3. **`src/lib/state/learner-loop/resolve-next-action.ts`** — `resolveNextLearnerAction(state, augmentation, options?)` (pure, 8-branch ordering) plus `buildLoopAugmentation(sb, authUserId, studentId)` (3 parallel DB reads). Branch ordering is the contract.
4. **`src/app/api/learner/next/route.ts`** — auth → flag → state builder → augment → resolver → PostHog → response. 30-second private cache. 404 when flag off (mirrors `/api/rhythm/today`).
5. **`src/lib/posthog/types.ts`** — added `learner_next_resolved` + `learner_next_404` to the typed taxonomy + their payload shapes (closed-set branches, closed-set reasons, PII-free counts).
6. **`src/lib/state/journey/journey.ts`** — handled the two new event kinds in the journey projector so the parent/teacher timeline surfaces flashcard reviews and scan extractions.
7. **`supabase/migrations/20260522100000_learner_loop_phase_1.sql`** — seeds `ff_learner_loop_v1` flag (no new tables).
8. **`src/__tests__/state/learner-loop/resolve-next-action.test.ts`** — 24 unit tests: one per branch, three priority pins (reviews beat decay, decay beats ZPD, Sunday dive does NOT override stacking reviews), helper tests for `decayedChapters` + date helpers, registry pins for the two new event kinds.

**What is NOT in Phase 1 (deferred per the ADR's own phasing)**:

- No writers publish the new event kinds yet — that's Phase 2 (wire `/review`, `/scan`, lesson completion, foxy turn).
- No UI consumes the resolver — that's Phase 3 (dashboard hero + study plan delegate).
- No `/revise` route — that's Phase 4.
- No `scheduled_actions` projection table — Phase 3 adds it when Study Plan becomes a projection.

**Verification (2026-05-12 against HEAD `5da2d6d9` of main)**: 24/24 new unit tests pass. Full state suite 101/101 pass. Full project 7076/7158 (the 2 failed are pre-existing on main: `teacher-shell.test.tsx` references `dashboard-sidebar-desktop` UI that the Atlas redesign #724 changed; `reorder-baseline.test.ts` is empty and the rolldown parser errors on it — both untouched on this branch). Type-check clean (the 4 remaining errors are in `scripts/smoke-test-state-bus.ts`, an untracked WIP file). Lint clean on the Phase 1 surface area.

