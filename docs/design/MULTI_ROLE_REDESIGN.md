# Alfanumrik — Multi-Role Design Audit & Redesign Proposal

_Author: design system review · 2026-05-11_

This is a persona-grounded analysis of how `Student`, `Parent`, `Teacher`, and `School` actually use Alfanumrik today, what's failing, and a concrete redesign that ties all four into one product instead of four products in a trench coat.

Companion file: [`multi-role-redesign-prototype.html`](./multi-role-redesign-prototype.html) — open in any browser to see the proposed design end-to-end.

---

## TL;DR — the one-paragraph diagnosis

The brand tokens are already excellent (warm cream `#FBF8F4`, burnt-orange `#E8581C`, Sora + Plus Jakarta Sans — _not_ Inter, _not_ generic SaaS blue). The failure is at the **system layer**: four roles ship four different design languages on top of those tokens. The student sees a busy gamified hub, the parent gets seven competing stats when she only wants one sentence, the teacher is dropped into a dark cockpit that visually disowns the rest of the product, and the school admin gets a clean exec dashboard with no drill-down. None of them share a chrome, an icon set, or a notion of "today." Fix the system, not the screens.

---

## 1. Current State — what shipped

### 1.1 Design tokens (already good, just under-used)

From `src/app/globals.css`:

| Token             | Value                              | Verdict                                                  |
| ----------------- | ---------------------------------- | -------------------------------------------------------- |
| `--bg`            | `#FBF8F4` (warm cream)             | ✅ Distinctive, not generic white                        |
| `--orange`        | `#E8581C` (burnt orange)           | ✅ Owns the brand                                        |
| `--gold` `--teal` | `#F5A623` `#0891B2`                | ✅ Solid secondary palette                               |
| `--font-display`  | Sora                               | ✅ Geometric, modern, _not_ Inter                        |
| `--font-body`     | Plus Jakarta Sans                  | ✅ Humanist, warm                                        |
| `--surface-1..3`  | `#FFFFFF`, `#F5F0EA`, `#EDE6DC`    | ✅ Cream depth scale                                     |
| `--text-1..3`     | `#1A1207`, `#4A3F2E`, `#7D7264`    | ✅ Warm-dark, not slate-gray                             |
| `mesh-bg`         | Radial gradient utility            | ✅ Available, used inconsistently                        |
| Noise SVG         | Inline data URI                    | ✅ Available, rarely applied                             |

**Verdict:** the foundation is editorial-warm and intentional. The problem is downstream.

### 1.2 What each role actually sees

| Role     | Entry                | Shell                                  | Bg color                  | Tone        | Chrome inconsistencies                                      |
| -------- | -------------------- | -------------------------------------- | ------------------------- | ----------- | ----------------------------------------------------------- |
| Student  | `/dashboard`         | Mobile-first, bottom nav, no sidebar   | `mesh-bg` (cream radial)  | Gamified    | Header carries 7 controls; emoji icons everywhere           |
| Parent   | `/parent`            | `ParentShell` w/ left sidebar          | **`#FFF8F0`** (own cream) | Reassuring  | Hand-coded styles, doesn't use `--surface-*` tokens         |
| Teacher  | `/teacher`           | No shell, full-bleed                   | **`#0B1120`** (dark!)     | Data-ops    | Completely disowns the warm brand                           |
| School   | `/school-admin`      | No shell, top bar + bottom nav         | `var(--bg)` cream         | Executive   | Uses `@` and `*` as ASCII icons                             |

Three different cream/dark backgrounds. Three different shell patterns. Four different icon vocabularies (real emoji on student/parent, monoline on teacher, ASCII glyphs on school, geometric on admin sidebar). No one would mistake this for one product.

### 1.3 Information density by role (current)

