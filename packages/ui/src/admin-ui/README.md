# admin-ui — Shared Dashboard Primitives

Used by `/super-admin`, `/school-admin`, and (after Plans 1-2 in `docs/superpowers/plans/`) `/teacher` and `/parent` shells. Consume from `@alfanumrik/ui/admin-ui`.

## Components

| Symbol | Purpose |
|---|---|
| `StatCard` | Headline-number tile with optional trend, icon, accent stripe, click handler |
| `StatusBadge` | Pill label with `success` / `danger` / `warning` / `info` / `neutral` variants |
| `StalenessTag` | "3m ago" tag that turns warning-colored past a threshold |
| `DetailDrawer` | Right-side modal drawer with ESC + overlay close, ARIA dialog, body scroll lock |
| `DataTable<T>` | Sortable, selectable table with empty/loading states, generic over row type |
| `DashboardSidebar` | Bilingual + module-gated sidebar with mobile drawer, used by all shells |
| `LineChart`, `BarChart`, `DonutChart` | Recharts wrappers with token-driven palette and empty-state fallback |

## Tokens

All visual styles use the existing CSS-variable Tailwind tokens (see `tailwind.config.js`):

| Token | Use |
|---|---|
| `bg-surface-1`, `bg-surface-2`, `bg-surface-3` | Card / page / hover backgrounds |
| `text-foreground`, `text-muted-foreground` | Body / secondary text |
| `text-primary`, `bg-primary/5`, `bg-primary/10` | Brand-accent — overridable per tenant via SchoolThemeProvider |
| `text-success`, `text-danger`, `text-warning`, `text-info` | Status colors |
| `border-surface-3` | Default card / divider borders |
| Animations: `animate-fade-in`, `animate-slide-up` | Drawer, modal, dropdown entries |

## Conventions

- All components are `'use client'` — they use state, ref, or browser APIs.
- All components accept `className` and use `twMerge` so callers can override Tailwind classes.
- Bilingual support: components that render text use `isHi` props, never hardcode strings. Pass it from `useAuth().isHi`.
- Mobile: `<md` (640px) is the breakpoint. `DashboardSidebar` collapses into a hamburger drawer below it.
- Charts: pass a fixed `height`. Width is always responsive to the parent container.

## When NOT to use

- Student-facing surfaces (gamified UI, level-up, XP burst). Use `src/components/dashboard/*`, `src/components/xp/*`, etc.
- Marketing pages. Those have their own design language under `src/components/landing*`.

## Adding a new primitive

1. TDD: write `src/__tests__/admin-ui/<Name>.test.tsx` first.
2. Implement in `src/components/admin-ui/<Name>.tsx`.
3. Re-export from `src/components/admin-ui/index.ts`.
4. If lifting from an existing `_components/` folder, leave a re-export shim in the old path so existing imports keep working — DRY without forcing every page to update its imports.

## Plan reference

See `docs/superpowers/plans/2026-05-09-dashboard-foundation.md` (in the `docs/dashboard-upgrade-plans` branch) for the full lift plan and the migration recipe used to apply this kit across `/super-admin`, `/school-admin`, etc.
