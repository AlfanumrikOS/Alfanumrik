# Study Section Consolidation — Library + Refresh + Exam Sprint

| Field | Value |
|---|---|
| **Status** | Draft — pending user spec review |
| **Date** | 2026-05-20 |
| **Author** | Pradeep Sharma (with Claude) |
| **Approach** | C (CEO-approved 2026-05-20) — collapse 4 pages → 3, rename menu group |
| **Replaces** | The "Review" sidebar group as it ships today (4 confusingly similar destinations) |
| **Touches invariants** | P7 (bilingual UI — extends), P10 (bundle budget — net negative, deleting a page) |
| **Build size estimate** | ~5 working days for one full-stack engineer (1 day spec, 2 days `/refresh`, 1 day `/exam-prep`, 1 day migrations + telemetry) |

## 1. Why this spec exists

Today the student sidebar has a section titled **"REVIEW"** with four entries: Subjects & Chapters, Study Plan, Flashcard Review, and Revise. The CEO opened the menu on 2026-05-20, clicked through all four, and reported them as "useless and not benefitting students either ways."

Auditing the routes confirms a structural problem, not a per-page polish problem:

1. **The label "Review" is librarian-speak.** A grade 6-12 student does not think *"let me visit my Review section."* They think *"what should I do right now?"*
2. **/review and /revise are synonyms in English.** Two destinations with near-identical names = cognitive load for zero pedagogical gain.
3. **Hick's Law violation** — four overlapping mental models cause decision paralysis. The audited screenshot shows a student opening the menu, seeing four similar names, and closing it.
4. **The dashboard already does most of this work.** `DailyRhythmQueue`, `TodaysFocusSection`, `ReviewsDueCard`, and `ComebackHook` are the canonical "what's next" surfaces. The four Review pages fight the dashboard rather than complement it.
5. **The Pedagogy v2 daily rhythm** ([docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md](2026-05-08-pedagogy-v2-three-speed-rhythm-design.md)) is now the source of truth for "today's plan." `/study-plan`'s 5/7-day generator is leftover ceremony from before the rhythm orchestrator shipped.

**The fix is not to delete review functionality** — SM-2 spaced repetition, decayed-chapter resurfacing, and retention testing are pedagogically sound and we want to keep them. The fix is to **present them as one coherent flow** under an honest menu label, with a missing affordance (student-created cards) added so the empty-state problem disappears.

## 2. Goals

- **One mental address per intent.** Library = "I want to read a chapter." Refresh = "I want to keep what I've learned fresh." Exam Sprint = "An exam is coming, ramp me up."
- **Eliminate the /review vs /revise ambiguity.** Both routes redirect to a single `/refresh` page.
- **Solve the empty-state problem on the SRS deck.** Today flashcards only auto-generate from quiz mistakes and Foxy saves — a new student lands on "No reviews due" for weeks. Adding a "Mark this concept to remember" affordance makes Refresh useful from day 1.
- **Stop fighting the dashboard.** Multi-day study plan ceremony moves off /study-plan; what survives moves into context-aware /exam-prep that only appears when an exam is genuinely close.
- **No engine code is rewritten.** SM-2, the revise-stack resolver, retention tests, and the study plan generator RPC all stay. This is a *presentation* change, not an algorithm change.

## 3. Non-goals

- Not rewriting `/api/learner/review/grade`, `/api/learner/revise-stack`, `generateStudyPlan` RPC, or `cognitive-engine.ts` SM-2 logic. All preserved.
- Not changing the dashboard's Daily Rhythm queue, Reviews Due card, or Today's Focus accordion. Those are the canonical "today" surfaces and stay.
- Not changing XP, anti-cheat, or any of P1-P14.
- Not building new SRS algorithms. Reusing SM-2 with quality=2 seeding for student-created cards.
- Not changing `/learn/[subject]/[chapter]` (chapter reader). That's a separate spec.
- Not changing the Pedagogy v2 daily rhythm — this spec sits *next to* it, not on top.
- Not building backend persistence for "manual card creation" — using existing `review_cards` table with a new `source` value.