- **Student**: 1 hero CTA + streak + XP + coin chip + plan badge + stream chip + bell + avatar **above the fold**, then 5 accordions below. The "Continue learning" affordance — the single most important thing — is buried inside the hero.
- **Parent**: plain-language summary ✅, then 7 stat tiles, then BKT mastery ring, active bursts, insights, tips, nav buttons. ~9 sections of vertical scroll. The "if they took the exam today" headline is hidden inside Performance Scores.
- **Teacher**: 3 stat cards, struggling-students banner, daily challenge card, then 4-tab UI (Heatmap / Interventions / Alerts / Poll). The heatmap is gated behind a tab — it should _be_ the page.
- **School**: 4 KPI cards, mastery ring, quiz count, 7 quick actions, activity feed. Clean but no drill-down, no teacher leaderboard, no class comparison, no "needs your attention."

---

## 2. Personas — how each actually wants to navigate

Each persona has a different **cadence** of use, **mental model** of the product, and **5-second test** for success.

### 2.1 Student (8–18, daily user)

| Trait               | Value                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| **Cadence**         | 4–6× per week, 15–45 min per session                                        |
| **Mental model**    | A _journey_ — "where am I, what's next, what did I unlock"                  |
| **Top job**         | "Just tell me what to do today"                                             |
| **5-second test**   | Can they tap "start" within 5 seconds of opening the app?                   |
| **Cognitive load**  | Must be near-zero on landing; high tolerance for richness inside lessons     |
| **What backfires**  | Too many stats, too many CTAs, jargon (BKT, mastery probability)            |

**Navigation principle:** _one screen, one verb._ The dashboard should be 80% "next mission" and 20% "look how far you've come." Compete/leaderboard/quick-actions belong below the fold or in a secondary tab — not above the mission.

### 2.2 Parent (35–55, monthly check-in, anxious)

