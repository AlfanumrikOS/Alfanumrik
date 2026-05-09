# Alfanumrik Pedagogy v2 — Three-Speed Learning Rhythm

| Field | Value |
|---|---|
| **Status** | Draft (awaiting user review) |
| **Date** | 2026-05-08 |
| **Author** | Pradeep Sharma (with Claude) |
| **Replaces** | Nothing — this is a unification layer over existing engines, not a replacement |
| **Touches invariants** | P2 (XP economy — no changes), P11 (question quality — strengthens), P6 (bilingual — extends) |
| **Build size** | ~8 solo-developer weeks for the three core waves; +1 week for the Wave 2 depth-pack corpus extension. ~9 weeks total. |

## 1. Why this spec exists

Alfanumrik already encodes 15 cognitive-science primitives (SM-2 spaced repetition, Bloom's taxonomy, ZPD, IRT 3PL, Bayesian Knowledge Tracing, error classification, Ebbinghaus retention, RL question selection, metacognitive prompts — all in [src/lib/cognitive-engine.ts](../../../src/lib/cognitive-engine.ts)). The XP economy was rebuilt on 2026-04-08 to reward mastery, not presence. Foxy has 5 modes including a Socratic-only homework path. Goal personas, mastery thresholds, and oracle question-quality checks all exist.

**The problem is not missing primitives. The problem is that the primitives don't compose into a coherent student rhythm.**

Today, a student opens Alfanumrik to a dashboard with peer-level surfaces — quiz, foxy, learn, exams, study-plan, simulations, mock-exam, leaderboard, progress, scan, lab-notebook, hpc, pyq, challenge, diagnostic. There is no canonical *rhythm* — no obvious answer to "what should I do today" that scales from a 15-minute session to a 60-minute deep dive to a monthly milestone.

This spec defines a **single nested rhythm** every student lives by, with **content** that adapts to the four audience personas (board survivor, curious learner, struggling student, aspirational learner) Alfanumrik already serves. The rhythm itself does not branch by persona; the *content selection inside* each rhythm slot does.

## 2. Goals

- **Coherence (A)**: Every existing surface maps to one of three rhythm slots. Students always know "what's next."
- **Engagement (B)**: Engagement comes from **rhythm**, not gamification gimmicks. Three nested time-scales mean a missed day doesn't reset everything; a busy week still has a monthly anchor.
- **Self-directed depth (C)**: "Delve as deep as you want" lives natively in the **weekly** layer — a first-class slot every learner uses every week, not a hidden side branch.
- **India fit (D)**: Bilingual at the depth level (not just translation toggle), bandwidth-aware, parent-shareable monthly artifacts via WhatsApp, board-exam scaffold woven into the daily layer, no streak-shame or class leaderboards by default.

## 3. Non-goals

- Not replacing `cognitive-engine.ts`, `exam-engine.ts`, `xp-config.ts`, IRT/BKT, or any existing primitive. This spec composes them.
- Not building live tutoring, human-tutor marketplaces, or video production.
- Not building synchronous cohort/group features. Async artifact sharing only.
- Not changing the XP economy values. Mastery-only XP is correct and stays.
- Not voice-only or mobile-only features. Web-first; mobile parity is a separate spec.
- Not B2B/school-admin features. Covered by [2026-04-16-b2b-white-label-production-design.md](2026-04-16-b2b-white-label-production-design.md) and Phase 2-C.

## 4. Principles

These are strong claims; the design rests on them.

1. **Productive failure before instruction.** Indian coaching pre-loads formulas; we invert. The default daily ZPD problem appears *before* its tutorial. Manu Kapur's research (which is on Indian/Singaporean students) shows ~30% better transfer when learners struggle with a problem first, then receive instruction.

2. **One rhythm, persona-adaptive content.** Four audiences ride the same daily/weekly/monthly loop. The board survivor's daily ZPD problem is a board-pattern variant; the curious learner's is intuition-led; the struggler's is a prerequisite-chain repair preceded by a worked example; the aspirational learner's is JEE/olympiad-tagged. The *shell* never differs.

3. **XP rewards mastery, not motion.** No regression of the 2026-04-08 redesign. No XP for presence, login, or chat volume. New rewards (artifact, synthesis) trigger only on mastery-grounded events.

4. **Depth is structural, not optional.** The weekly dive is not an opt-in "advanced" mode — it is the second of three rhythm slots, ships to every persona, and is the engine of curiosity-driven learning.

5. **Parent visibility is part of the loop.** The monthly synthesis exists primarily for the student; secondarily as a parent-shareable artifact. This is non-negotiable in the Indian market — parents pay, parents need to see learning happen.

6. **No streak shame, no class leaderboards by default.** Streaks are personal milestones (7/30/100 from existing XP rules). Class leaderboards are opt-in cohort, never automatic. The product never weaponizes peer comparison.

7. **Bilingual is a depth knob, not a toggle.** Hindi/Hinglish is the *primary* explanation language for grades 6-8 first-pass content; English-primary with Hindi support for 9-12. Examples are set in Indian contexts (cricket, IRCTC, monsoons, kirana stores) — already feasible via Foxy's existing persona/prompt system.

8. **Bandwidth-aware by default.** Assume a 4G shared phone. Text + lightweight SVG widgets are the default; video and heavy animation are opt-in or Wi-Fi-detected.

## 5. Architecture — Three-Speed Learning Rhythm

```
┌─────────────────────────────────────────────────────────────────┐
│  DAILY (15 min) — Mastery Spine                                 │
│  ─────────────────────────────────                              │
│  • 5 SRS reviews (existing SM-2 in cognitive-engine.ts)         │
│  • 1 ZPD problem (productive-failure flipped: attempt → reveal) │
│  • 1 active-recall reflection (1-line teach-back)               │
│                                                                 │
│  Persona-adaptive: which 5 reviews? what kind of ZPD problem?   │
│  XP: existing mastery rules. No new reward shape.               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  WEEKLY (60 min) — Curiosity Dive                               │
│  ────────────────────────────────                               │
│  • Pick: phenomenon (suggested) | weak-topic dive | own topic   │
│  • Foxy "explorer" mode — Socratic, RAG-grounded, scaffolded    │
│  • Output: 1 artifact (notebook entry, diagram, mini-essay,     │
│    problem writeup) saved to lab-notebook                       │
│                                                                 │
│  Persona-adaptive: starter prompts and depth ceiling.           │
│  Engagement: completing a weekly artifact = visible streak      │
│  token (1/week, persists across days).                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  MONTHLY — Synthesis Milestone                                  │
│  ──────────────────────────────                                 │
│  • Auto-aggregated: chapter mock + retention check + HPC update │
│  • Compiled: 4 weekly artifacts + monthly mastery delta         │
│  • Parent-share: one-page summary (Hindi/English) via WhatsApp  │
│  • Renews: new monthly phenomenon theme                         │
│                                                                 │
│  This is the "graduation moment" — small ritual, parent-visible.│
└─────────────────────────────────────────────────────────────────┘
```

### 5.1 Daily layer (Mastery Spine, ~15 min)

**Composition** (orchestrator generates this on session open):
- **5 SRS reviews** sourced from due-cards across all subjects the student is active in. SM-2 is already implemented; the new orchestrator just queries due cards and interleaves across subjects (existing `cognitive-engine.ts` interleaving algorithm).
- **1 ZPD problem** at the student's calibrated difficulty band (existing IRT 3PL ability estimation). The problem is presented *before* any tutorial — productive failure. After attempt (correct or not), the relevant tutorial slice is revealed inline within the daily-rhythm container. The same productive-failure pattern also rewires `/learn/[subject]/[chapter]` direct visits (problem first, tutorial after attempt) — both surfaces share the rule, gated by `ff_productive_failure_v1`.
- **1 active-recall reflection** prompt: "In one line, what did you learn just now?" The student's answer is graded by Foxy as a *retrieval signal*, not for XP — but the reflection itself updates the student's BKT mastery state.

**Persona-adaptive content rules** (orchestrator branches on `goal_profile.code` from existing `goal-personas.ts`):

| Persona | SRS source | ZPD problem flavor | Tutorial reveal |
|---|---|---|---|
| Board survivor | board-tagged questions weighted higher | Board-pattern variant from PYQ corpus | NCERT-aligned, exam-pattern explanation |
| Curious learner | cross-subject mix preferred | Intuition-led (Brilliant style — visual, build-the-feel) | Concept-first, formal proof second |
| Struggling | prerequisite-chain repair only | Worked example *first*, then variant — inverts productive failure where confidence is fragile | Plain-language Hindi-primary |
| Aspirational | enrichment-tagged + ahead-of-grade | JEE/NEET/olympiad-tagged variant | Rigorous, formal-style |

**XP**: existing rules from [src/lib/xp-config.ts](../../../src/lib/xp-config.ts). No new constants. No XP for the reflection step (it's a retrieval signal, not an achievement).

**Surface**: replaces the current dashboard top-of-feed. The existing `/dashboard` becomes the daily-rhythm host; today's queue renders inline.

### 5.2 Weekly layer (Curiosity Dive, ~60 min)

**Trigger**: opens once per week (default Sunday or first session of a new ISO week). Student is presented with three picker options:

1. **Suggested phenomenon** — Alfanumrik proposes a real-world phenomenon that pulls 2-3 subjects together. (Examples: monsoons → geography + physics + biology; cricket physics → mechanics + statistics; kirana store accounting → math + business studies + economics.) Sourced from a curated phenomenon table (~24 phenomena to start, one per fortnight).

2. **Weak-topic dive** — Alfanumrik picks a topic where BKT mastery is dropping or where the student got recent ZPD problems wrong. Foxy explores it in depth.

3. **Own topic** — student types or speaks a question. Foxy enters explorer mode bounded by RAG (no fabrication, P11 invariant).

**Foxy "explorer" mode** is a new mode added to the existing Foxy mode system (currently: learn / quiz / revision / doubt / homework). Explorer mode:
- Socratic-led but allows direct exposition when the student is genuinely stuck (unlike homework mode, which never gives direct answers).
- RAG-grounded; can pull from NCERT, weak-topic context, and (Wave 2) depth packs.
- Produces an **artifact draft** as the conversation progresses — a structured notebook entry the student can edit and finalize.

**Artifact** is the deliverable: a student-edited notebook page with title, key concepts, diagrams (SVG widgets where applicable), worked examples, and a "what I figured out" student-voice section. Saved to existing `/lab-notebook` route.

**Persona-adaptive content rules**:

| Persona | Default picker | Foxy explorer scaffold |
|---|---|---|
| Board survivor | weak-topic dive (board-tagged) | Anchor to exam-pattern; tie phenomenon back to NCERT clauses |
| Curious learner | suggested phenomenon | Maximum cross-subject; depth ceiling open |
| Struggling | weak-topic dive (prerequisite repair) | Confidence-first, narrow scope, plain language |
| Aspirational | own topic OR phenomenon with depth pack | Depth pack RAG enabled (Wave 2): JEE/NEET/olympiad |

**Engagement mechanic**: completing a weekly artifact awards a **weekly streak token** that persists. Unlike daily streaks, the weekly token is forgiving — missing one week does not reset; missing four consecutive weeks does. This insulates students from exam-week interruptions.

**XP**: artifact completion = `XP_RULES.study_plan_week` (40 XP, already exists). No new constant.

**Surface**: new `/dive` route. Linked from dashboard when the weekly slot is open; collapsed when not.

### 5.3 Monthly layer (Synthesis Milestone)

**Triggered**: end of calendar month or 4 weeks after subscription start (whichever cadence fits the student's profile).

**Composition** (auto-aggregated by a new monthly orchestrator):
- **Chapter mock**: an auto-generated mock exam covering chapters touched in the past month (uses existing `exam-engine.ts` + `quiz-generator-v2`).
- **Retention check**: 5-question SRS-flavored retention probe across last month's mastered topics — measures forgetting-curve drift (existing Ebbinghaus model).
- **HPC update**: existing `/hpc` Holistic Progress Card refreshes with month's mastery deltas, Bloom level distribution, and persona alignment.
- **Artifact compilation**: the 4 weekly artifacts compiled into a monthly portfolio.
- **Parent-share summary**: a one-page (~300 word) Hindi+English summary generated by Claude (Haiku), highlighting: top mastery wins, areas needing work, the month's phenomenon, links to the artifact portfolio. Delivered via the existing `whatsapp-notify` Edge Function with parent opt-in.

**Renewal**: a new monthly phenomenon theme rolls in, refreshing the weekly picker's first option.

**Engagement mechanic**: the synthesis screen presents a small ritual — a "month complete" moment — and a one-tap parent-share. No XP cost, no XP reward; this is identity, not currency.

**Surface**: extends existing `/hpc`. New `/synthesis` route renders the milestone ritual + parent-share.

## 6. Persona-adaptive content — implementation note

All persona branching reads from `goal_profile.code` (already in [src/lib/goals/goal-personas.ts](../../../src/lib/goals/goal-personas.ts)). New code does not introduce a parallel persona system. New work needed:

- Extend `goal-personas.ts` if any persona is missing for "struggling" (verify during Wave 1).
- Add a `pedagogyContentRules` resolver that takes `(persona, layer, slot)` → content selection policy. Pure function, testable, lives in `src/lib/learn/pedagogy-content-rules.ts`.

## 7. Reuse vs. new

### Reused as-is (no changes)

- `src/lib/cognitive-engine.ts` — SM-2, ZPD, BKT, IRT, Bloom, interleaving, fatigue, Ebbinghaus, RL — all called by the new orchestrators.
- `src/lib/xp-config.ts` — XP constants stay.
- `src/lib/exam-engine.ts` — drives the monthly chapter mock.
- `src/lib/goals/goal-personas.ts` — branching point.
- `supabase/functions/whatsapp-notify` — monthly parent-share delivery.
- Routes: `/foxy`, `/learn/[subject]/[chapter]`, `/lab-notebook`, `/hpc`, `/diagnostic`, `/pyq`, `/quiz`, `/exams`.

### Extended (additive, behind feature flags)

- **Foxy explorer mode** — new mode in [src/app/api/foxy/route.ts](../../../src/app/api/foxy/route.ts) and `src/lib/ai/workflows/`. Behind `ff_foxy_explorer_v1`.
- **Productive-failure flip** in `/learn/[subject]/[chapter]` — tutorial reveals after attempt. Behind `ff_productive_failure_v1`.
- **Distractor-tagging** on MCQ options — new `misconception_tag` column on quiz options; populated retroactively on top-100 chapters first. Wrong answer triggers Foxy targeted micro-explanation rather than generic feedback (Eedi pattern).

### New surfaces

- `src/app/dashboard/page.tsx` — refit to render daily-rhythm queue at top.
- `src/app/dive/page.tsx` — weekly Curiosity Dive surface.
- `src/app/synthesis/page.tsx` — monthly milestone ritual.
- `src/lib/learn/daily-rhythm-orchestrator.ts` — composes today's queue. Pure-function module; runs server-side in API routes (`/api/rhythm/today`) and is also importable client-side for optimistic preview rendering.
- `src/lib/learn/weekly-dive-orchestrator.ts` — manages weekly slot state (open/closed/completed-this-week). Server-side primary.
- `src/lib/learn/monthly-synthesis-orchestrator.ts` — aggregates monthly bundle. Server-side only (calls Claude Haiku for parent-share text).
- `src/lib/learn/pedagogy-content-rules.ts` — persona × layer × slot → content policy. Pure function, exhaustively table-tested.
- `supabase/functions/monthly-synthesis-builder` — server-side bundle generator (text generation via Claude Haiku).

### New data

- Phenomenon catalog table (~24 rows to start): `phenomena(id, title, title_hi, subjects[], grade_band, summary, suggested_questions[])`.
- Weekly artifact storage: extend `lab_notebook_entries` with `artifact_kind`, `dive_topic`, `dive_subjects`, `is_weekly_artifact` flag.
- Monthly synthesis state: `monthly_synthesis_runs(student_id, month, artifact_ids[], parent_share_status, ...)`.
- Distractor tags: `quiz_option_tags(option_id, misconception_tag, micro_explanation_id)`.

All new tables ship with RLS policies in the same migration (per CLAUDE.md rule).

## 8. Engagement model

| Mechanic | Status | Why |
|---|---|---|
| Mastery-only XP (no presence/chat XP) | Keep | 2026-04-08 invariant. No regression. |
| 7/30/100 day milestone streak bonuses | Keep | Already calibrated to mastery, not login. |
| Weekly artifact = persistent weekly token | **New** | Insulates from exam-week disruption; weekly cadence is more honest than daily for project work. |
| Monthly synthesis ritual | **New** | Identity moment; not a points moment. |
| Public class leaderboard | **Not built** | Streak shame is a known anti-pattern in Indian exam culture. |
| Opt-in cohort sharing of artifacts | Wave 3+ candidate | Async only; explicit consent; private-by-default. |
| Parent-share via WhatsApp | **New** (Wave 3) | Indian market expectation; uses existing edge function. |

## 9. Depth & curiosity model

**Wave 1 corpus**: NCERT only. Rabbit holes happen *within* NCERT (e.g., a grade-9 student exploring grade-10 chemistry early; a grade-7 student diving into a phenomenon that touches grade-9 biology). RAG (existing) bounds Foxy explorer to prevent fabrication.

**Wave 2 corpus extension**: opt-in **depth packs** loaded into RAG, gated by goal persona:
- **JEE Foundation pack** — for aspirational learners grades 8-10.
- **NTSE / Olympiad pack** — math/science olympiad past papers.
- **NEET Bio depth pack** — for grade 11-12 aspirational science.
- **Humanities depth pack** — primary sources, longer historical narratives, beyond-NCERT social science readings.

Depth packs are a corpus extension, not a new product surface. The student stays in the same Foxy explorer mode; the RAG pool is wider.

**Free-form Foxy dive** is always available, but P11 (question quality) and RAG-only (foxy v33) constraints prevent fabrication.

**Ceiling**: there is no artificial ceiling. A grade-7 student exploring orbital mechanics or a grade-12 student exploring Vedic mathematics or a grade-10 student exploring Bayesian inference is allowed. The depth knob is the student's curiosity, not a curriculum gatekeeper.

## 10. India-fit constraints (cross-cutting)

- **Bilingual depth knob**: grades 6-8 first-pass explanations default Hindi/Hinglish-primary with English support; grades 9-12 default English-primary with Hindi support. Toggleable mid-session via existing `AuthContext.isHi`.
- **Indian-context examples**: Foxy persona system (existing) carries an Indian-context default — cricket physics, IRCTC train problems, monsoon hydrology, kirana store accounting, Indian rail network distances.
- **Bandwidth-aware**: detect `navigator.connection.effectiveType`. On slow-2g/2g/3g: render text + SVG only, defer video, lazy-load images. On 4g+/Wi-Fi: full media. User explicit toggle overrides.
- **Parent-shareable artifacts** at every layer: monthly synthesis is the headline; weekly artifacts can be shared one-off with parent consent.
- **WhatsApp delivery** for parent-share (existing edge function).
- **Board-exam scaffold**: every NCERT topic carries an explicit `board_pattern_question_pool` flag; the daily ZPD problem for board-survivor persona pulls from this pool weighted high.
- **No streak shame, no class leaderboards by default**.
- **No video coaching imitation**: we are not BYJU's. Video, when used, is supportive — never the main vehicle.

## 11. Three-wave rollout (sized for solo founder)

### Wave 1 — Daily Rhythm (~3 weeks)

**Scope**:
- Daily rhythm orchestrator (`daily-rhythm-orchestrator.ts`).
- Dashboard refit: rhythm queue at top of feed.
- Productive-failure flip in `/learn/[subject]/[chapter]` behind `ff_productive_failure_v1`.
- Distractor-tagging migration for top-100 chapters' MCQs — `misconception_tag` column + retroactive backfill via Edge Function.
- Wrong-answer Foxy micro-explanation hook (Eedi pattern) behind `ff_distractor_micro_explainer_v1`.
- `pedagogyContentRules` resolver + tests (90% coverage, persona × layer × slot matrix).

**Feature flag**: `ff_pedagogy_v2_daily_rhythm` (rollout: internal → 5% → 25% → 100%).

**Success metrics for Wave 1**:
- ≥60% of DAU complete the daily rhythm (5 SRS + 1 ZPD + 1 reflect) end-to-end on enabled days.
- BKT mastery-state delta (per `cognitive-engine.ts` Bayesian Knowledge Tracing) on chapters with productive-failure flip ≥+15% vs control after 4 weeks.
- Wrong-answer follow-through rate (clicks the micro-explanation) ≥40%.

### Wave 2 — Weekly Dive (~3 weeks)

**Scope**:
- Foxy explorer mode (new mode in [foxy/route.ts](../../../src/app/api/foxy/route.ts) + `ai/workflows/explorer.ts`).
- `/dive` surface with three-option picker.
- Phenomenon catalog table + 24 seed phenomena curated in Hindi+English.
- Weekly-dive orchestrator + lab-notebook artifact composer.
- Weekly streak token persistence (extend existing streak storage).

**Feature flag**: `ff_pedagogy_v2_weekly_dive`.

**Success metrics for Wave 2**:
- ≥35% of WAU produce a weekly artifact in their first 4 weeks of exposure.
- Median dive session duration ≥25 minutes (target: 60 min, but a 25-min real session is honest progress).
- Phenomenon picker chosen ≥30% of dives (vs weak-topic and own-topic).

### Wave 3 — Monthly Synthesis (~2 weeks)

**Scope**:
- `/synthesis` surface and ritual.
- Monthly synthesis orchestrator (server-side bundle generator) — new Edge Function `monthly-synthesis-builder`.
- Claude Haiku one-page parent-share generation (Hindi+English).
- WhatsApp parent-share via existing `whatsapp-notify` (parent opt-in flow).
- HPC integration to render monthly delta.

**Feature flag**: `ff_pedagogy_v2_monthly_synthesis`.

**Success metrics for Wave 3**:
- Parent-share opt-in rate ≥50% of paying accounts.
- WhatsApp open rate (parent reads the message) ≥70% via tracked link.
- Chapter-mock score progression month-over-month positive for ≥60% of active students.

### Wave 2 corpus extension (parallel to Wave 3, ~1 week)

- Depth packs (JEE Foundation, NTSE/Olympiad, NEET Bio, Humanities) loaded into RAG.
- Persona-gated access in Foxy explorer mode.

**Total**: ~9 solo-developer weeks for full rollout. Each wave shippable independently behind its flag.

## 12. Success metrics (rollup)

- **Coherence (A)**: ≥75% of DAU complete or partially complete the daily rhythm; navigation to peer surfaces (quiz, exams, etc.) happens *from* the rhythm, not as alternatives.
- **Engagement (B)**: weekly artifact production rate ≥35%; monthly synthesis open rate by students ≥80% (the milestone is unmissed).
- **Depth (C)**: ≥25% of dives are own-topic or phenomenon (not just weak-topic); depth-pack opt-in among aspirational persona ≥40%.
- **India fit (D)**: parent WhatsApp share opt-in ≥50%; Hindi/Hinglish session minutes are ≥30% of total session minutes for grades 6-8.

## 13. Risks and mitigations

- **Risk**: Productive-failure flip frustrates struggling students. **Mitigation**: persona rule reverses the flip for struggling persona (worked example first); A/B measure mastery delta separately for struggling vs. others.
- **Risk**: Spec is built against canonical state today (commit `1922f722` baseline). Per the project's known "spec staleness" pattern, code may move ahead of spec within days. **Mitigation**: each wave's implementation plan (written via the writing-plans skill) re-audits the canonical repo before scoping that wave's tasks. The spec is the strategic frame; the plan is the tactical truth.
- **Risk**: Weekly dive is too unstructured; students bounce. **Mitigation**: Foxy explorer mode is heavily scaffolded — picker → guided question → artifact draft. Free-form is allowed but not the default.
- **Risk**: Monthly synthesis becomes parent-spam. **Mitigation**: explicit parent opt-in; one message per month max; unsubscribe respected at WhatsApp level.
- **Risk**: Distractor-tagging migration is a slog. **Mitigation**: Wave 1 only retroactively tags top-100 chapters; new questions get tagged at authoring time; AI-assisted bulk-tagging via existing `bulk-question-gen` infra.
- **Risk**: Three orchestrators × persona branching = combinatorial complexity. **Mitigation**: `pedagogyContentRules` is a single pure-function resolver with exhaustive table tests. No persona logic anywhere else.

## 14. Open questions

1. **Phenomenon catalog ownership** — who curates the 24 seed phenomena? Pradeep solo, or contracted educator? Affects Wave 2 timeline.
2. **Productive-failure flip scope** — global default behind a per-student opt-out, or per-topic feature flag with gradual rollout? Defaulting to "global with opt-out" is faster to ship; per-topic gives more A/B precision.
3. **Bandwidth detection trust** — `navigator.connection.effectiveType` is unreliable on iOS. Fallback to user toggle or use server-side IP/ASN heuristic? Wave 1 default: explicit user toggle in profile, with default = "auto" using `effectiveType` if available.
4. **Cohort artifact sharing** — out of scope for Wave 1-3, but flagging here: when this lands (Wave 4+), default visibility is private; school-tier students may have class-default with school-admin override. Defer to B2B white-label spec for school-tier policy.
5. **Mobile parity** — this spec is web-first. Mobile (Flutter) parity for the daily rhythm is a follow-on spec; daily rhythm should ship on mobile within 2 weeks of web Wave 1 to avoid a split product.

## 15. Inspirations and what we did NOT copy

**Mined**: Khan Academy mastery learning, Khanmigo Socratic tutor, Brilliant problem-first interactivity, Synthesis weekly cohort challenges, Squirrel AI knowledge-graph diagnostics, Eedi distractor design, Mathigon interactive widgets, Singapore Math CPA, Finnish phenomenon-based learning, IB inquiry cycle, Manu Kapur's productive failure, Roediger/Karpicke retrieval practice, Self-Determination Theory, Cognitive Load Theory, Anki/SuperMemo SRS.

**Deliberately not copied**:
- BYJU's video-tutor model — passive, attention-burning, not aligned with mastery.
- Aakash test-series-only model — no inquiry, no curiosity layer.
- Duolingo's public leaderboard / league pressure — wrong for Indian exam culture.
- Synthesis's synchronous cohort — async-only is solo-founder-feasible and culturally safer.
- Class-rank gamification — incompatible with Principle 6 (no streak shame).

---

## Appendix A — Mapping existing surfaces to rhythm slots

| Existing surface | Rhythm slot | Role |
|---|---|---|
| `/dashboard` | Daily | Hosts today's queue |
| `/quiz` | Daily | ZPD problem renderer |
| `/learn/[subject]/[chapter]` | Daily | Tutorial reveal post-attempt (productive-failure flip) |
| `/diagnostic` | Daily | Chapter-start session opener (5-Q routing) |
| `/foxy` | Weekly | Explorer mode + reflection grading |
| `/lab-notebook` | Weekly | Artifact storage |
| `/dive` *(new)* | Weekly | Picker + dive host |
| `/exams`, `/mock-exam` | Monthly | Chapter mock at synthesis time |
| `/hpc` | Monthly | Refresh during synthesis |
| `/synthesis` *(new)* | Monthly | Ritual + parent-share |
| `/progress` | Cross | Always-available rollup |
| `/leaderboard` | Cross (deprecate default) | Opt-in only; not in rhythm |
| `/study-plan` | Cross | Becomes "macro view" — calendar of upcoming rhythms |
| `/pyq` | Daily (board persona) | Source pool for board-pattern ZPD problems |
| `/simulations` | Weekly (curious/aspirational) | Phenomenon dive widget |
| `/scan` | Cross | Doubt → routes to Foxy |
| `/challenge` | Daily (cross) | One-off competitive layer; orthogonal to rhythm |

## Appendix B — Existing engines used by each layer

| Layer | Engines / modules called |
|---|---|
| Daily | `cognitive-engine.ts` (SM-2, ZPD, IRT, BKT, interleaving, Ebbinghaus, fatigue), `quiz-engine.ts`, `quiz-assembler.ts`, `xp-config.ts`, `goal-personas.ts`, `feedback-engine.ts` |
| Weekly | `foxy/*`, `ai/workflows/*` (extended with explorer), `rag/*`, `lab_notebook_entries` table, `cognitive-engine.ts` (knowledge-gap detector for weak-topic dive) |
| Monthly | `exam-engine.ts`, `quiz-generator-v2`, `cognitive-engine.ts` (retention-decay model), HPC renderer, `whatsapp-notify` Edge Function, Claude Haiku for parent-share text generation |

## Appendix C — Why this is not over-engineered for a solo founder

The temptation with a strategic spec is to write a 6-month north-star and call it done. This spec deliberately:

- **Reuses 80% of existing code** (15-primitive cognitive engine, XP economy, Foxy modes, exam engine, HPC, WhatsApp, lab-notebook, RAG).
- **Adds 3 new orchestrators** (daily, weekly, monthly) and **2 new surfaces** (`/dive`, `/synthesis`).
- **Sizes each wave at 2-3 solo-developer weeks** with feature-flag gating.
- **Defers depth-pack curation, mobile parity, and cohort features** explicitly.

If only Wave 1 ships, Alfanumrik already has a coherent daily rhythm — a real improvement on day one. Each subsequent wave is independently valuable.