## 4. Principles

1. **The student's mental model dictates the menu, not the engineering taxonomy.** "Refresh what I've learned" is one thought, even if internally it dispatches to SM-2 cards + chapter decay + retention tests.
2. **Agency over algorithm.** Letting a student mark *one* concept to remember is more engaging than ten machine-picked cards. The algorithm still does the spacing; the student picks the seed.
3. **Context-aware visibility.** Menu items hide when irrelevant. Exam Sprint disappears when no exam is upcoming. This trades a tiny implementation cost for a large cognitive-load reduction.
4. **Hard redirect, not soft deprecation.** Old routes (`/review`, `/revise`, `/study-plan`) return 301 to their new homes. No "legacy" link rot. No two routes serving the same screen.
5. **One feature flag, one rollout window.** `ff_study_menu_v2` controls the whole change. Old menu remains as fallback for one week. No partial states.

## 5. Architecture — Today vs After

### 5.1 Today

```
SIDEBAR "REVIEW" GROUP
├── 📚 Subjects & Chapters    → /learn        — chapter browser (works, misfiled)
├── 📅 Study Plan              → /study-plan   — 3-question wizard → multi-day plan (stale by day 3)
├── 🔄 Flashcard Review        → /review       — SM-2 deck (empty state dominates)
└── 🔁 Revise                  → /revise       — decayed-chapter stack (gated by ff_revise_route_v1)

Routes also reachable from:
- BottomNav "More" sheet (same 4 entries)
- Dashboard's QuickActions section
- Quiz result page's "Chapters to Review" + "Re-read this chapter" CTAs
- Foxy "doubt" mode's chapter-deep-links
- daily-cron's nudge generator
```

### 5.2 After

```
SIDEBAR "STUDY" GROUP  (renamed from "REVIEW")
├── 📚 Library                → /learn        — unchanged route, renamed in menu
├── 🔁 Refresh                → /refresh      — NEW PAGE merging old /review + /revise + retention tests
└── 🎯 Exam Sprint            → /exam-prep    — RENAMED + RESCOPED /study-plan, hidden when no exam is close

Redirects (301, permanent):
- /review        → /refresh?tab=flashcards
- /revise        → /refresh?tab=chapters
- /study-plan    → /exam-prep
- /learn         → /learn  (no change, just menu-label change)

Feature flag: ff_study_menu_v2 (default OFF → enable for 100% after staging soak)
Fallback: When flag OFF, old menu structure renders unchanged. Old routes still work.
```

## 6. The `/refresh` page — design detail

The single most important page in this spec. Four stacked sections, top-to-bottom, each auto-hides when empty. Students open it once a day. Estimated session length: 3-7 minutes.

### Section A — Quick Recall (always rendered)
- **What:** 5 flashcards due via SM-2, served via existing `getReviewCards(studentId, 20)` then sliced to 5.
- **UI:** Identical card-flip + 4-quality-button UI that lives on `/review` today.
- **Backend:** Unchanged. `POST /api/learner/review/grade` still publishes `learner.review_graded` event.
- **Empty:** If zero cards due, this section collapses to a one-line nudge: *"No cards due — try Build Your Own Deck below to seed your first 10."*
- **Telemetry:** Existing event `learner.review_graded` already captures this. No new event.

