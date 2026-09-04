# 06 — Alfanumrik Design System (proposal, Gate 1)

Purpose: replace six token systems, six shells and ~500 component variants (01-inventory §1b) with one source of truth. Everything below is a specification; no product code is changed at Gate 1.

## 1. Tokens — one CSS-variable file, one Tailwind mapping

Source of truth: `packages/ui/src/tokens.css` (new, replaces the six `:root`/`[data-*]` blocks in `globals.css`) + `apps/host/tailwind.config.js` `theme.extend` referencing only `var(--*)`. Dark theme is a real `[data-theme="dark"]` block (today's selector points at a never-written value). Cosmic/Atlas/Momentum/welcome-v2 modules are retired; white-label overrides only `--brand-*`.

### 1.1 Colour (light / dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand-primary` | `#E8581C` (current burnt orange) | `#F27A45` | identity, primary action fill |
| `--brand-secondary` | `#7C3AED` | `#A78BFA` | accents, Foxy |
| `--on-brand` | `#FFFFFF` (AA on primary ≥ 4.6:1 only on the darkened `--brand-primary-strong #C2410C`; plain primary fails at 3.6:1 — so filled buttons use `-strong`) | `#0B0B0C` | text on brand fills |
| `--bg-canvas` / `--bg-surface` / `--bg-raised` / `--bg-sunken` | `#FBF8F4` / `#FFFFFF` / `#FFFFFF` / `#F3EEE7` | `#0F1113` / `#16191C` / `#1D2126` / `#0B0D0F` | page, cards, sheets, wells |
| `--fg-1` / `--fg-2` / `--fg-3` / `--fg-disabled` | `#111827` / `#4B5563` / `#6B7280` / `#9CA3AF` | `#F3F4F6` / `#C7CCD3` / `#9AA3AE` / `#5B6470` | text hierarchy (all ≥ 4.5:1 on surface) |
| `--border` / `--border-strong` / `--focus` | `#E5E7EB` / `#D1D5DB` / `#2563EB` | `#2A2F36` / `#3A414A` / `#60A5FA` | |
| `--success` / `--success-strong` / `--success-bg` | `#16A34A` / `#166534` / `#ECFDF5` | `#4ADE80` / `#86EFAC` / `#052E16` | state |
| `--warning` / `-strong` / `-bg` | `#D97706` / `#B45309` / `#FFFBEB` | | |
| `--danger` / `-strong` / `-bg` | `#DC2626` / `#B91C1C` / `#FEF2F2` | | |
| `--info` / `-strong` / `-bg` | `#0891B2` / `#0E7490` / `#ECFEFF` | | |
| `--mastery-0..4` | `#D1D5DB`, `#F59E0B`, `#F97316`, `#22C55E`, `#15803D` | | not started / beginner / developing / proficient / mastered — the 5 named bands from `concept_mastery.mastery_level` |
| `--xp`, `--streak` | `#F59E0B`, `#EF4444` | | gamification only |

Text tokens are paired with the surface they sit on (`--on-brand`, `--fg-*`); a lint rule forbids `#hex` in TSX and `style={{color}}`.

### 1.2 Type scale (fluid, one family)

Family: `Sora` for display/headings and numbers (tabular), `Plus Jakarta Sans` for UI/body, `Noto Sans Devanagari` fallback appended to both — the three the app already self-hosts; Inter/Roboto/Fraunces/Space Grotesk/Mukta/Hind are dropped (9 → 3 families; ~284 KB font bytes on `/` today).

| Token | clamp() | Line-height | Use |
|---|---|---|---|
| `--text-xs` | 12→13 px | 1.4 | meta, badges |
| `--text-sm` | 14→15 | 1.45 | table cells, secondary |
| `--text-md` | 16→17 | 1.5 | body, inputs (never below 16 px on mobile) |
| `--text-lg` | 18→20 | 1.4 | card titles |
| `--text-xl` | 22→26 | 1.25 | page titles |
| `--text-2xl` | 28→36 | 1.15 | dashboard headline numbers |
| `--text-display` | 36→52 | 1.05 | marketing only |

Tailwind exposes exactly these as `text-xs…text-display`; `text-[Npx]`, inline `fontSize` and `.text-fluid-*` are removed by codemod.

### 1.3 Spacing, radii, elevation, motion

- Spacing: 4-pt scale `--space-1..12` (4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96). Touch: `--tap-min 44px`, `--tap-comfort 48px`.
- Radii: `--radius-sm 6`, `-md 10`, `-lg 14`, `-xl 20`, `-pill 999`.
- Elevation: `--shadow-1` (cards) `0 1px 2px rgb(0 0 0/.06)`, `--shadow-2` (popovers) `0 4px 12px rgb(0 0 0/.10)`, `--shadow-3` (sheets/modals) `0 12px 32px rgb(0 0 0/.16)`; dark uses border + surface step instead of shadow.
- Motion: `--dur-fast 120ms`, `--dur-base 200ms`, `--dur-slow 320ms`; `--ease-standard cubic-bezier(.2,0,0,1)`; all entrance reveals honour `prefers-reduced-motion` and **never gate initial visibility** (content is visible without JS; motion is additive).
- Layout: `--shell-rail 240px` (desktop), `--shell-rail-collapsed 64px`, `--shell-bottom 60px` (mobile), safe-area insets.

## 2. Component library (one implementation each, `packages/ui/src/kit/`)

| Component | Contract (props) | Replaces (count from census) |
|---|---|---|
| `Button` | `variant: primary|secondary|ghost|danger`, `size: sm|md|lg`, `loading`, `icon`, `href` | 12 impls; `wonder-blocks` Button (59 importers) is the migration seed |
| `IconButton` | 44 px min target, `label` required | |
| `Input`, `Textarea`, `Select`, `Combobox`, `Checkbox`, `Radio`, `Switch`, `Field` (label+hint+error) | controlled, `error`, `hint`, `required`, `size`; RHF-compatible | 18 + 11 + 15 |
| `Table` | columns config (sortable, width, align, render), server pagination (`page`, `pageSize`, `total`), row selection + `BulkBar` actions, sticky header, row density, CSV export hook, empty/loading/error states built in | 12 tables; `admin-ui/DataTable` (24) seed; **Pagination 0 → 1** |
| `Card`, `StatCard` (value, delta, trend, tabular figures) | | 77 + 18 |
| `Dialog` (modal), `Sheet` (side/bottom), `Drawer`, `ConfirmDialog` (typed confirm for destructive) | Radix Dialog-based, focus trap, ESC, mobile → bottom sheet automatically | 42 |
| `Toast` (`useToast`) + `Banner` (inline persistent) | one provider in root layout | 17 |
| `Tabs`, `SegmentedControl` | URL-synced (`?tab=`) | 24 |
| `Badge`, `Chip` (filter), `MasteryBadge` (5 tokens) | | 28 |
| `Breadcrumb` | from route config | 1 |
| `Skeleton` (`Skeleton.Text`, `.Card`, `.TableRows`) | must match final layout | 72 |
| `EmptyState` (`icon`, `title`, `body`, `action`) | | 8 |
| `ErrorState` (`retry`, `reportId`) + one `error.tsx` template that renders it | | 35 |
| `Avatar`, `Progress` (bar/ring) | | 4 + 17 |
| `CommandPalette` (⌘K / search bar) | server endpoint `/api/search?q&scope`, role-scoped result groups (students, teachers, schools, chapters, questions, worksheets), keyboard nav, recent items | **0 → 1** |
| `ChartFrame` | wraps Recharts (already in deps) with tokens, loading/empty/error, responsive height | admin-ui charts ×3 |
| `AppShell` (§3), `Topbar`, `Rail`, `BottomNav`, `MoreSheet`, `ScopeSwitcher` | | 47 nav/shell impls |

Rules: kit components accept `className` for layout only; no colour/size overrides. ESLint: forbid importing `wonder-blocks`, `ui/primitives`, `cosmic`, `admin-ui` outside `kit/` after migration; forbid raw `<button>` in `apps/host/src/app`.

## 3. One app shell, five nav configs

```ts
// packages/ui/src/kit/shell/nav.config.ts — the ONLY nav data structure
export type NavItem = { id: string; href: string; label: string; labelHi: string; icon: IconName;
  match?: string[];            // alt hrefs that keep it active
  flag?: string;               // feature flag gate (item hidden when off)
  permission?: string;         // RBAC code; hidden when the session lacks it
  badge?: 'streak' | 'inbox' | 'alerts' };
export type RoleNav = { role: Role; home: string; primary: NavItem[] /* ≤5 */; secondary: NavItem[] /* rest, grouped */;
  scope?: 'school' | 'class' | 'child' };  // shows the ScopeSwitcher in the top bar
export const NAV: Record<Role, RoleNav> = { student: …, parent: …, teacher: …, school_admin: …, super_admin: … };
```
`AppShell` reads `NAV[role]`, renders: desktop rail (primary + grouped secondary), tablet icon rail, mobile bottom bar (primary ≤5, "More" sheet for secondary), top bar with breadcrumb, `ScopeSwitcher` when `scope` is set, `CommandPalette` trigger, language toggle, account menu. It mounts once in the root layout for every role; `/foxy` keeps the bottom bar (current behaviour) and hides the rail via a route option, not a separate shell.

### Information architecture (≤7 top-level per role; one obvious path to each Phase-4 core job)

| Role | Primary (mobile bar) | Secondary (More / rail groups) | Core-job path |
|---|---|---|---|
| Student | Today · Practice · Foxy · Progress · More | Learn (Subjects, NCERT Library, Revision, PYQ), Exams (My exams, Mock tests, Assignments), Play (Leaderboard, STEM Lab, Dive/Synthesis when flagged), Account (Profile, Plan & billing, Reminders, Help) | Today → next action; Practice → quiz; Foxy → doubt; Progress → mastery |
| Parent | Home (child switcher) · Reports · Messages · Billing · More | Children & linking, Attendance & calendar, Consent, Notifications, Profile, Support | Home → this week's letter; Messages → teacher thread |
| Teacher | Home (class switcher) · Students · Assignments · Reports · More | Classes, Grade book & submissions, Attendance, Worksheets, Messages, Profile | Assignments → create/assign → grade |
| School admin | Overview (school switcher) · People · Classes · Reports · More | Import & invites, Exams, Content, Billing & seats, Settings (branding, modules, RBAC, API keys, audit log), Escalations, Principal AI | People → import CSV → invite |
| Super admin | Schools · Users · Money · Content & AI · Platform · More | Schools (institutions, onboarding, intelligence); Users (all roles, view-as); Money (payments, subscriptions, invoices, entitlements — one table with filters); Content & AI (question bank, curriculum + versions, RAG index + re-index, Foxy quality, misconceptions); Platform (health, observability, flags, cron, logs); Support | Users → search → view-as (audited) |

## 4. The four states — contract for every list and detail view

| State | Rule |
|---|---|
| Loading | `Skeleton` matching the final layout, rendered by `loading.tsx` (server) and by the kit component while `isLoading`; never `return null`. |
| Empty | `EmptyState` with one primary action relevant to the role (e.g. teacher assignments: "Create your first assignment"; parent reports: "Link a child"). Copy bilingual. |
| Error | `ErrorState` inline with retry and a request id; route-level `error.tsx` is the single template; API errors carry `{ code, message, requestId }` via `withRoute()`. |
| Success | Data in the kit `Table`/`Card`; destructive actions via `ConfirmDialog`; mutations show `Toast` with undo where reversible. |

## 5. Accessibility

WCAG 2.1 AA contrast enforced by tokens (every `--fg-*`/`--on-*` pairing has a stored ratio; CI runs axe on the kit stories). Keyboard: every interactive kit element focusable with visible `--focus` ring (2 px, offset 2); `Dialog`/`Sheet` trap focus; `Table` rows arrow-navigable; `CommandPalette` fully keyboard-driven. Touch targets ≥44 px (`--tap-min`) on all controls; bottom bar 48 px. Reduced motion honoured globally. `lang` attribute switches with the language toggle; Hindi strings use Devanagari fallback fonts.

## 6. Performance budget (mid-range Android, 4G)

| Metric | Target | Today (perf-results.json) |
|---|---|---|
| LCP (throttled 1.6 Mbps / 150 ms RTT / 4× CPU) | **< 2.5 s** public, < 3.0 s authenticated first screen | 5.1–13.1 s public |
| FCP | < 1.5 s | 1.7–5.8 s |
| JS transfer per route | **≤ 180 KB** public marketing, **≤ 220 KB** app routes (first-load, gzip); shared layout chunk ≤ 200 KB (current gate 297 KB, baseline routes 295–311 KB) | 327–510 KB |
| Fonts | ≤ 90 KB (2 families × 2 weights, `font-display: swap`, subset Latin + Devanagari) | 284 KB on `/` |
| Above-the-fold | server-rendered, visible with JS disabled; no opacity-gated hero | hero `opacity:0` until observer |
| CLS | < 0.05 | 0 (already good) |

Enforced by `scripts/check-bundle-size.mjs` caps lowered stepwise per step in 08-build-plan, plus a Playwright vitals job (the probe used in this audit) in CI.

## 7. Vernacular readiness

All UI strings move to `packages/lib/src/i18n/<locale>.json` (`en-IN`, `hi-IN` first) accessed through `t('key')` with ICU plurals; the `isHi ? a : b` pattern (385 files) is codemodded into keys. Layout rules: no fixed-width labels, min-height not fixed-height rows, `text-md` never below 16 px, Devanagari line-height +0.1. Data strings already have `_hi` columns (`curriculum_topics.title_hi`, `question_hi`, `explanation_hi`, `subjects.name_hi`) and `title_ta/te/bn/mr` for later languages.

## 8. Low-fidelity wireframes

### 8.1 Student home (mobile)
```
┌──────────────────────────────┐
│ ☰  Today · Class 8 · EN|हिं  🔍│  top bar: scope, lang, search
├──────────────────────────────┤
│ 🔥 Streak 4   ⭐ 320 XP        │  StatCard row (tabular figures)
│ ┌──────────────────────────┐ │
│ │ Next: Light — Reflection │ │  ONE primary action card
│ │ 8 questions · 6 min  ▶   │ │
│ └──────────────────────────┘ │
│ Due today  (3)               │  list rows → Practice
│ ▸ Revise: Combustion  ●●○○○  │  MasteryBadge tokens
│ ▸ Quiz: Cells         ●●●○○  │
│ Ask Foxy about today's topic │  secondary CTA
├──────────────────────────────┤
│ ☀ Today ⚡Practice 🦊Foxy 📈 ⋯ │  bottom bar (5 slots, 48px)
└──────────────────────────────┘
```
### 8.2 Parent home (mobile)
```
│ ◀ Aarav ▾ (child switcher)  🔍│
│ This week's letter  (Sun 7am) │  weekly digest card — status: sent/pending
│ Mastery ●●●○○  Time 2h10  Foxy 14 │ 3 StatCards
│ Subjects: Maths ▂▃▅  Science ▂▂▃ │ ChartFrame sparklines
│ Messages from teacher (1 new) │  → Messages
│ Home · Reports · Messages · Billing · ⋯ │
```
### 8.3 Teacher home (desktop)
```
┌ rail ───┬───────────────────────────────────────────────┐
│ Home    │ Class 8-B ▾   [🔍 Search students, chapters…] │
│ Students│ At-risk (4)  Due assignments (2)  Avg mastery │  StatCards
│ Assign. │ ┌ Table: Student | Mastery | Last active | ⋯ ┐│  sortable, paginated
│ Reports │ │ ☐ Aarav   ●●●○○   2 d     [Assign][Note] ││  BulkBar on select
│ More ▾  │ └──────────────────────────────────────────┘│
```
### 8.4 School dashboard (desktop)
```
│ Greenfield School ▾ (scope) · 412/500 seats · Plan: Basic │
│ School mastery 61% ▲2  Active students 7d 288  Teachers active 18/22 │
│ Classes at risk (3)  [Table: Class | Mastery | Active | Teacher | →] │
│ Import & invites ▸   Reports ▸   Escalations (1) ▸ │
```
### 8.5 Super-admin console (desktop)
```
│ Alfanumrik Admin   [🔍 ⌘K: users, schools, questions, flags]  Env: prod │
│ Schools · Users · Money · Content & AI · Platform · Support │
│ Health strip: API ✓  DB ✓  Edge ✓  Razorpay ✓  Cron ✓ (last run 02:50) │
│ Table (Schools): Name | Seats | Plan | Mastery | Health | Actions │
```
### 8.6 Global search (⌘K) and bulk import flow
```
┌ Search… "aar" ───────────────────────┐   1 Download template (CSV/XLSX)
│ Students  Aarav Singh · 8-B          │   2 Upload file → column mapping (auto + manual)
│ Chapters  Ch.4 Light (Sci 8)         │   3 Validation preview: 120 rows · 3 errors ▾
│ Questions #Q-1932 "refraction…"      │        row 17 grade "7th" → expected "6".."12"
│ Actions   Create assignment ↵        │   4 Commit → progress → summary + error-rows.csv
└──────────────────────────────────────┘   5 Invite emails queued (Mailgun) · audit row
```