| Trait               | Value                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| **Cadence**         | 2–6× per month, 3–8 min per session                                          |
| **Mental model**    | A _report card_ — "is my child okay?"                                       |
| **Top job**         | Get a one-sentence answer to "is my child okay this week?"                  |
| **5-second test**   | Can they get the answer without scrolling?                                  |
| **Cognitive load**  | Zero on landing. Deep on demand.                                            |
| **What backfires**  | Jargon, gamification (XP/streak don't mean anything to parents), data overload |

**Navigation principle:** _editorial summary first, drill-downs second._ The page should look more like a magazine pull-quote than a dashboard. XP/streak/coins should be _absent_ from the parent surface entirely.

### 2.3 Teacher (28–55, weekly classroom user, time-starved)

| Trait               | Value                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| **Cadence**         | 3–5× per week, 5–20 min per session, often between classes                  |
| **Mental model**    | A _classroom roster_ — "who needs me, who's coasting, who's ahead"          |
| **Top job**         | Identify the 3–5 students who need an intervention this week                |
| **5-second test**   | Can they spot at-risk students without clicking a tab?                      |
| **Cognitive load**  | High tolerance for density (think air-traffic-control screen)               |
| **What backfires**  | Tabs that hide the roster; aesthetics that don't fit the rest of the product |

**Navigation principle:** _the heatmap is the page._ The 4-tab UI buries the most useful object behind navigation. Make the classroom map the canvas, push polls/assignments/alerts to surrounding rails.

### 2.4 School Admin / Principal (40–60, weekly use, KPI-oriented)

| Trait               | Value                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| **Cadence**         | 1–3× per week, 5–15 min                                                      |
| **Mental model**    | An _institutional dashboard_ — "is the school healthy"                       |
| **Top job**         | Catch problems before parents notice them; brag about wins                  |
| **5-second test**   | Can they tell "is anything on fire" without scrolling?                      |
| **Cognitive load**  | Moderate density; needs comparisons (class vs class, teacher vs teacher)    |
| **What backfires**  | Stats without context (a number is useless without a trend)                 |

**Navigation principle:** _KPI + trend + alerts + comparison._ Today's school page has the KPI but is missing trend, alerts, and comparison.

---

## 3. Cross-cutting failures (what to fix at the system layer)

1. **Three background colors.** Pick one cream, apply everywhere. Kill the parent's `#FFF8F0` and the teacher's `#0B1120`. _Warm light_ is the brand; data-density is achieved with type and grid, not with dark mode.
2. **No shared shell.** Each role hand-rolls its chrome. Introduce one `<AppShell>` component with three variants:
   - `mobile-bottom-nav` (student, parent on mobile)
   - `sidebar-left` (parent, teacher, school on desktop)
   - `command-bar-top` (teacher classroom view)
3. **Icon system.** Replace the emoji + ASCII + monoline mishmash with **one** monoline geometric set (e.g., Phosphor or Tabler). Keep emoji only for student-facing micro-copy ("nice work 🎉"), not for chrome.
4. **No shared concept of "today."** Each role reinvents what "today" means. Make `Today` a real object on the StudentState model (already half-built via the unified-state-architecture PRs from last week) and project it to each role with role-specific copy.
5. **Brand voice fractures by role.** Student is gamified, parent is reassuring, teacher is data-ops, school is HR. Unify on **editorial warmth** — direct, plain-language sentences with a touch of weight. Save the gamification for inside lessons, not on chrome.
6. **No accent typography.** Sora and Plus Jakarta are workhorses but don't carry editorial gravitas. Add **one** serif (Fraunces is a perfect match for Sora) for the one moment per page that deserves weight — the parent's summary sentence, the student's "today's mission" headline, the teacher's class name, the school's KPI numbers.

---

## 4. The redesign — Editorial Atlas

A single aesthetic direction that fits all four roles:

- **Canvas:** warm cream `#FBF8F4` everywhere. No dark mode anywhere.
- **Ink:** warm-dark `#1A1207` for primary type; never pure black.
- **Accent:** burnt orange `#E8581C` used sparingly — one CTA, one chip, one heading underline per screen. Never gradient soup.
- **Sub-accent:** deep teal `#0F2A2E` for editorial weight and contrast (different from the existing `--teal` which is brighter).
- **Type:**
  - **Fraunces** — display headlines, the one editorial moment per page
  - **Sora** — UI headings, chips, buttons
  - **Plus Jakarta Sans** — body, metadata
- **Motion:** stagger-reveal on load, soft lift on hover, no spinners. Every motion is 200–280 ms with `ease-out`.
- **Iconography:** Phosphor (regular weight). No emoji in chrome.
- **Grid:** 12-column with deliberate asymmetry. Student is 7/5, parent is 8/4, teacher is 3/9, school is 6/6 with a sidebar.
- **Cards:** off-white `#FFFFFF` on cream, with a `1px solid rgba(0,0,0,0.06)` border and `0 1px 4px rgba(0,0,0,0.04)` shadow. No glass effects, no neumorphism.
- **Numbers:** Fraunces tabular-num for KPI displays — gives the page weight that Sora can't.

The prototype file ships all four redesigned landings. The full IA per role is captured there.

---

## 5. New Information Architecture per role

### 5.1 Student — "What now?"

**Above-fold (zero scroll):**
1. Thin brand bar with name + streak chip (compact, no plan badge unless near limit)
2. **Today's Mission** card — full-width, editorial: serif headline "Newton's Third Law", subhead "Physics · Chapter 8", primary CTA "Start lesson"
3. **The Atlas** — a small SVG map of the student's chapter graph, "you are here" + 2 nearby unlocks
4. Pinned Foxy chat affordance (corner FAB)

**Below-fold (one tap):**
5. Compete — leaderboard rank, weekly challenge
6. Recent wins — 3 chapters mastered this week
7. Quick actions — scan, profile, billing, notifications

**Removed from the dashboard:**
- Coin balance (move to profile)
- Stream chip (move to profile, only show on first visit picker)
- Subject picker modal (replace with a quieter inline "change focus" link)
- Plan badge (only show when within 3 days of limit or trial expiry)

### 5.2 Parent — "How's my child?"

**Above-fold:**
1. Child name pill + grade chip (small, top-left)
2. **One sentence in Fraunces 28-32px:** "Aanya is having a strong week in math, but needs attention in English. She's been active 5 of the last 7 days."
3. A subtle 8-week trend line (full-width, no axes, just shape)
4. **Three drilldowns** as quiet cards: Subjects · Focus areas · Suggested next step

**Below-fold:**
5. Calendar / upcoming exams
6. Reports archive
7. Foxy parent-tips

**Removed entirely:**
- XP, coins, streak (parents don't speak this language)
- BKT mastery ring (replaced by "Subjects" drilldown)
- "Active learning adventures" (move to child's profile)
- The 7-stat grid

### 5.3 Teacher — "Who needs me?"

**The page IS the classroom map.** No tabs.

**Layout (desktop-first):**
- **Left rail (3/12):** at-risk list with avatars; click → student detail drawer
- **Center (6/12):** the heatmap, dense, scrollable, sortable
- **Right rail (3/12):** "today's actions" — Launch poll, Assign quiz, Message parent. Live poll card slides in when active.

**Top bar:** class picker (visible, not buried in `dash.classes[0]`), subject filter chips, week selector.

**Bottom strip:** thin status bar — total students, active today, last sync time.

**Removed:**
- Dark cockpit aesthetic — adopt the warm cream
- 4-tab UI — flatten to one canvas with rails
- "Daily Challenge" card — fold into right rail as an action chip

### 5.4 School Admin — "Is the school healthy?"

**Layout:**
- **Top: KPI row.** 4 numbers, each with a sparkline. Numbers in Fraunces tabular-num. (Students, Teachers, Active today, Avg mastery.)
- **Below KPI: two columns.**
  - **Left (6/12):** Mastery trend chart (12-week) + class comparison (top 3 / bottom 3 classes side by side)
  - **Right (6/12):** "Needs your attention" — alerts; teacher of the week; recent enrollments
- **Below: activity stream**, full width.

**Added:**
- Class comparison (currently missing)
- Teacher leaderboard (currently missing)
- "Needs your attention" alerts (currently missing)
- Sparklines on KPIs (numbers without trend are dead)

**Fixed:**
- Replace `@` and `*` ASCII icons with proper monoline icons
- Quick actions move to a sidebar, not the body

---

## 6. Migration plan

Three phases, each independently shippable.

**Phase D1 — Design tokens hardening (week 1).** Add `--ink`, `--accent`, `--accent-quiet`, `--paper`, `--cream`, `--cream-deep`; add Fraunces via `next/font`; ship one `<EditorialHeadline>` primitive. No visible UX change.

**Phase D2 — Shell unification (week 2).** Introduce `<AppShell variant="…">` with three variants. Migrate parent and teacher first (they have the biggest drift). Kill teacher's dark mode in the same PR. Behind feature flag `ff_unified_shell_v1` (default off, flip per tenant).

**Phase D3 — Per-role IA (weeks 3-5).** One role per week:
- Week 3: Parent (smallest blast radius, biggest delight win)
- Week 4: Teacher (kill dark mode, unify with brand)
- Week 5: Student (most surface area, ship last so parent/teacher have already validated the system)

School admin already uses the tokens correctly — add KPI sparklines + class comparison + alerts in week 5 alongside student.

Each phase is reversible via flag. None of the phases touch the unified-state-architecture PRs that just merged.

---

## 7. Open questions for Pradeep

1. **Stream-picker timing** — should it move to onboarding (one-time) or stay as a blocking modal on the student dashboard? Currently jarring; recommend onboarding.
2. **Parent's plain-language summary** — should it be LLM-generated (via the agent mesh) or template-based? Recommend template-first (deterministic, no cost), upgrade to mesh L2 in v2.
3. **Teacher dark mode** — there may be a teacher demographic that prefers dark for long classroom monitoring. Recommend audit the analytics before killing; if it's <5% of teacher sessions, kill it cleanly.
4. **School comparison data** — does the school admin want benchmarking against _other schools on Alfanumrik_? That's a much bigger data product question and a sales angle.

---

## 8. What the prototype shows

Open [`multi-role-redesign-prototype.html`](./multi-role-redesign-prototype.html) in any browser. Use the role chips at the top to switch between Student / Parent / Teacher / School. Each role's landing is the proposed redesign, with the existing brand tokens, the editorial type system, and the per-persona IA from §5.

The prototype is self-contained — no build, no dependencies beyond Google Fonts (Fraunces, Sora, Plus Jakarta Sans).