### Section B — Chapter Refresh
- **What:** Decayed-chapter stack from `/api/learner/revise-stack` — chapters where mastery ≥ 0.6 and last-touched > retention window.
- **UI:** Existing `/revise` cards (chapter title + days since touch + recommended modality + colored CTA).
- **Backend:** Unchanged. The route stays at `/api/learner/revise-stack`.
- **Empty:** Section hides entirely. (Today /revise shows a celebratory empty state taking the full screen — that's wasteful real estate.)
- **Deep-link from quiz:** The `?from=quiz&subject=...&chapter=...` deep link that today lands on `/revise` now lands on `/refresh?tab=chapters&from=quiz&...`. The "Re-read this chapter" card renders at the top of Section B.

### Section C — Retention Tests
- **What:** Pending retention quizzes from `retention_tests` table where `scheduled_date <= today` and `status = 'pending'`.
- **UI:** Same list + CTA as today's `/review` page sidebar — *"3 retention tests due, take one (3 questions, ~90s)."*
- **Backend:** Unchanged. Query: `select id, topic_title, subject, predicted_retention, scheduled_date from retention_tests where student_id = ? and status = 'pending' and scheduled_date <= today() limit 5`.
- **Empty:** Section hides entirely.

### Section D — Build Your Own Deck *(NEW affordance)*
- **What:** A small composer at the bottom of /refresh that lets a student type or select a concept and add it to their SM-2 deck.
- **UI:** Two inputs (subject dropdown limited to the student's allowed subjects, then a text input *"What do you want to remember?"*) + an optional second input *"Hint or answer"*. One CTA: *"Add to my deck."*
- **Why it exists:** The audit found that today every flashcard is machine-generated (quiz wrong answer, Foxy save, study plan task). New students have an empty SM-2 deck for weeks. This affordance breaks the cold start.
- **Behavior on submit:**
  - Insert into `review_cards` with `source = 'student_created'`, `ease_factor = 2.5` (SM-2 default), `interval_days = 1`, `repetition_count = 0`, `created_by_student = true`.
  - Toast: *"Added — you'll see it tomorrow in Quick Recall."*
  - Refresh Section A's count silently.
- **Backend:** New `POST /api/learner/cards/create` route. Body: `{ subjectCode: string, frontText: string, backText: string, hint?: string }`. Validations: text ≤ 200 chars, subject must be in `useAllowedSubjects`, rate limit 20 cards/day per student (prevents abuse of SM-2 cap heuristics).
- **Telemetry:** New event `learner.card_created` with `{ studentId, subjectCode, source: 'student_created' }`. Counted in success metrics.
- **Empty:** Always rendered. Default state shows a small "Tip: tap to add a concept you want to remember."

### `/refresh` route file structure
- Single page component at `src/app/refresh/page.tsx`.
- Sections A-D in a stacked vertical layout, no tabs by default. The `?tab=flashcards|chapters` param scrolls to that section on mount (smooth-scroll, not a SPA tab switch — keeps the page coherent).
- Reuses existing components: SM-2 card UI from current `/review`, chapter stack card from current `/revise`, retention list card from current `/review`. Build-deck composer is new.
- Bundle target: < 220 kB page weight (P10). Today's `/review` is ~190 kB; `/revise` is ~140 kB. Merging should land under the budget because components are reused.

## 7. The `/exam-prep` page — context-aware, opt-in

### 7.1 Behavior

- **When at least one row in `upcoming_exams` has `exam_date - today() ≤ 30 days`:**
  - Page opens with that exam pre-selected. `days_until_exam` becomes the default plan duration. Mode header: *"Exam Sprint — Chemistry, 18 days left."*
  - The student sees the existing generated plan if one exists, else a one-tap *"Generate my 18-day sprint"* button.
  - No 3-question wizard — subject, time, days are all inferred. Student can override via a small *"Adjust settings"* link.

- **When no exam is within 30 days:**
  - Page renders a quiet CTA: *"Add your next exam date"* (deep-links to `/parent/calendar` or to a new lightweight "Add Exam" modal — TBD as a follow-up). Below it: *"Or generate a generic 7-day plan"* link that opens the legacy 3-question wizard.

- **Menu visibility:** The "Exam Sprint" sidebar item **hides** when (a) no upcoming exam is within 30 days AND (b) no active plan exists. This is the single largest cognitive-load win from this spec — most students don't have an exam every week, so this item is silent most of the time.

### 7.2 What gets deleted from today's /study-plan

- 3-question wizard (subject / 30-45-60-90 / 5-7 days) — replaced by inferred defaults when an exam is upcoming.
- Energy reading card (`cognitive_session_metrics.fatigue_detected`) — moves to dashboard's Today's Focus accordion where it semantically belongs.
- "Foxy Suggests" critical-gaps card (`knowledge_gaps` query) — moves to dashboard's Progress accordion.

### 7.3 What gets kept

- `getStudyPlan` / `generateStudyPlan` RPCs — unchanged.
- The `study_plans` and `study_plan_tasks` tables and their RLS policies — unchanged.
- The day-by-day task expand/collapse UI — unchanged.
- The Bloom and ZPD badges per task — unchanged.
- The valid-transitions state machine (`pending → in_progress → completed`) — unchanged.

## 8. Migration plan

### 8.1 Routes

| Old | New | Mechanism |
|---|---|---|
| `/review` | `/refresh?tab=flashcards` | 301 in `next.config.js` redirects |
| `/revise` | `/refresh?tab=chapters` | 301 in `next.config.js` redirects |
| `/study-plan` | `/exam-prep` | 301 in `next.config.js` redirects |
| `/learn` | `/learn` (unchanged URL, renamed in menu) | None |

Source files:
- `src/app/refresh/page.tsx` — NEW
- `src/app/exam-prep/page.tsx` — NEW (effectively a rename + scope-narrowing of `/study-plan/page.tsx`)
- `src/app/review/page.tsx` — DELETED after redirect period (one week)
- `src/app/revise/page.tsx` — DELETED after redirect period
- `src/app/study-plan/page.tsx` — DELETED after redirect period

### 8.2 Internal link updates

Files that reference the old routes (verified via grep before implementation):

- `src/components/ui/BottomNavComponent.tsx` — `SIDEBAR_SECTIONS.Review` becomes `Study`, 4 items → 3.
- `src/components/dashboard/sections/QuickActionsSection.tsx` — any link to `/review`, `/revise`, `/study-plan`.
- `src/components/quiz/QuizResults.tsx` — the "Re-read this chapter" CTA links to `/revise?from=quiz` today; update to `/refresh?tab=chapters&from=quiz&...`.
- `src/components/dashboard/ReviewsDueCard.tsx` — links to `/review` today; update to `/refresh#flashcards`.
- `src/app/study-plan/page.tsx` line 583 — the embedded `router.push('/review')` button for review tasks — update to `/refresh`.
- Anywhere `daily-cron` Edge Function generates nudges with deep-links — verify in `supabase/functions/daily-cron/index.ts`.

A pre-implementation grep is part of the implementation plan, not this spec. Do not assume the above list is exhaustive.

### 8.3 Flag rollout

```
Day 0  → ff_study_menu_v2 default OFF. New routes deployed but unreachable from menu. Old menu unchanged.
Day 1  → Enable for 5 internal QA accounts. Validate redirects + Section D + telemetry.
Day 2  → Enable for 10% rollout cohort (super_admin user-segment cohort).
Day 5  → Enable for 100% if no Sentry errors and no support tickets mentioning the menu.
Day 12 → Delete old route files. Remove ff_revise_route_v1 (subsumed).
Day 14 → Remove ff_study_menu_v2 flag, make new menu unconditional.
```

If at any point the new menu shows a regression in `learner.review_graded` event rate, the flag is flipped OFF and old routes serve. No data loss is possible — the underlying tables are unchanged.

## 9. Telemetry

### 9.1 Baseline capture (week before rollout)

- 7-day unique student visits to `/learn`, `/study-plan`, `/review`, `/revise`.
- 7-day count of `learner.review_graded` events.
- 7-day count of `review_cards` insertions by source (`quiz_wrong_answer`, `foxy_chat`, `study_plan`).
- 7-day bounce rate per page (visit + < 10s session).

### 9.2 Post-rollout metrics (4 weeks after 100% enable)

| Metric | Target | Source |
|---|---|---|
| 7-day unique visits to `/refresh` | ≥ sum of old `/review` + `/revise` baseline | super-admin analytics |
| `learner.card_created` events per active student per week | ≥ 1 | new event |
| `learner.review_graded` events per active student per week | ≥ baseline × 1.5 | existing event |
| `/exam-prep` visits per student-with-upcoming-exam in 30-day window | ≥ 2 | new event `student.exam_prep_visit` |
| Sentry errors on `/refresh` | < 0.5% of sessions | Sentry |
| Bundle weight of `/refresh` page | < 220 kB shared+page | CI bundle-size check |

Telemetry events to add:
- `learner.card_created` — student adds a card via Section D.
- `learner.refresh_section_viewed` — fired once per section, per session, per student. Distinguishes "viewed Section A" from "graded a card."
- `student.exam_prep_visit` — student opens /exam-prep when an exam is upcoming.

## 10. Bilingual strings

Per P7 every new string is bilingual. The full table will live in the implementation plan, but the labels we know we need today:

| English | Hindi |
|---|---|
| Study (menu group) | पढ़ाई |
| Library | अध्ययन सामग्री |
| Refresh | ताज़ा करो |
| Exam Sprint | परीक्षा की तैयारी |
| Quick Recall | झटपट याद |
| Chapter Refresh | अध्याय दोहराओ |
| Retention Tests | याददाश्त परीक्षा |
| Build Your Own Deck | अपना डेक बनाओ |
| What do you want to remember? | क्या याद रखना है? |
| Hint or answer | संकेत या उत्तर |
| Add to my deck | मेरे डेक में जोड़ो |
| Added — you'll see it tomorrow in Quick Recall | जोड़ दिया — कल झटपट याद में दिखेगा |
| Tip: tap to add a concept you want to remember | टिप: जो याद रखना है उसे जोड़ो |

## 11. Data flow

```
┌──────────────────────────────────────────────────────────────────┐
│  /refresh page (single SWR fetch on mount)                       │
└──────────────────────────────────────────────────────────────────┘
        │
        ├── Section A: getReviewCards(studentId, 20).slice(0, 5)
        │              → existing /api/learner/review/grade for grading
        │              → existing event learner.review_graded
        │
        ├── Section B: GET /api/learner/revise-stack
        │              → existing route, no change
        │
        ├── Section C: supabase.from('retention_tests')
        │              .select(...).eq('status','pending')
        │              .lte('scheduled_date', today).limit(5)
        │              → CTA → /quiz?mode=cognitive (unchanged)
        │
        └── Section D: POST /api/learner/cards/create  *(NEW)*
                       → inserts into review_cards with source='student_created'
                       → event learner.card_created
                       → toast + silent re-fetch of Section A count
```

```
┌──────────────────────────────────────────────────────────────────┐
│  /exam-prep page                                                  │
└──────────────────────────────────────────────────────────────────┘
        │
        ├── On mount: query upcoming_exams where exam_date - today ≤ 30
        │
        ├── If exam found:
        │   Pre-fill subject + days. Show "Generate sprint" or existing plan.
        │   → existing generateStudyPlan RPC
        │   → existing study_plans + study_plan_tasks tables
        │
        └── If no exam: small "Add exam date" CTA + legacy wizard link
```

## 12. Failure modes considered

- **Student visits /review via a bookmark after rollout.** 301 redirect to /refresh preserves the bookmark. Tab param ensures they land on the section they remember.
- **Section D abuse — student spams 1000 cards to inflate XP.** Rate limit 20 cards/day per student. Hard cap 500 cards per student total (existing SM-2 caps). No XP awarded for card creation — XP only for grading.
- **Empty state on day 1 for a brand-new student.** Sections A, B, C all hide. Section D becomes the prominent CTA — *"Add your first concept to remember"*. Page is useful from minute 1, not week 4.
- **Quiz "Re-read this chapter" deep-link points to /revise in production code.** Implementation plan must grep and update *every* call site. Pre-rollout, both `/revise` and `/refresh?tab=chapters` work (the 301 catches stragglers).
- **Feature flag OFF for some users, ON for others, same session.** Not possible — flag is read once per session via `getFeatureFlags()` and cached.
- **Bundle-size check fails on /refresh.** Section components are already shipping today on /review and /revise; merging cannot exceed the sum. If it does, lazy-load Sections B+C+D via `next/dynamic`.
- **Exam Sprint hides when student forgets to add their exam date.** Mitigation: when a parent adds the exam in /parent/calendar, daily-cron sends the student a nudge linking to /exam-prep. Out of scope for this spec but flagged for the follow-up plan.

## 13. Open questions for user review

These need a yes/no from the CEO before the implementation plan is written:

1. **"Library" Hindi label — पुस्तकालय vs अध्ययन सामग्री?** Recommendation: अध्ययन सामग्री (more natural for a young student).
2. **Section D character limits — 200 / 200 / 100 (front / back / hint)?** Recommendation: yes.
3. **Should "Build Your Own Deck" award any XP?** Recommendation: NO. P2 says XP rewards mastery, not motion. A created card earns XP only when it's reviewed correctly later.
4. **Tabbed vs scroll-stacked /refresh layout on mobile?** Recommendation: scroll-stacked. Tabs only when ?tab= deep-link is present (smooth scroll then).
5. **Should /exam-prep auto-redirect to /refresh when no exam is within 30 days?** Recommendation: NO — show its own quiet "Add exam" CTA. Auto-redirect hides the entry point and confuses bookmark users.

## 14. Implementation plan reference

After this spec is approved, the next step is to invoke the writing-plans skill to produce `docs/superpowers/plans/2026-05-20-study-section-consolidation-plan.md` covering:

- Phase 1: Build `/refresh` page (Sections A-C) behind `ff_study_menu_v2`. Old routes still serve. No deletions yet.
- Phase 2: Add Section D + `POST /api/learner/cards/create` + telemetry events.
- Phase 3: Build `/exam-prep` page. Migrate /study-plan internal references.
- Phase 4: Sweep internal link references (quiz results, dashboard cards, nudges).
- Phase 5: Add 301 redirects in `next.config.js`. Flip flag to 100%.
- Phase 6: Delete `/review`, `/revise`, `/study-plan` route files. Remove `ff_revise_route_v1` flag. Remove `ff_study_menu_v2` flag.

Each phase ends with: type-check + lint + tests + bundle-size check + a manual smoke pass through the menu + the dashboard + the quiz wrong-answer deep-link.

## 15. Review chain

This change touches:
- **Frontend** (owner — page restructure, components, i18n, mobile-nav sweep)
- **Backend** (one new API route + new telemetry events + redirects in next.config.js)
- **Assessment** (review — Section D card creation must not drift the SM-2 invariants in `src/lib/xp-rules.ts` or `src/lib/cognitive-engine.ts`)
- **Testing** (E2E for /refresh sections + redirects + Section D submission; regression entry for the menu-rename)
- **Quality** (final review)
- **Mobile** (downstream review — `mobile/lib/services/api.dart` may reference these routes; if so, the Flutter app needs the same redirect handling)
- **Ops** (telemetry verification on super-admin analytics page)

Per P14, mandatory reviewers: testing (E2E), assessment (no drift in SM-2), quality, mobile (route-sync check).

## 16. What success looks like

Four weeks after 100% rollout:

1. CEO opens the sidebar and the Study section reads "Library / Refresh / Exam Sprint" with Exam Sprint hidden because no exam is close. The menu is shorter and the labels match what the student needs.
2. A 13-year-old in grade 8 opens /refresh, sees 3 cards in Quick Recall, grades them in 90 seconds, adds one new concept via Build Your Own Deck, and closes the app. Total session: 2 minutes. They come back tomorrow because Quick Recall has new cards (including the one they made yesterday).
3. The `learner.card_created` event rate is non-zero. Students are actively curating what they remember.
4. The Sentry error rate on /refresh is below 0.5% of sessions.
5. /exam-prep visits cluster in the 30 days before each Mock Test, PYQ paper, or CBSE board date — *and are zero otherwise.* The menu item silently goes away when not needed.

## 17. Revision history

- 2026-05-20 — Initial draft. Approach C approved verbally by CEO.
