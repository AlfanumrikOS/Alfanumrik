# Information Architecture — Alfanumrik Student Surface

Reference for navigation, routes, page hierarchy, screen maps, and journey design. Grounded in the live tree (verified 2026-08-06). Companion references: `experience-contract.md` (UI/interaction/Foxy) and `implementation-and-quality.md` (code/data/testing/DoD).

## 1. The experience hierarchy

The primary student navigation is ordered and stable. Keep these destinations across breakpoints; change the presentation, not the student's mental model.

1. **Today** — the prioritized, explainable learning queue
2. **Learn** — subjects, chapters, concepts, and concept sessions
3. **Practice** — adaptive, review, assignment, exam, and mock modes
4. **Progress** — mastery evidence, growth, habits, and next steps
5. **More** — notebook, saved items, achievements, settings, help, and safety

## 2. The navigation model (live, from `packages/ui/src/navigation/nav-config.ts`)

The live bottom-nav is **four tabs + one center FAB + one More sheet**, not five flat tabs:

| Slot | Route | Label (en / hi) | Source |
|---|---|---|---|
| 1 | `/today` | Today / आज ☀️ | `CORE_TABS[0]` (`nav-config.ts:13`) — carries the streak badge |
| 2 | `/learn` | Learn / सीखें 📚 | `CORE_TABS[1]` (`nav-config.ts:14`) |
| — | `/foxy` | Foxy / फॉक्सी 🦊 | `CORE_TABS[2]` (`nav-config.ts:15`) — **center FAB** (`isFab: true`) |
| 4 | `/progress` | Progress / प्रगति 📈 | `CORE_TABS[3]` (`nav-config.ts:16`) |
| 5 | More | More / और ☰ | More-sheet overflow (`MobileBottomNav.tsx:358-385`) |

**"Practice" is the de-facto 5th destination.** The Practice Center (`/practice`) is a More-sheet entry, flag-gated by `ff_practice_os_v1` (`nav-config.ts:29`). Design against the five-destination mental model (Today / Learn / Practice / Progress / More); implement through the flag-gated More entry until launch.

### Nav laws

- **One destination = one name = one icon.** A route may appear in multiple projections (bottom tabs, More, sidebar) but must wear the same label/icon in each (`nav-config.ts:6-11`). Do not reintroduce dual naming (e.g. `/progress` was once "Me" in tabs and "My Progress" in the sidebar — fixed).
- **Foxy is the FAB.** Never add a fifth flat tab.
- **"More" is a modal dialog**, not a tab: `role="dialog"` bottom sheet, scrim behind, Escape closes, focus to first button on open, `aria-expanded` on the trigger (`MobileBottomNav.tsx:49-59,108-117`).
- **Active state** uses segment-boundary matching — `isNavItemActive(pathname, href)` (`nav-config.ts:143-147`). `/learn/math/1` lights up `/learn`; `/me` never lights up `/memory` or `/mock-exam`.
- **Flag gating:** items with `flagName` hide until `isItemVisibleForFlags` is true (`nav-config.ts:149-156`). `/practice` (`ff_practice_os_v1`), `/exam-briefing` (`ff_test_os_v1`), `/revision` (`ff_revision_os_v1`), `/me` (`ff_me_v2`).
- **Grade gating:** `gradeMin` items (`/pyq`, `/mock-exam`, grade 9+) render a lock + "Grade N+" chip, not a disabled link (`MobileBottomNav.tsx:125-161`; `getItemLockForGrade` at `nav-config.ts:119-128`).
- **Conditional visibility:** `requiresUpcomingExam` hides Exam Sprint when no exam is on record (`useHasUpcomingExam`; `MobileBottomNav.tsx:74-79`).
- **Desktop sidebar** (`SIDEBAR_SECTIONS`, `nav-config.ts:59-112`) groups Home / Practice / Study / Account — same names/icons as mobile.
- **`/dashboard` is NOT a core tab.** It lives in More ("Home") and the sidebar Home section. Do not assume the student arrives on `/dashboard` daily — `/today` is the home tab.

### Role variants

`getCoreTabs` / `getMoreItems` / `getSidebarSections` (`nav-config.ts:158-212`) project teacher and guardian navs from `ROLE_CONFIG`. The student projections above are the defaults. Don't hard-code a nav list in a page — read from `nav-config`.

## 3. Route inventory (student surfaces)

Pages are client components under `apps/host/src/app/`. `(student)` is a pass-through route group (its `layout.tsx` adds no chrome); `/today`, `/foxy`, `/dive`, `/synthesis` are top-level. Navigation chrome mounts once at root via `GlobalAppLayout` (`packages/ui/src/navigation/GlobalAppLayout.tsx`).

### Core tabs + More

