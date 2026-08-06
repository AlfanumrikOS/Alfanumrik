# Dashboard Learner-Data Semantics — Assessment Sign-Off Packet

**Date:** 2026-08-06
**Author:** frontend (dashboard W3 execution)
**Recipient:** assessment (owner of Learner Data Semantics)
**Status:** SIGNED OFF 2026-08-06 — frontend scope implemented; backend/mobile hand-offs open (below)

> Frontend is blocked from touching any of the numbers below until assessment
> signs off on the "Decision requested" line of each item. This packet exists
> because the four defects sit in the re-present / re-compute boundary
> (`packages/ui/src/dashboard/os/`): frontend may count/bucket/group
> engine-decided values, but recomputing mastery, accuracy, or predicted marks
> — or changing what the engine emits — is assessment's call.
>
> **Assessment decisions (2026-08-06) and owners:**
>
> | Item | Decision | Owners |
> |---|---|---|
> | D1 | **A** — scope gauge to the selected subject | frontend (DONE) |
> | D2 | **N = 5 confirmed**, **A** — suppress ring below N | frontend (DONE) |
> | D3 | **A** — distinguishing signal; frontend does the copy branch + legacy fallback in `getMasteryOverview` | frontend copy/fallback (DONE); **backend** emits `coverage` in `get_mastery_overview` (response-shape change — flags **mobile**), **mobile** verifies the new contract |
> | D11 | **A** — delete the orphaned `bkt_update_personalized` writer; `{total}` chip shrink accepted (D2 gate applied to the ring) | **architect + backend** (DB migration; revoke-execute corrective already exists) |
>
> Reference: `.claude/skills/student-dashboard-design/SKILL.md` → Learner Data
> Semantics, Denominators and sample size, Known Defects (D1, D2, D3, D11).

---

## D1 — BoardScore gauge denominator mismatch

**Where:** `packages/ui/src/dashboard/os/BoardScoreWidget.tsx` (gauge `:348-392`, subject tabs `:394-424`, coverage bar `:426+`)

**What the student sees:** one gauge ring + one `totalPredicted/totalMax` pair stacked directly above a per-subject confidence band and a per-subject coverage bar.

- `overallPct` = sum of `predicted_score` across **all subjects** ÷ sum of `max_score` across **all subjects** (`BoardScoreWidget.tsx:283-285`) — a **cross-subject** aggregate.
- `totalPredicted / totalMax` — same **cross-subject** totals.
- `sel.confidence_band_low/high` and `sel.coverage_pct` — **single-subject** (the subject selected in the tabs).

**Violation:** the skill's cross-subject rule ("never render a cross-subject aggregate adjacent to a per-subject uncertainty band — a mixed-denominator stack reads as one fact"). A student reads "78% · Confidence Band: 61–72%" with no signal the band covers one subject while the gauge covers all.

**Fix options (assessment decides which number is right):**

| Option | What the gauge would show | Cost |
|---|---|---|
| A. Scope gauge to the selected subject | The `sel` row's own `predicted_pct` (already per-subject, engine-emitted) + its own confidence band; the cross-subject totals move out or drop | Single denominator everywhere; simplest honest story; loses the "whole-session" number |
| B. Aggregate the band across subjects | A confidence band for the *summed* totals (needs a cross-subject variance model — engine work) | Keeps the headline number, adds a new engine-emitted aggregate the nightly cron must write |
| C. Keep both but re-label hard | "All subjects: 78% (342/440)" + "Selected subject: confidence 61–72%" | Cosmetic; skill says a label is *not* a fix for a number that reads as one fact |

**Decision requested:** A, B, or C — and if B, whether `board-score` Edge Function (the scoring authority) or the Next.js route owns the aggregate.

---

## D2 — `masteredPct` small-denominator ring

**Where:** `MasterySnapshot.tsx:125` (`masteredPct`), summary ring `:195-200`

**What the student sees:** `StatRing` showing `masteredPct = Math.round((counts.mastered / total) * 100)`, where `total` counts topics **not currently labelled `not_started`**.

**Violation:** with one started-and-mastered topic, `masteredPct` renders a hero **100%** ring. Arithmetically correct; pedagogically false. Violates the skill's sample-size rule (`N = 5` floor; a percentage over fewer than N observations is suppressed or explicitly marked provisional).

