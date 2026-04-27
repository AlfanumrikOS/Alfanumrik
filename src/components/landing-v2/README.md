# landing-v2 — Indian Editorial Tutor

## What this is
Editorial redesign of `/welcome` styled as a bilingual workbook ("Indian Editorial Tutor"). Gated behind the `ff_welcome_v2` feature flag; v1 stays the default until rollout.

## Design tokens (`welcome-v2.module.css` `:root`)
- `--cream`, `--cream-deep`, `--cream-deeper` — paper surfaces (page → cards → progress troughs)
- `--ink`, `--ink-soft`, `--ink-mute`, `--ink-deep` — text on paper, lifted dark surfaces
- `--saffron`, `--saffron-deep` — primary brand accent, CTAs, focus rings
- `--peacock`, `--marigold`, `--vermilion`, `--leaf`, `--indigo` — secondary palette
- `--success`, `--success-bg`, `--success-border`, `--success-fg` — correct-answer pill + live pulse
- `--rule`, `--rule-strong`, `--pencil` — hairlines and editorial annotations
- `--paper`/`--on-paper`/`--invert-bg`/`--invert-fg` — semantic aliases that flip in dark mode

## Mobile-first responsive
Fluid type/spacing via `clamp()`; viewport heights via `dvh`/`svh`/`lvh`; container queries; touch targets clamp to `--tap` (48px). Page breakpoints: 320 → 480 → 768 → 1024 → 1440 → 1920 → 2560.

## Dark theme
`[data-theme="dark"]` on `.root` overrides paper/ink/rule tokens (also applied via `prefers-color-scheme` when no explicit theme is set). Toggle lives in `NavV2`.

## v1 ↔ v2 swap
A server component in `src/app/welcome/page.tsx` decides which variant to render via the `ff_welcome_v2` flag, an explicit `?v=1|2` query, and an `alf_anon_id` cookie hash for sticky bucketing.

## A11y
Single H1, ordered heading hierarchy. ARIA `tablist` for the role switcher (`NavV2`). `lang="hi"` on every Devanagari run; bilingual text via `useWelcomeV2().t()`. `:focus-visible` saffron rings, ≥48px touch targets.

## Static design source
`design-previews/welcome-v2.html` (1950 lines, fully audited and fixed) — canonical reference for layout, tokens, and copy.
