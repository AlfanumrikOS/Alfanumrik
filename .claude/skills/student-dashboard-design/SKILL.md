---
name: student-dashboard-design
description: Design language, card recipe, token table, learner-data semantics (mastery/BoardScore/streak/XP), bilingual/a11y/motion rules, known defects, and the add-a-card checklist for the minimalistic card-based student dashboard.
user-invocable: false
---

# Skill: Student Dashboard Design

The build rules for `/dashboard` — a minimalistic, card-based, mastery-first student surface. Reference this before adding, reordering, restyling, or deleting any dashboard card so the result is indistinguishable in feel from what already ships.

**Owning agent**: frontend. Assessment reviews any learner-data semantics; quality reviews conformance.

## Live Composition (this is the whole dashboard)

| # | Slot | Component |
|---|---|---|
| entry | route | `apps/host/src/app/(student)/dashboard/page.tsx` — dynamic-imports the shell with `ssr: false`, `<DashboardSkeleton/>` fallback |
| shell | `StudentOSDashboard.tsx` | same dir. **No feature-flag dispatch.** `ff_student_os_v1` is registry-documented but never read; `AtlasDashboard` is deleted. Do not add flag-dispatch. |
| 0 | consent | `packages/ui/src/dashboard/PendingLinkApproval.tsx` (self-hides when empty) |
| 1 | hero | `packages/ui/src/dashboard/os/TodaysMission.tsx` |
| 2 | CTA | `packages/ui/src/foxy-launcher/FoxyPanelLauncher.tsx` (tap-gated, dynamic). **The one wrapper exception** — it is nested in `<div className="my-3 flex justify-start">` (`StudentOSDashboard.tsx:308`), not a bare direct child like every other slot. |
| 3 | mastery | `os/MasterySnapshot.tsx` — inline dupe wrapped in `md:hidden` |
| 4 | prediction | `os/BoardScoreWidget.tsx` |
| 5 | revision | `os/RevisionRail.tsx` — inline dupe wrapped in `lg:hidden` |
| 6 | roadmaps | `os/SubjectRoadmaps.tsx` |

Shell call: `<AppShell variant="split" className="student-os-shell" header={headerRail} oneHandToggle rail={<MasterySnapshot/>} aside={<RevisionRail/>}>` (`StudentOSDashboard.tsx:272-289`; `packages/ui/src/responsive/AppShell.tsx`). `className` reaches real logic, so **rename with care**: `AppShell.tsx:149` branches on `className?.includes('foxy-shell')` to skip the compact-on-scroll header. `student-os-shell` does **not** match that branch and has **zero** CSS rules anywhere in source (its only occurrence is the JSX at `:274`) — dropping it today changes nothing, but renaming it to anything containing `foxy-shell` would silently kill the compacting header. The dashboard passes **no `nav` prop** — bottom nav / sidebar mount once at root via `packages/ui/src/navigation/GlobalAppLayout.tsx`.

Content column is `<div className="flex flex-col gap-5 px-4 pt-2 pb-6">` (`StudentOSDashboard.tsx:291`). Add cards inside it, in slot order, as direct children — the sole exception today is the `FoxyPanelLauncher` wrapper noted in slot 2.

### Deleted 2026-08 — gone, not merely dead
The whole dead list below was removed in the Phase 2 orphan consolidation (every entry had zero live importers). **Do not resurrect these paths from older docs, plans, or audits — they no longer exist on disk.**

- `packages/ui/src/dashboard/sections/**` — entire directory (`AboveFoldHero`, `CosmicAboveFoldHero`, `CompeteSection`, `ProgressSection`, `QuickActionsSection`, `TodaysFocusSection`, `UpcomingSection`, `DailyRhythmQueue`)
- `packages/ui/src/dashboard/os/GrowthStrip.tsx`
- `packages/ui/src/dashboard/{ComebackHook,DailyChallenge,DailyLabMission,DailyPlanCard,ExamReadiness,FocusDashboard,FoxyBannerCard,ProgressSnapshot,QuickActions,SubjectProgress,TodaysPlan}.tsx`

Note on `DailyRhythmQueue`: only the *renderer* was deleted. `composeDailyRhythm()` and the `DailyRhythmQueue` interface in `packages/lib/src/learn/daily-rhythm-orchestrator.ts`, the `/api/rhythm/today` route, and the `ff_pedagogy_v2_daily_rhythm` flag are all still live — a new daily-rhythm card mounts against those, not against the deleted file.

## The Card Recipe

Convention: semantic `<section>` + Tailwind for **geometry only** + inline `style` with **CSS variables for every colour, border, and shadow**. Tailwind colour utilities are almost never used.

```tsx
<section
  className="os-reveal-card rounded-2xl p-4"
  style={{
    ['--reveal-i' as string]: '3',
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-sm)',
  }}
  aria-label={isHi ? 'महारत का सारांश' : 'Mastery snapshot'}
>
```

| Element | Geometry | Surface / shadow |
|---|---|---|
| Hero / major card | `rounded-3xl p-5 md:p-6` | `var(--surface-1)`, `var(--shadow-md)` |
| Standard card | `rounded-2xl p-4` | `var(--surface-1)`, `var(--shadow-sm)` |
| Sub-row inside a card | `rounded-xl`/`rounded-2xl`, `px-3` + ~8–10px vertical | `var(--surface-2)` or a `color-mix` tint; optional `borderLeft: '3px solid <status colour>'` |
| Empty state | `rounded-xl p-4 text-center` | `var(--surface-2)` + `border: '1px dashed var(--border)'` |
| Section gap | `gap-5` between cards | — |
| Inside-card rhythm | `gap-2` / `space-y-2` | — |

- `--reveal-i` is **required** on any `os-reveal-card`. Live indices: hero implicit (`.os-mission`), MasterySnapshot `'1'`, BoardScoreWidget `'2'`. A new card continues the sequence; the CSS caps the stagger at 6.
- Alpha tints go through the `tint()` helper pattern (`color-mix(in srgb, ${color} ${pct}%, transparent)`) so tints stay bound to the semantic token — see `MasterySnapshot.tsx` / `BoardScoreWidget.tsx`.