| Route | Surface | Notes |
|---|---|---|
| `/today` | Adaptive home | Flag-gated by `ff_today_home_v1` → redirects to `/dashboard` when off (`today/page.tsx:48-60`). Fetches `GET /api/v2/today`, renders `TodayHomeV2`. |
| `/dashboard` | Home (More) | The mastery-first card dashboard — see `student-dashboard-design` skill. |
| `/learn` | Subject & chapter browser | Subjects → Chapters → Read → Practice → Test; plan-based subject gating (free=2, starter=4, pro=all); locked subjects greyed with upgrade CTA, never hidden. |
| `/learn/[subject]/[chapter]` | Concept session | Chapter topics, questions, diagrams, learning-event recording; the main `/quiz` entry. |
| `/progress` | Progress tab | Mastery evidence, performance score, Bloom progression, knowledge gaps, learning velocity, streak/XP, pulse (flag-gated). |
| `/practice` | Practice Center | `ff_practice_os_v1`. Flag OFF → `notFound()`; ON → `PracticeCenter`. Quick-Start hands off to the existing `/quiz` engine. |
| `/quiz` | Quiz engine | The practice/exam runtime. Never modified as a drive-by. |
| `/foxy` | Foxy full-screen | Edge-to-edge AI tutor chat (see `experience-contract.md` §7). |
| `/me` | Profile hub (Wave B) | `ff_me_v2`; additive presentation over `/profile`, not a replacement. |
| `/profile` | Profile | Identity, parent link, downloads, language, GDPR/DPDP export/delete. |
| `/memory` | What Foxy remembers | Learner-memory transparency + erasure. |

### More destinations (Practice / Study / Account)

| Route | Surface | Gating |
|---|---|---|
| `/assignments` | Assignments | — |
| `/stem-centre` | STEM Lab | — |
| `/pyq` | PYQ Papers | `gradeMin: 9` |
| `/mock-exam` | Mock Exam | `gradeMin: 9` |
| `/exam-briefing` | Exam Briefing | `ff_test_os_v1` |
| `/revision` | Revision Center | `ff_revision_os_v1` |
| `/exam-prep` | Exam Sprint | `requiresUpcomingExam` |
| `/leaderboard` | Leaderboard | — |
| `/library` | Library | — |
| `/refresh` | Refresh | — |
| `/notifications` | Settings & Notifications | — |
| `/help`, `/support` | Help & Support, My Tickets | — |

### Adaptive / ritual journeys

| Route | Surface | Data |
|---|---|---|
| `/dive` + `/dive/history` | Weekly Curiosity Dive | Own forgiving streak object (missing one week does not reset; four consecutive does). Has `layout.tsx`/`loading.tsx`/`error.tsx` boundaries. |
| `/synthesis` | Monthly Synthesis | Monthly reflection; has `layout.tsx`/`loading.tsx`/`error.tsx` boundaries. |
| `/exams`, `/exams/mock/[paperId]`, `/exam-briefing` | Exam surfaces | — |
| `/quiz/ncert`, `/simulations`, `/missions`, `/reports`, `/rewards`, `/library`, `/hpc`, `/scan` | Supplementary | Present but lower-traffic; don't add to core nav. |

### Journey entry points

- Today queue items deep-link via `deepLinkToHref` (parsed from the resolver's `action.url`, never hand-built): `/quiz`, `/learn/science/3`, `/dive`, `/synthesis`, `/review` (301 → destination).
- The recommended-action slice: `sign in -> Today -> recommended action -> learning/practice session -> feedback -> updated evidence -> next action`.

## 4. Gating and redirect conventions

- Flag-gated pages read the flag client-side (`useFeatureFlags` / dedicated `use-*-os-flag` hooks). PENDING → skeleton (never 404 early, so a legitimately-ON user doesn't flash a 404); OFF → `notFound()` or `router.replace` to the existing equivalent; ON → the new surface (`(student)/practice/page.tsx` header; `today/page.tsx:48-60`; `me/page.tsx`).
- Feature flags live in `packages/lib/src/feature-flags.ts` and seed via `supabase/migrations/`. Never add a flag by editing a page only.
- API 404-as-feature-off is an established contract: learner-loop endpoints 404 → hooks return `null` → render nothing (`swr.tsx:189-207`).

## 5. Screen-map rules for designers

- Keep the primary nav stable across breakpoints; only the presentation changes (bottom tabs on mobile → sidebar on desktop).
- Make the current location and the next useful action obvious: active tab state, streak badge on `/today`, due counts where they exist.
- Never bury a primary journey behind the More sheet twice; a destination is either a core tab, a More entry, or a contextual CTA — not all three.
- Do not expose internal engine acronyms (IRT, SRS, CME, DKT/BKT) as labels; translate into useful reasons ("Review due", "Build this prerequisite", "Ready for a challenge").