**Fix options (under assessment's `N = 5` threshold):**

| Option | Behaviour |
|---|---|
| A. Suppress the ring below N | Below `N = 5` started topics, hide the ring (show the segmented bar + counts only) |
| B. Mark provisional | Below N, show the ring but labelled "provisional" (bilingual) |
| C. Different ring base | Ring shows `mastered / syllabusTotal` instead of started — but the skill warns `not_started` is excluded and the writer emits it, so the denominator needs assessment to define |

**Decision requested:** the N value (confirm `N = 5`), and A vs B for below-threshold behaviour. Note D2 and D3 share the same `total === 0` region.

---

## D3 — empty state attributes a platform gap to the student

**Where:** `MasterySnapshot.tsx:167-186`

**What the student sees:** `total === 0` → "No quizzes yet / Take a quiz to see your mastery here."

**Violation:** `get_mastery_overview` selects `curriculum_topics … WHERE is_active = true AND grade = v_grade` (baseline migration `00000000000000_baseline_from_prod.sql:4654`). It returns `[]` for a grade with **no curriculum topics at all** — a platform coverage gap, not the student's inaction. Per the skill: *an empty state may only attribute emptiness to the student when the emptiness is attributable to the student.*

**Fix options:**

| Option | Who does what |
|---|---|
| A. Distinguishing signal | **Backend:** `get_mastery_overview` (or the Next.js wrapper) emits a coverage/availability flag (e.g. `coverage: 'no_curriculum'` vs `'no_activity'`). **Frontend:** neutral copy ("Nothing to show here yet") for `no_curriculum`, keep the quiz CTA only for `no_activity` |
| B. Always-neutral copy | **Frontend only:** "Nothing to show here yet" with no self-blame CTA in both cases. Loses the actionable quiz prompt for the genuinely-zero-quizzes case |

**Decision requested:** A (preferred — keeps the actionable case) with the exact response-shape contract (flag name + values), or B. A is a response-shape change → flags **backend** + **mobile** review.

---

## D11 — mastery band divergence between two BKT writers

**Where:** `supabase/migrations/00000000000000_baseline_from_prod.sql` — `bkt_update_personalized` `:1437-1441` vs `update_mastery_bkt` `:8481`

**What happens:** the two writers emit different `mastery_level` vocabularies:

- `bkt_update_personalized` — `>=0.95` mastered / `>=0.7` proficient / `>=0.4` developing / else beginner.
- `update_mastery_bkt` — `>=0.95` mastered / `>=0.75` proficient / `>=0.50` familiar / `>=0.20` developing / else **`not_started`**.

**Why it surfaces on the dashboard:** `update_mastery_bkt` is **live** (called by `record_learning_event` → `recordLearningEvent()` in `packages/lib/src/supabase.ts`, wired from the learn-chapter page). It emits the **recognised** value `'not_started'` whenever `p_know < 0.20` — so an attempted-and-struggling topic drops out of the `{total} topics` tally (`MasterySnapshot.tsx:151`), and **the chip can shrink with no regression in knowledge** (also the non-monotonicity behind D2's denominator). `bkt_update_personalized` is **orphaned** (no caller anywhere) — see skill.

**Fix options (assessment-owned; possibly a DB migration — flags architect + backend):**

| Option | What it means |
|---|---|
| A. Delete the dead writer | Remove `bkt_update_personalized` (orphaned, revoke-execute corrective migration already exists); single vocabulary remains, the divergence is moot |
| B. Reconcile bands | Align the two writers' thresholds; needs agreement on one band table and on whether `not_started` should exist below `p_know 0.20` at all |
| C. Define a stable total | A separate metric — "ever started/mastered" — so `MasterySnapshot`'s `{total}` stops shrinking; **frontend needs assessment to define this metric before building any card on it** |

**Decision requested:** A, B, and/or C — and whether "the `{total}` topics chip may shrink" is acceptable as-documented (with the D2 N-threshold applied to the ring) or must be fixed first.

---

## Sign-off

- [x] D1 — **A** chosen: scope gauge to the selected subject. Implemented in `BoardScoreWidget.tsx` (ring + marks pair now read the `sel` row; cross-subject reduce removed; ring/band/coverage share one denominator).
- [x] D2 — **N = 5 confirmed**, **A** chosen: ring suppressed below N. Implemented in `MasterySnapshot.tsx` (`showRing = total >= 5`); segmented bar + counts carry the distribution below N.
- [x] D3 — **A** chosen: `getMasteryOverview` now returns `{ rows, coverage }` with a legacy fallback (`getMasteryOverview` in `packages/lib/src/supabase.ts`); `useMasteryOverview` exposes `coverage` while `data` stays the bare rows array; `MasterySnapshot` branches the empty-state copy (`no_activity` → quiz prompt, `no_curriculum`/`not_tracked` → neutral). **Backend hand-off:** `get_mastery_overview` must emit the `coverage` field (`'ok' | 'no_activity' | 'no_curriculum'`) — response-shape change flags **mobile**.
- [x] D11 — **A** chosen: delete the orphaned `bkt_update_personalized` writer (single vocabulary remains; divergence moot). `{total}` chip shrink is accepted as-documented with the D2 gate applied to the ring. **Architect + backend hand-off:** DB migration.

On sign-off, frontend implements the approved options and hands the
response-shape / migration / RPC work to backend + architect + mobile (if any)
via the normal review chain. **Frontend scope is complete as of 2026-08-06;
backend (D3 `coverage` emission, D11 writer deletion) and mobile (D3 contract
verification) remain open.