### Two card systems coexist — be deliberate
- `packages/ui/src/ui/primitives/Card.tsx` — canonical `Card` / `CardHeader` / `CardBody` / `CardFooter`, `variant: 'flat' | 'elevated' | 'interactive'`. **Use this for new generic cards anywhere in the app.**
- `PremiumCard` (`packages/ui/src/ui/wonder-blocks.tsx:1341`) — legacy. **On the dashboard** it has exactly one usage: `TodaysMission` with `glow gradient` (`TodaysMission.tsx:122-126`). App-wide it is far from dead — ~16 live render sites remain outside the dashboard: `apps/host/src/app/(student)/progress/page.tsx` (208, 609, 711, 809, 837, 983), `(student)/leaderboard/page.tsx` (575, 717, 805, 860, 962, 1030, 1139), `(student)/exams/page.tsx` (306, 334, 552); `(student)/learn/page.tsx:29` imports it but currently renders none. **Do not add new `PremiumCard` usages anywhere** — those existing sites are inherited surface area, not precedent.
- OS dashboard **section shells** use the section+token recipe above. Keep it that way; do not "upgrade" them to `primitives/Card` as a drive-by.

### Two known outliers — do not copy either
Live precedent is not uniform. Two cards deviate, in different dimensions:

- **Token outlier — `PendingLinkApproval.tsx`** (catalogued as **D12**). Uses raw `amber-*` / `gray-*` Tailwind classes and hardcoded `#FFFBEB`, `#16A34A`, `#EF4444`. The one live card off the token system.
- **Geometry outlier — `RevisionRail.tsx:39-42`** (catalogued as **D13**). Its shell is `<section className="rounded-3xl p-4">` with `background: var(--surface-1)` + `border: 1px solid var(--border)` but **no `boxShadow` and no `os-reveal-card`** (so no `--reveal-i` either). That matches neither the hero row (`rounded-3xl p-5 md:p-6` + `--shadow-md`) nor the standard-card row (`rounded-2xl p-4` + `--shadow-sm`) in the table above. It reads as intentional quietness for an aside-mounted surface, but it is not the documented recipe.

Fix either if you touch it; never cite either as precedent. When live code and the recipe table disagree, **the table wins.**

## Token Table (from `packages/ui/src/globals.css` + `apps/host/tailwind.config.js`)

