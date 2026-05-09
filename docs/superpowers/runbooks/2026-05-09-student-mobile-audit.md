# Student Pages — Mobile Audit (2026-05-09)

Code-level audit completed by Plan 4 Task 9. Manual-QA columns left empty for whoever runs the staging walkthrough on real devices.

Audit scope: `/dashboard`, `/foxy`, `/progress`, `/leaderboard`, `/exams` on branch `feat/student-quality-upgrade` (working tree at the time of the audit, including wave 1-3 changes).

## Setup (for manual QA)

1. Login as a student in staging.
2. Use Chrome DevTools device toolbar (or real device) at 360px, 768px, 1280px.
3. For each (page, breakpoint), tick if pass. Note specific failure if not.

## Code-audit findings

| Page | Responsive class count | BottomNav | Risks identified |
|---|---|---|---|
| /dashboard | 1 (`grid-cols-2`) | yes | All grids ≤ 2 cols, modal uses `w-full max-w-sm` (mobile-safe), wrapped in `app-container`. No code-clear bugs. Manual-QA: hero card + nudge stack at 360px. |
| /foxy | 13 (`sm:`, `md:`, `lg:hidden`, `xl:flex`) | yes | **P1 (flag-only)**: between 1024–1279px the `xl:flex` topic sidebar is hidden AND the `lg:hidden` topic bottom-sheet is hidden — possible no-access gap to chapter list. Not fixed inline because the trigger lives in `_components/MessageInput.tsx` (foxy decomposition is settling, off-limits). Verify on iPad portrait (768px) and iPad landscape (1024px). Header uses `text-[10px]` and `text-[8px]` for secondary stats — flag for legibility. |
| /progress | 1 (`sm:grid-cols-2`) | yes | Mobile-first grid (`grid-cols-1 sm:grid-cols-2`), explicit `min-h-[44px]` on Lab Notebook link, sparkline `w-[120px]` is safe in row layout. Recharts via `ResponsiveContainer width="100%"`. No code-clear bugs. Manual-QA: bloom heatmap (6 cells flex-1 at 360px ≈ 55px each — labels via title only). |
| /leaderboard | 0 | yes | grid-cols-2 titles tiles + `app-container` wrapper. **P3 (flag-only)**: BarChart top-10 at `height={200}` with 10 student names on 360px width — X-axis labels almost certainly truncate / overlap. Recharts `ResponsiveContainer` will reflow width but not label density. Consider `interval={1}` or rotated labels — but only after manual QA confirms unreadable. |
| /exams | 0 | yes | Two `grid-cols-3` (exam types, subject pickers) with `p-3` tiles → ≈110px wide tiles at 360px, touch target ≥56×56 (passes 44×44). **P3 (flag-only)**: tile labels use `text-[10px]` — below recommended 12px secondary minimum, but acceptable for icon+label tiles. |

Responsive class counts above are from `grep -oE '(md:|lg:|sm:|max-sm:|xs:|xl:)' <file> | wc -l`.

## Manual-QA matrix

|  | 360px | 768px | 1280px |
|---|---|---|---|
| /dashboard | ☐ | ☐ | ☐ |
| /foxy | ☐ | ☐ | ☐ |
| /progress | ☐ | ☐ | ☐ |
| /leaderboard | ☐ | ☐ | ☐ |
| /exams | ☐ | ☐ | ☐ |

## What to flag during manual QA

- Sidebar/nav doesn't overlap content at any breakpoint
- Touch targets ≥44×44 px (no tiny `text-xs` interactive elements)
- No horizontal scroll (except inside intentional `overflow-x-auto` tables)
- Text readable (≥14px body, ≥12px secondary) — known small text: foxy header `text-[8px]` chat-usage, exam tile `text-[10px]`, leaderboard title meta `text-xs`
- Tables scroll horizontally rather than break layout
- Recharts (progress sparkline + leaderboard top-10 bars) reflow correctly at 360px — leaderboard X-axis label readability is the open risk
- BottomNav doesn't obscure last interactive element on the page (all 5 use `pb-nav`)
- **Foxy 1024–1279px specifically**: confirm there's a way to pick chapter / topic at iPad-landscape width. If not, the foxy-decomposition owners must fix.

## Severity for findings

- P0: layout breaks (page unusable at breakpoint)
- P1: scroll appears horizontally where it shouldn't
- P2: touch target <44px on a primary action
- P3: cosmetic spacing/typography

## Code-audit raw signals

- Fixed widths >400px: **0 across all 5 pages**
- HTML tables: **0**
- Grids with 4+ cols: **0**
- All 5 pages wrap in `.app-container` (16/24/32px responsive padding) except `/foxy` which is chat full-bleed by design
- All 5 pages render `<BottomNav />`
- Modals use `w-full max-w-sm` pattern (caps at 384px desktop, fills container narrower)

## Inline fixes applied during this audit

None. The code audit did not surface any clear-cut, locally-fixable mobile bugs; all flagged items are debatable or require manual-device verification first. Per the task's "if unsure, flag don't fix" rule, no source files were modified.