| Group | Tokens |
|---|---|
| Surfaces | `--surface-1 #FFFFFF`, `--surface-2 #F5F0EA`, `--surface-3 #EDE6DC`, page `--bg #FBF8F4` |
| Text | `--text-1 #1A1207` (primary), `--text-2 #4A3F2E` (secondary), `--text-3 #6B6053` (muted/labels) |
| Borders | `--border rgba(0,0,0,0.08)`, `--border-mid rgba(0,0,0,0.12)`, `--border-strong rgba(0,0,0,0.18)` |
| Brand | `--orange #E8581C` (+ `--orange-rgb 232,88,28`), `--purple #7C3AED`, `--gold #F5A623`, `--teal #0891B2`, `--green #16A34A`, `--red #DC2626` |
| Semantic | `--success`→green, `--warning`→gold, `--info`→teal, `--danger`→red, `--primary`→orange |
| Gamification | `--xp-color`→gold, `--streak-color`→orange, `--mastery-low`→red, `--mastery-mid`→gold, `--mastery-high`→green, `--level-up`→purple |
| Shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-glow` |
| Radius | `--radius-sm 2px`, `--radius-md 6px`, `--radius-lg 8px`, `--radius-xl 12px`, `--radius-2xl 16px` (Tailwind `rounded-*` maps onto these) |
| CTA gradient | `linear-gradient(135deg, var(--btn-primary-from #CB4710), var(--btn-primary-to #C2440F))` |
| Layout | `--layout-max-content min(1240px, …)`, `--layout-max-rail 220px`, `--layout-max-aside 320px`, `--shell-header-h-compact 44px`, `--safe-bottom`, `--space-fluid-1…12` |
| Fonts | `--font-display Sora` (headings, data), `--font-body Plus Jakarta Sans`. Tailwind: `font-heading` / `font-display` / `font-data` (Sora), `font-sans` (Plus Jakarta Sans). `--font-serif` (Fraunces) is **marketing-only** — never on the dashboard. |

Three hard warnings:
1. **`dark:` utilities are dead CSS.** `darkMode: ['selector', '[data-theme="dark-disabled-pending-cleanup"]']` (`apps/host/tailwind.config.js:22`) — that attribute is never written. Authoring `dark:` classes ships bytes that can never match.
2. **Cosmic theme is NOT active.** `useCosmicLightSurface()` (`packages/lib/src/use-cosmic-light-surface.ts`) *removes* `data-design` and `data-role` and sets `data-theme="light"`, so `html[data-design="cosmic"]` never matches. Every "`--orange-rgb` is violet here" / "violet remap" comment in `StudentOSDashboard.tsx`, `RevisionRail.tsx`, `BoardScoreWidget.tsx`, `MasterySnapshot.tsx` is **stale**. Consequence: `var(--font-mono)` resolves to nothing on this surface — **always pass a fallback: `var(--font-mono, ui-monospace, monospace)`**. Every dashboard-reachable site now complies: `MasterySnapshot.tsx:272`, `StudentOSDashboard.tsx:253` (header XP chip), `packages/ui/src/ui/RoadmapNode.tsx:143` (the last two were bare `var(--font-mono)` until 2026-08-05). Non-dashboard surfaces still carry bare usages (`practice/os/*`, `review/os/RevisionHeader.tsx`, `learn/os/SubjectHeader.tsx`) — fix them opportunistically when you touch that code; they are outside this skill's scope.
3. Prefer tokens over raw hex or Tailwind palette classes. A hex is acceptable only as a `var()` fallback.

### Known ambiguity — `--accent-warm*` (unresolved, do not "clean up" unilaterally)

`--accent-warm`, `--accent-warm-strong`, and `--accent-warm-rgb` (`globals.css:57,64-65`) exist **because of** the cosmic remap that warning 2 says is inactive. Their comments explain they are a "stable warm channel" for surfaces where `--orange-rgb` is remapped to violet — a condition that never occurs today.

They are nonetheless **load-bearing in live code**, not vestigial: the header XP chip (`StudentOSDashboard.tsx:247-249`), `MasterySnapshot`'s Learning bucket colour (`MasterySnapshot.tsx:75`, documented at `:55`), the `WARM` / `WARM_STRONG` constants in `BoardScoreWidget.tsx:33-34` (plus `STATUS_CFG.moderate` at `:85`) and `TodaysMission.tsx:50-55`, and the `RevisionRail` due-count pill (`RevisionRail.tsx:56-57`) all route through them. They are also declared in `:root`, so they resolve correctly on every surface regardless of cosmic — nothing is broken.

The open question is whether to (a) delete the indirection and collapse back to `--orange` now that cosmic is dead, or (b) re-document `--accent-warm` as the intended warm channel and drop the stale "violet remap" comments. **This is an unmade frontend decision — do not resolve it as a drive-by in an unrelated PR.** Until it is decided: keep using `--accent-warm*` where live code already does (consistency beats a half-migration), and don't add new "`--orange-rgb` is violet here" comments, which are stale on arrival.

## Bilingual (P7)

No i18n library, no locale JSON. The idiom:
- Page calls `const { isHi } = useAuth()`; **every dashboard component takes `isHi: boolean` as a required prop.** Never re-read AuthContext inside a leaf card.
- 1–3 strings → inline ternary. Many strings → a `const T = { … }` label map (see `BoardScoreWidget.tsx` ~lines 145-168).
- Enum labels → bilingual constant tables (`STATUS_CFG` in `BoardScoreWidget.tsx`, `BUCKETS` in `MasterySnapshot.tsx` with `labelEn`/`labelHi`/`ctaEn`/`ctaHi`).
- Today-queue copy → `todayCopy()` in `packages/lib/src/today/copy.ts`.
- `apps/host/src/app/(student)/dashboard/error.tsx` cannot use AuthContext — it sniffs `localStorage['alfanumrik_language'] === 'hi' || navigator.language?.startsWith('hi')`. Match that pattern in any new error boundary.
- No new user-facing string ships English-only. Do **not** translate CBSE, XP, Bloom's, BoardScore™, Foxy, NCERT, PYQ.

## Privacy (P13)

Dashboard cards are handed identifying data as props — `studentId` and `studentName` reach `FoxyPanelLauncher` directly (`StudentOSDashboard.tsx:317-318`), and every card takes `studentId`. **Never send either to `console`, Sentry, or an analytics payload.** Log an event name and non-identifying counts; if you need to correlate, let the server do it from the authenticated session. This applies to error boundaries too — a caught error must not be logged with the student's name or id attached.

## Data + The Four States

Hooks in use: `useTodayQueue` (`packages/lib/src/today/use-today-queue.ts` → `/api/v2/today`), `useMasteryOverview` and `useReviewCards` (`packages/lib/src/swr.tsx`), `authedFetch('/api/board-score')` (`packages/lib/src/authed-fetch.ts`). Global SWR defaults live in `packages/lib/src/swr.tsx`: `revalidateOnFocus: false`, `dedupingInterval: 10000`, `errorRetryCount: 2`, no retry on 4xx, `keepPreviousData: true` — tuned for Indian mobile networks. Don't override without a stated reason.

Every card MUST render **four** states:

| State | Requirement |
|---|---|
| Loading | Shape-matched skeleton: `<section aria-busy="true" aria-label={…}>` with `Skeleton` bones whose sizes mirror the loaded layout (`MasterySnapshot.tsx`, `BoardScoreWidget.tsx` both do this) |
| Error | Bilingual, `role="status"`, **never render the raw error string**, offer retry where the fetch is cheap |
| Empty | Dashed-border panel + emoji (`aria-hidden`) + headline + sub-line + CTA to the action that fills it. The copy must not blame the student for emptiness that isn't theirs — see Learner Data Semantics → "Empty states must not blame the student" |
| Loaded | The real card |

- Skeletons: `packages/ui/src/Skeleton.tsx` — `DashboardSkeleton` (`:45`) is **shape-matched to the real dashboard**. Adding or reordering a card means you MUST update it, or first paint visibly reflows. **Two different bone APIs — don't mix them up:** `DashboardSkeleton` builds its bones from a **file-local, non-exported** `Bone` helper (`Skeleton.tsx:15`, props `width` / `height` / `radius` / `className`), *not* the exported `Skeleton` primitive. In-card bones inside your component use the `Skeleton` primitive (`packages/ui/src/ui/wonder-blocks.tsx:1132`, props `className` / `width` / `height` / `rounded` / `variant`). Same job, different prop names — `radius` is a number on `Bone`, `rounded` is a Tailwind class string on `Skeleton`.
- **Anti-pattern:** a failed or in-flight fetch must never masquerade as a positive empty state ("all caught up", "nothing due", "0 topics"). Gate every reassuring empty state on `loaded && !error`, where `loaded = Array.isArray(data)`. **Reference implementation (correct, copy this):** `RevisionRail.tsx:35-36` derives `const loaded = Array.isArray(reviewCards); const dueCount = loaded ? reviewCards!.length : 0;`, and the render gate at `RevisionRail.tsx:80` is `{!error && loaded && dueCount === 0 && …}`. The `dueCount` fallback to `0` while loading is exactly why the `loaded && !error` guard is load-bearing.

## Learner Data Semantics

**Assessment owns every rule in this section.** Frontend implements it; changing any of it is a hand-off, not a refactor. The dashboard's numbers are a student's picture of their own progress — getting one subtly wrong is worse than not shipping the card.

### The re-present / re-compute line

The dashboard **re-presents** engine-decided learner state. It does not compute it. But "re-present" is not the same as "render the raw field verbatim", and both live exemplars do arithmetic:

- `MasterySnapshot.tsx:125` — `masteredPct = Math.round((counts.mastered / total) * 100)`, a client-side percentage.
- `BoardScoreWidget.tsx:283-285` — sums `predicted_score` / `max_score` across subjects into `overallPct`.

Both are **defensible re-presentations**, not violations. The rule that separates them from a violation:

> **Counting, bucketing, and grouping engine-decided values is permitted. Recomputing mastery, accuracy, or predicted marks from raw components requires assessment sign-off.**

Permitted without sign-off: counting rows in a bucket, summing a field the engine already decided (`predicted_score`), grouping by subject, sorting, taking a share of a count. Requires sign-off: anything that touches `mastery_probability`, `p_know`, `attempts`/`correct_attempts`, `effective_mastery`, `retention_factor`, a confidence band, or a marks prediction and produces a *different* number than the engine emitted. If you find yourself reimplementing a formula that exists server-side, stop.

### Mastery semantics — `packages/lib/src/dashboard/mastery-buckets.ts`

`get_mastery_overview` (baseline migration `supabase/migrations/00000000000000_baseline_from_prod.sql:4654` — the function body; `:4651` is only the `CREATE FUNCTION` signature) is the **sole mastery authority**. It emits, per curriculum topic: `mastery_level` (from BKT), `mastery_probability`, `attempts`, `correct_attempts`, `next_review_at`, and `due_for_review = next_review_at IS NOT NULL AND next_review_at <= now()`. `mastery-buckets.ts` only *classifies* those values — its header says so explicitly (`mastery-buckets.ts:14-15`: "No mastery formula lives here — assessment owns that").

Three load-bearing rules a card author will otherwise get wrong:

1. **`due_for_review` outranks `mastery_level`.** `bucketForRow` checks `due_for_review` first (`mastery-buckets.ts:52`), and `roadmapStatusForRow` repeats the same precedence (`:79`). A topic sitting at `mastered` that comes due is counted **Needs Revision**, not Mastered. **Consequence: the Mastered count can fall with no regression in the student's knowledge.** A new "topics mastered" card written without this rule will visibly contradict `MasterySnapshot` on the same screen. If your card needs a stable "ever mastered" number, that is a different metric and needs assessment to define it.
2. **`not_started` is excluded from the tally** (`mastery-buckets.ts:54` returns `null`). So `MasterySnapshot`'s `{total} topics` chip (`MasterySnapshot.tsx:151`) means **topics not currently labelled `not_started`** — not curriculum size, and not quite "started topics" either. Never label a bucket total "your syllabus", "all topics", or "chapters in Grade 9". **Caveat: `{total}` can shrink.** `update_mastery_bkt` re-emits `'not_started'` whenever `p_know` falls below `0.20`, so a topic the student *has* attempted can be relabelled back out of the tally — the same non-monotonicity flagged for Mastered in rule 1. See D11.
3. **`masteryPercent()` is the BKT posterior probability, not accuracy** (`mastery-buckets.ts:86-89`). It is for bucketing and roadmap-node fill only. The canonical student-facing number is **`accuracyPercent()`** (`:99-101`), which routes through `calculateScorePercent` (`packages/lib/src/scoring.ts:17-19`) so it reconciles with what the student saw on their quiz results (P1). The file states this at `:91-98`. **An author reaching for the obvious-sounding `masteryPercent()` will label a BKT posterior "your score."** Same trap for the aggregate: use `aggregateAccuracyPercent()` (`:107-115`), not an average of `masteryPercent()`.

Band thresholds are assessment's, not yours, and they are **not uniform in the database today**:

- `bkt_update_personalized` — baseline `:1437-1441`, the `UPDATE concept_mastery SET … mastery_level = CASE` write (`:1451` only re-derives the same CASE for the `RETURN jsonb_build_object` payload, so it is the weaker of the two sites to cite). Bands: `>=0.95` mastered / `>=0.7` proficient / `>=0.4` developing / else beginner.
- `update_mastery_bkt` — baseline `:8481`. Bands: `>=0.95` mastered / `>=0.75` proficient / `>=0.50` familiar / `>=0.20` developing / else **`not_started`**.

Which writer is authoritative is an **assessment** question — do not resolve it in a component, and never hardcode a band cutoff in the UI.

**The two writers are not equally dead — verify before assuming either is safe to touch.** An earlier audit note claiming neither RPC has a caller is correct for only one of them:

- `bkt_update_personalized` is genuinely **orphaned**: it appears only in the generated `apps/host/src/types/database.types.ts:23763`, a revoke-execute corrective migration, and `docs/superpowers/runbooks/2026-05-09-function-executable-triage.md`. Nothing invokes it. For this writer the right fix may be **deleting a dead writer** rather than reconciling bands.
- `update_mastery_bkt` is **live**. It is called from SQL by `record_learning_event` (baseline `:6469`), which is called by `recordLearningEvent()` (`packages/lib/src/supabase.ts:864-865`), which has two live call sites in `apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx` (`:699`, `:2276`). Its vocabulary reaches real `concept_mastery` rows that `get_mastery_overview` then serves to the dashboard.

That second point has a consequence the UI does not currently flag. **`'not_started'` is a *recognised* value, not an unrecognised string** — `bucketForRow` returns `null` for it explicitly (`mastery-buckets.ts:54`). Because `update_mastery_bkt` emits `'not_started'` for any `p_know < 0.20`, an attempted-and-struggling topic is relabelled `not_started` and **drops out of the tally entirely**, so the `{total} topics` chip can shrink (rule 2). The string-tolerance in `bucketForRow` (unknown levels fall into Learning) is what absorbs the *band* divergence; it is not what makes this benign.

Adjacent context, still assessment-owned: a **third** BKT writer exists — `bkt_update` (baseline `:1312`, invoked by `record_adaptive_response` at `:6457`), with its own vocabulary including `'attempted'` and `'familiar'`. It writes to **`adaptive_mastery`**, a *different* table that never feeds `get_mastery_overview`, so it sits outside D11 proper. It matters only because "which writer is authoritative" is a broader question than the two named above.

### BoardScore™ contract

- Source: `authedFetch('/api/board-score')` (`BoardScoreWidget.tsx:117`). That Next.js route is a **thin proxy** — the `board-score` Supabase **Edge Function** is the single source of truth for scoring logic, feature-flag enforcement, and persistence. Rows are written by the **nightly cron**, so the widget's empty state is "the cron hasn't run for you yet", not "you have no data" (`BoardScoreWidget.tsx:251-276`).
- Shape: one row **per subject** — `predicted_score`, `max_score`, `predicted_pct`, `confidence_band_low/high`, `coverage_pct`, `chapters_with_data`/`total_chapters`, `chapter_scores`, `recovery_plan`. Every one of those is **per-subject**.
- The widget **self-gates**: `json.code === 'disabled'` renders a "Coming Soon" panel (`BoardScoreWidget.tsx:123`, panel at `:201-221`). A new BoardScore-derived card must respect the same gate — never render a prediction on a surface where the flag is off.

**Rule: never render a cross-subject aggregate adjacent to a per-subject uncertainty band.** A mixed-denominator stack is not a styling flaw; it is a number the student will read as one fact when it is two. See the live violation in Known Defects below.

### Denominators and sample size

"Never fabricate, round up, or encourage a number" needs an operational test. This is it:

> **Every student-facing percentage ships with its denominator visible, and a percentage computed over fewer than N = 5 observations is either suppressed or explicitly marked provisional.**

`N = 5` is an **assessment-owned threshold** — it is the documented floor, not a frontend preference, and assessment may raise it per metric (an accuracy percentage over 5 answered questions is thinner than a topic share over 5 topics). Do not lower it, and do not invent a per-card variant.

Why it matters, concretely:
- `masteredPct` (`MasterySnapshot.tsx:125`) is denominated on **started** topics. A student with exactly one started-and-mastered topic gets a hero **100%** ring. The ring is arithmetically correct and pedagogically false.
- `BoardScoreWidget` renders a confident-looking gauge percentage while its own low-confidence caveat is demoted to a small footnote under a `coverage_pct < 60` condition (`BoardScoreWidget.tsx:370-374`). That `coverage_pct < 60` gate is the same idea as N with a domain-specific threshold — it is assessment/backend-owned; don't retune it in the component.

A denominator is "visible" when the student can see what the percentage is out of without interaction: `12/30`, `4 of 7 topics started`, `Coverage 45% (9/20 chapters)`. A bare `78%` with the count only in an `aria-label` does not count.

### Streaks — two different objects, never conflated

- **Daily streak.** `snapshot.current_streak`, read at `StudentOSDashboard.tsx:215` and passed to `StreakBadge count compact` (`packages/ui/src/ui/wonder-blocks.tsx:1051-1073`). Server-computed; resets on a missed day.
- **Weekly Curiosity Dive streak** (Pedagogy v2). A **different, deliberately forgiving** object: missing one week does not reset it; missing four consecutive weeks does (`docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md:145`).

Never label one with the other's copy, never show both as "your streak", and never re-derive either client-side from session dates — both are server state.

### XP

The P2 rule (server-computed only; constants from `packages/lib/src/xp-config.ts`; never hardcode a number) is in Engagement Mechanics below. One semantic consequence that is invisible to card authors: **`XP_RULES.quiz_daily_cap = 200` (`xp-config.ts:47`)** means the XP chip can legitimately stop moving mid-session. Any copy of the form "keep going to earn more XP" becomes false the moment the cap is hit — so either don't write it, or gate it on a server-provided remaining-XP signal that does not exist today.

### Empty states must not blame the student

Beyond the empty-vs-error rule in Data + The Four States, there is an empty-vs-**content-gap** case. `MasterySnapshot` shows "No quizzes yet / Take a quiz to see your mastery here" whenever `total === 0` (`MasterySnapshot.tsx:167-186`). But `get_mastery_overview` selects from `curriculum_topics ct … WHERE ct.is_active = true AND ct.grade = v_grade` (baseline `:4654`) — so it legitimately returns `[]` when **no curriculum topics exist for that grade at all**. That is a platform coverage gap being presented to a child as their own inaction.

> **Rule: an empty state may only attribute the emptiness to the student when the emptiness is attributable to the student.**

When you can't distinguish the two cases from the response, use neutral copy ("Nothing to show here yet") and no self-blame CTA. When you can (the API returns a coverage/availability signal), say which it is.

## Engagement Mechanics

**On the dashboard today:** streak (`StreakBadge count compact`, `wonder-blocks.tsx:1051`), demoted XP chip (`.toLocaleString('en-IN')` + bilingual `aria-label`), mastery buckets + `StatRing` (`wonder-blocks.tsx:1469`), SkillTree subject roadmaps, BoardScore™ gauge.

**Deliberately absent from `/dashboard`** — level display, daily challenge, leaderboard, badges/achievements, coins, XP-to-next-level bar. Those live in `packages/ui/src/{engagement,xp,achievements,challenge,coins,leaderboard}/` and belong to other surfaces. Adding one here is a product decision, not a styling one.

**P2 rule:** the dashboard renders **server-computed** XP / streak / mastery only — see Learner Data Semantics above for exactly where the re-present / re-compute line falls, since "server-computed only" does not mean "no arithmetic". If a card ever needs client-side derivation, import from `packages/lib/src/xp-config.ts` (`XP_RULES`, `XP_PER_LEVEL = 500`, `calculateLevel`, `xpToNextLevel`, `getLevelName`). `packages/lib/src/xp-rules.ts` is a deprecated re-export shim — never add symbols there. **Never hardcode an XP number anywhere in a component.** Remember the daily cap (`XP_RULES.quiz_daily_cap = 200`, `xp-config.ts:47`) — the chip can stop moving mid-session, so no copy may promise that more effort earns more XP.

Design principles (concrete, not corporate):
- One primary action above the fold. `TodaysMission` owns it; nothing else competes for hero weight.
- Progress must be **visible and earned**. Never fabricate, round up, or "encourage" a number. The operational test is the denominator / sample-size rule in Learner Data Semantics.
- Celebrate the specific win ("3 chapters mastered in Science"), not generic praise ("Great job!"). Check the win is real first — a "3 mastered" celebration must survive the `due_for_review` precedence rule.
- No dark patterns: no fake urgency, no guilt copy, no infinite-streak shaming. A broken streak offers a comeback path, not shame.
  **Status: no comeback surface ships on `/dashboard` today.** `StreakBadge` renders a grey `🔥 0` at zero with no path and no copy (`wonder-blocks.tsx:1051-1073`), and `ComebackHook.tsx` was deleted in the 2026-08 orphan consolidation (it had been defined but imported by nothing). The principle stands (it matches Pedagogy v2's forgiving-streak intent), but anyone building this starts from scratch, under this rule and under the streak-semantics rule above.
- Quiet by default: a card with nothing to say self-hides (`PendingLinkApproval`, `ReviewsDueCard`) rather than occupying space with filler.

## Motion (P10-aware)

- **CSS-only is the DEFAULT and the preferred approach** for every dashboard card — reveal, stagger, hover, press, bar fill. Do not add a JS animation runtime to fade or slide a card.
- **`framer-motion` is permitted, conditionally** (CEO-approved 2026-08-09, with the premium UI stack: `lucide-react`, 24 Radix primitives, `class-variance-authority`, `react-hook-form` + `@hookform/resolvers`, `sonner`, `vaul`, `cmdk`, `embla-carousel-react`; install-only, zero imports as of that date). This supersedes the previous blanket ban stated here and in the CSS. Reserve it for genuinely complex interaction — gesture/drag, shared-layout (`layoutId`), orchestrated exit-on-unmount, spring physics. No dashboard card ships today that needs it.
- **Never in the shared import graph**: not in `apps/host/src/app/layout.tsx`, not in `packages/lib/src/AuthContext.tsx`, not in anything either graph pulls — that lands on all 209 routes. Per-card only, and behind `next/dynamic({ ssr: false })` where practical (the dashboard shell itself already uses that boundary).
- **P10 still gates it**: `CAP_SHARED_KB = 289`, `CAP_PAGE_KB = 260` in `scripts/check-bundle-size.mjs`. Reality check before you assume headroom — **101 of 209 routes already exceed `CAP_PAGE_KB`** (worst: **306.1 kB at `/(student)/progress/dashboard`**), and the gate passes only via a per-page ratchet against recorded baselines, not because pages are under the cap. A page with existing debt has zero free bytes.
- **`tailwindcss-animate` is installed but deliberately NOT registered** in `apps/host/tailwind.config.js`: it redefines 8 in-use classes — `.duration-150/200/300/500/700/1000`, `.ease-out`, `.ease-in-out` — as `animation-*` longhands emitted **after** `.animate-spin` / `.animate-pulse`, which would silently retime existing animations. Whoever registers it owns that collision.
- Reveal: `.os-mission` and `.os-reveal-card` run the `osReveal` keyframes (`packages/ui/src/globals.css:3923-3962`), staggered by `--reveal-i` (`calc(0.06s + min(var(--reveal-i,0),6) * 0.07s)`). Roadmap nodes stagger by `--stagger-i`, capped at 8.
- Tailwind animation utilities available (`apps/host/tailwind.config.js`): `float`, `scale-in`, `slide-up`, `fade-in`, `bounce-in`, `level-up`, `xp-burst`, `streak-pulse`, `mastery-fill`, `score-reveal`. Their keyframes live in `globals.css`; the config's `keyframes: {}` is empty by design.
- `prefers-reduced-motion`: global blanket at `globals.css:772-788` plus a dashboard-specific kill block at `globals.css:3964-3972`. The blanket's `*, *::before, *::after` rule (`globals.css:773-778`) already forces `animation-duration: 0.01ms !important` and `animation-iteration-count: 1 !important` on **everything**, so a one-shot reveal is collapsed automatically and needs no new entry. What genuinely needs an explicit `animation: none !important` is a **looping / infinite** animation (the `globals.css:779-786` list — `.animate-float`, `.animate-shimmer`, `.animate-spin-slow`, `.typing-dot`, `.streak-flame`, `.xp-rise`, `.animate-streak-pulse`). Add a looping class there; adding a one-shot class is harmless defense-in-depth, not a requirement. `AppShell.tsx:152-155` reads the media query but intentionally no-ops (`void reduced`) — CSS owns reduced-motion, not JS.

## Accessibility Floor (checklist for every new card)

- [ ] Bilingual `aria-label` on the `<section>`
- [ ] `aria-busy="true"` on the loading shell
- [ ] `role="status"` on error and empty panels
- [ ] `role="list"` + `role="listitem"` for repeated rows
- [ ] `role="progressbar"` + `aria-valuenow` / `aria-valuemin` / `aria-valuemax` + bilingual label on any bar or ring
- [ ] `aria-hidden="true"` on every decorative emoji, glyph, and pure-presentation bar
- [ ] `focus-visible:ring-2 focus-visible:ring-offset-2` on every interactive element
- [ ] Touch target ≥ 44px (48px preferred — `RoadmapNode` uses 48)
- [ ] Meaning is never colour-only (WCAG 1.4.1) — pair colour with icon + label + number, as `MasterySnapshot`, `BoardScoreWidget` (`STATUS_CFG` icons) and `RoadmapNode` already do

Known a11y gaps are catalogued in **Known Defects / Open Tickets** below (D5–D9). Fix them when you touch the surrounding code; don't document them as fine.

## Responsive

The dashboard uses **almost no Tailwind breakpoints**. Responsiveness is delegated to `AppShell` + CSS Grid in `globals.css`:

| Width | Layout |
|---|---|
| < 768px | single content column; bottom nav visible |
| ≥ 768px | 220px sticky rail appears (`--layout-max-rail`) |
| ≥ 1024px | 320px aside appears (`--layout-max-aside`); bottom nav hidden; grid becomes `rail / content / aside` |

Content is capped at `--layout-max-content: min(1240px, 100% - 2*var(--space-fluid-4))`. Spacing scales via the `--space-fluid-1…12` clamps, **not** breakpoints. Safe area via `--safe-bottom`. Header compacts on scroll past 24px to `--shell-header-h-compact: 44px`.

The only allowed breakpoint idioms today are `md:p-6` (hero padding) and `md:hidden` / `lg:hidden` on the mobile dupes of rail/aside content. **Why the dupes exist:** they mirror the two CSS breakpoints exactly. Getting them wrong previously double-rendered MasterySnapshot at 768–1023px (`lg:hidden` instead of `md:hidden`) and RevisionRail at 1024–1279px (`xl:hidden` instead of `lg:hidden`). `student-os-snapshot-inline` / `student-os-revision-inline` are markup hooks with **no CSS rule anywhere** — the Tailwind class is the sole control.

IA note: `/dashboard` is **not** a core bottom-nav tab. `packages/ui/src/navigation/nav-config.ts` has core tabs `/today`, `/learn`, `/foxy`, `/progress`; Dashboard sits in `MORE_ITEMS` and the sidebar "Home" entry. Don't design a card that assumes the student arrives here daily.

## Adding a New Dashboard Card

1. Decide the slot in the content column and the next `--reveal-i` index (currently 1 and 2 are taken; the stagger caps at 6).
2. Create it at `packages/ui/src/dashboard/os/<Name>.tsx` with `'use client'` and a docstring stating its data source and why it earns its place.
3. Build the shell with the card recipe: `<section className="os-reveal-card rounded-2xl p-4">` + inline token style + bilingual `aria-label`. **Respect the card-system boundary:** an OS dashboard **section shell** uses this recipe — never `primitives/Card`, never `PremiumCard`. A generic card or sub-component *inside* your card uses `packages/ui/src/ui/primitives/Card.tsx`. A new `PremiumCard` usage is never correct.
4. Take `isHi: boolean` and `studentId: string | undefined` as props. Never call `useAuth()` inside the card.
5. Implement all four states: loading (`aria-busy` + shape-matched `Skeleton` bones), error (`role="status"`, bilingual, no raw error text), empty (dashed border + CTA), loaded.
6. Gate the empty state on `loaded && !error` so a failed fetch can never read as good news.
7. Update `DashboardSkeleton` in `packages/ui/src/Skeleton.tsx` so first paint still matches the real layout — it uses the file-local `Bone` helper (`width` / `height` / `radius` / `className`), **not** the exported `Skeleton` primitive.
8. Walk the accessibility checklist above, line by line.
9. If the card animates anything new, add the class to the reduced-motion kill block at `globals.css:3964-3972`.
10. Decide the responsive story: rail (`md:hidden` dupe), aside (`lg:hidden` dupe), or content-only (no breakpoint at all — the default and the preferred answer).
11. Verify no hardcoded XP / score / level numbers; any derivation imports from `packages/lib/src/xp-config.ts`. Then walk **Learner Data Semantics**: is every number a permitted re-presentation (count / bucket / group / sum of an engine-decided field) rather than a re-computation? Is `accuracyPercent()` used where the student reads a score? Does every percentage show its denominator and clear `N = 5`? Does any empty-state copy blame the student for something that may be a content gap? If the answer to any of these is unclear, hand off to assessment before writing the copy — not after.
12. Mount it in `StudentOSDashboard.tsx`, run `npm run build` + `node scripts/check-bundle-size.mjs`, confirm the page stays under `CAP_PAGE_KB` and shared JS under `CAP_SHARED_KB`; add tests; then run the review chain.

## Known Defects / Open Tickets

Everything currently known-wrong on `/dashboard`, in one place so it stops getting rediscovered. **None of these is precedent.** Fix each when you are already in that file; none is authorised as a drive-by in an unrelated PR.

| # | Defect | Where | Owner |
|---|---|---|---|
| D1 | **BoardScore denominator mismatch.** The gauge stacks a **cross-subject** `overallPct` + `{totalPredicted}/{totalMax}` (`BoardScoreWidget.tsx:342-361`) directly above a **single-subject** confidence band (`:364-369`, `sel.confidence_band_low/high`) and a **single-subject** coverage bar (`:414-416`). A student reads "78% · Confidence Band: 61–72%" with no signal that the band has a different denominator. Violates the cross-subject-aggregate rule in Learner Data Semantics. **Open frontend ticket — do not fix as a drive-by; the correct resolution (scope the gauge to the selected subject vs. aggregate the band) is an assessment call.** | `BoardScoreWidget.tsx` | frontend (fix) / assessment (decides which number is right) |
| D2 | **`masteredPct` small-denominator ring.** `masteredPct` (`MasterySnapshot.tsx:125`) is denominated on *started* topics, so one started-and-mastered topic renders a hero **100%** ring. Violates the `N = 5` sample-size rule. | `MasterySnapshot.tsx` | frontend, under assessment's threshold |
| D3 | **Empty state attributes a platform gap to the student.** "No quizzes yet / Take a quiz to see your mastery here" (`MasterySnapshot.tsx:167-186`) also fires when `get_mastery_overview` returns `[]` because no `curriculum_topics` rows exist for the student's grade. | `MasterySnapshot.tsx` | frontend (copy) / backend (needs a distinguishing signal in the response) |
| D4 | **No comeback surface exists.** `StreakBadge` renders a grey `🔥 0` with no path or copy (`wonder-blocks.tsx:1051-1073`); `ComebackHook.tsx` was deleted 2026-08. The design principle mandates a comeback path that has never shipped. | `wonder-blocks.tsx` / new card | frontend, product decision on placement |
| D5 | No `<h1>` in the page shell; the greeting is a `<p>` and the only `<h1>` is inside `TodaysMission`. | `StudentOSDashboard.tsx` | frontend |
| D6 | Language toggle in `headerRail` sets `minHeight: 32` (`StudentOSDashboard.tsx:264`) — below the 44px touch floor. | `StudentOSDashboard.tsx` | frontend |
| D7 | BoardScore subject tabs use `role="tab"` (`BoardScoreWidget.tsx:379-408`) with no `tabpanel` / `aria-controls` pairing. | `BoardScoreWidget.tsx` | frontend |
| D8 | No `aria-live` region announces queue updates. | dashboard shell | frontend |
| D9 | No focus management after a retry or a subject-tab switch. | `BoardScoreWidget.tsx`, `StudentOSDashboard.tsx` | frontend |
| D10 | **`--accent-warm*` ambiguity is unresolved** — delete the indirection vs. re-document it as the intended warm channel. Full context in "Known ambiguity — `--accent-warm*`" above. Not a bug; an unmade decision. | `globals.css`, all warm-tint sites | frontend (decision) |
| D11 | **Mastery band thresholds diverge between two BKT writers** in the baseline migration (`bkt_update_personalized` `:1437-1441` vs `update_mastery_bkt` `:8481`). The band divergence itself is masked because `bucketForRow` tolerates unrecognised level strings — but that is *not* why there's no symptom. `bkt_update_personalized` is **orphaned** (no caller anywhere), so the right fix there may be deleting a dead writer, not reconciling bands. `update_mastery_bkt` is **live** (via `record_learning_event` → `recordLearningEvent()` → the learn-chapter page) and emits the **recognised** value `'not_started'` below `p_know 0.20`, which silently drops an attempted topic out of the `{total} topics` tally — so that chip can shrink. Full detail in Learner Data Semantics → band thresholds. | `supabase/migrations/00000000000000_baseline_from_prod.sql` | **assessment** — not a frontend fix |
| D12 | **Token outlier — `PendingLinkApproval.tsx`.** The one live dashboard card off the token system: raw `amber-*` / `gray-*` Tailwind classes and hardcoded `#FFFBEB`, `#16A34A`, `#EF4444`. Detail in "Two known outliers" above. | `PendingLinkApproval.tsx` | frontend |
| D13 | **Geometry outlier — `RevisionRail.tsx:39-42`.** `rounded-3xl p-4` with no `boxShadow` and no `os-reveal-card` / `--reveal-i` — matches neither the hero row nor the standard-card row of the recipe table. Detail in "Two known outliers" above. | `RevisionRail.tsx` | frontend |

## Rejection Conditions

Reject the change (or stop and hand off) when it:
- Hardcodes an XP, level, or score number instead of importing from `packages/lib/src/xp-config.ts` → hand to assessment.
- Recomputes mastery, accuracy, or predicted marks from raw components (`mastery_probability`, `attempts`/`correct_attempts`, `effective_mastery`, confidence bands, marks) without assessment sign-off → hand to assessment. Counting / bucketing / grouping engine-decided values is fine.
- Uses `masteryPercent()` (BKT posterior) where the student reads it as a score — the student-facing number is `accuracyPercent()` / `aggregateAccuracyPercent()`.
- Presents a Mastered count as monotonic, or labels a bucket total as curriculum size — `due_for_review` outranks `mastery_level`, and `not_started` is excluded from the tally.
- Renders a student-facing percentage without its denominator visible, or over fewer than N = 5 observations without suppressing it or marking it provisional.
- Renders a cross-subject aggregate adjacent to a per-subject uncertainty band or coverage figure (mixed denominators read as one fact).
- Ships an empty state that attributes the emptiness to the student when it may be a platform content gap.
- Conflates the daily streak with the weekly Curiosity Dive streak, or re-derives either client-side.
- Promises more XP for more effort without accounting for `quiz_daily_cap`.
- Ships a user-facing string with no Hindi counterpart (P7).
- Authors a `dark:` Tailwind class — dead CSS on this app.
- Imports `framer-motion` (or any heavy premium dep) into the root layout, `packages/lib/src/AuthContext.tsx`, or any module in those import graphs — one card must not cost all 209 routes (P10).
- Uses `framer-motion` for motion CSS already does, or ships it with no `next/dynamic({ ssr: false })` boundary where one was practical (P10).
- Registers `tailwindcss-animate` in `tailwind.config.js` without resolving the 8-class `.duration-*` / `.ease-*` collision (see Motion).
- Breaches `/dashboard`'s recorded P10 ratchet baseline, or raises a `CAP_*` constant without CEO approval.
- Uses a raw hex or a Tailwind palette colour class where a token exists.
- Omits the empty or error state, or renders raw error text to a student.
- Lets an empty state render on a failed or in-flight fetch.
- Encodes meaning by colour alone (WCAG 1.4.1).
- Has an interactive target under 44px.
- Adds a new `PremiumCard` usage, or a new `primitives/Card` shell for an OS dashboard **section** (recipe mismatch).
- Extends, imports, or copies a component from the dead list.
- Adds/reorders a card without shape-matching `DashboardSkeleton`.
- Reintroduces `ff_student_os_v1` flag-dispatch in `page.tsx`.

## Review Chain

frontend implements → **assessment** reviews if the card surfaces learner data (mastery, XP, scores, streak, predictions) against **Learner Data Semantics**, which assessment owns and has sign-off authority over → **quality** reviews token/a11y/bundle conformance → **testing** adds coverage. Invariants in scope: P7 (bilingual — see Bilingual), P10 (bundle budget — see Motion + step 12), P13 (no student PII in logs or analytics payloads — see Privacy), P14 (chain completeness). Data-contract or API-shape changes additionally require **backend**, and any API response-shape change flags **mobile**.
