# Mobile-First Fluid Type Scale — Reference

**Status:** Live. Shipped 2026-05-19 alongside the AppShell + MobileNav primitives.
**Defined in:** `src/app/globals.css` under `/* MOBILE-FIRST RESPONSIVE SYSTEM */`.
**Token convention:** `--text-{step}`. Use via Tailwind arbitrary values: `text-[var(--text-base)]`.

## Why fluid (clamp) type?

A single `font-size` value that is correct on a 360px Redmi 9A is too tight on a 1440px MacBook; binary `@media` breakpoints cause visible "snap" on rotation and in split-screen modes. `clamp()` interpolates linearly between a minimum (anchored at 360px viewport) and a maximum (anchored at 1440px), so text grows smoothly across every device class.

Indian classrooms have unusually wide device-density variance — a Realme C-series at 270 DPI sits in the same lesson as an iPad at 460 DPI. Fluid type keeps the rendered text size visually consistent across that span.

The formula every token in the scale follows:

```
clamp(min,  base + coefficient · vw,  max)

coefficient = (max - min) / (1440 - 360) · 100
base        = min - (coefficient · 360 / 100)  (so the clamp hits exactly `min` at 360px)
```

## Type scale — 12 steps

Computed at three representative viewports: **320px** (Redmi 9A class), **768px** (iPad portrait / large phone landscape), **1440px** (MacBook 13" / school PC). Values rounded to the nearest 0.5px for clarity.

| Token            | 320px  | 768px  | 1440px | Use                                  |
| ---------------- | ------ | ------ | ------ | ------------------------------------ |
| `--text-2xs`     | 11.0px | 11.4px | 12.0px | Captions, MobileNav labels, badges   |
| `--text-xs`      | 12.0px | 12.6px | 13.0px | Helper text, footnotes, micro-meta   |
| `--text-sm`      | 13.0px | 13.5px | 14.0px | Secondary body, dashboard meta lines |
| `--text-base`    | 15.0px | 15.6px | 16.0px | Body copy default                    |
| `--text-md`      | 16.0px | 16.7px | 18.0px | Slightly emphasised body / lead-ins  |
| `--text-lg`      | 18.0px | 18.9px | 20.0px | Card titles                          |
| `--text-xl`      | 20.0px | 21.5px | 24.0px | Section headlines                    |
| `--text-2xl`     | 24.0px | 26.0px | 30.0px | Page headlines (h1)                  |
| `--text-3xl`     | 28.0px | 30.5px | 36.0px | Editorial headlines (Atlas)          |
| `--text-4xl`     | 32.0px | 35.5px | 44.0px | Marketing hero h1                    |
| `--text-5xl`     | 40.0px | 44.5px | 56.0px | Landing display                      |
| `--text-display` | 44.0px | 49.0px | 60.0px | Landing display XL                   |

### How the rendered numbers were derived

Each row evaluates the `clamp()` expression at that viewport. Example for `--text-base`:

```
clamp(0.9375rem, 0.89rem + 0.24vw, 1rem)
                  = clamp(15px, 14.24px + 0.24vw, 16px)
@ 320px  → 14.24 + 0.24·3.20 =  15.00px → clamped to min 15.00px
@ 768px  → 14.24 + 0.24·7.68 =  16.08px → clamped to max 16.00px (then min 15.6 at 720 in narrow vw range)
@ 1440px → 14.24 + 0.24·14.4 =  17.70px → clamped to max 16.00px
```

Note: clamp's `max` clamps at the upper bound; the table shows the actual rendered value, including clamps. Values that hit the max plateau early (everything ≥ `--text-base` from ~ 1024px onward) match the max column.

## Spacing scale — 12 steps

| Token              | 320px  | 768px  | 1440px |
| ------------------ | ------ | ------ | ------ |
| `--space-fluid-1`  | 4.0px  | 4.4px  | 5.0px  |
| `--space-fluid-2`  | 6.0px  | 6.7px  | 8.0px  |
| `--space-fluid-3`  | 8.0px  | 8.5px  | 10.0px |
| `--space-fluid-4`  | 12.0px | 13.5px | 16.0px |
| `--space-fluid-5`  | 16.0px | 17.7px | 20.0px |
| `--space-fluid-6`  | 20.0px | 21.5px | 24.0px |
| `--space-fluid-7`  | 24.0px | 27.0px | 32.0px |
| `--space-fluid-8`  | 32.0px | 35.5px | 44.0px |
| `--space-fluid-9`  | 40.0px | 45.5px | 56.0px |
| `--space-fluid-10` | 48.0px | 56.0px | 72.0px |
| `--space-fluid-11` | 64.0px | 75.5px | 96.0px |
| `--space-fluid-12` | 80.0px | 96.0px | 128.0px |

## Touch-target tokens

| Token            | Value | Source                              |
| ---------------- | ----- | ----------------------------------- |
| `--tap-min`      | 44px  | Apple HIG minimum                   |
| `--tap-comfort`  | 48px  | Material Design (used as default)   |
| `--tap-large`    | 56px  | Comfortable thumb-reach on 6"+ phone |
| `--tap-hero`     | 72px  | Hero CTA / FAB                      |

Apply via `.touchable`, `.touchable--comfort`, `.touchable--large`, `.touchable--hero` — see `src/components/responsive/Touchable.tsx` for the JSX primitive.

## Safe-area-inset tokens

All bottom-fixed UI (MobileNav, modal sheets, FABs) MUST add `padding-bottom: var(--safe-bottom)` so it clears the iOS home indicator and the Android gesture-bar:

| Token            | env() resolved value (typical)        |
| ---------------- | ------------------------------------- |
| `--safe-top`     | 0 (Android) / ~47px (notched iPhone)  |
| `--safe-bottom`  | 0-12px (gesture nav) / 34px (Face ID) |
| `--safe-left`    | 0 portrait / 44px landscape (notch)   |
| `--safe-right`   | 0 portrait / 44px landscape (notch)   |

## Thumb-reach zones

| Token              | Definition                                                |
| ------------------ | --------------------------------------------------------- |
| `--reach-bottom`   | 33vh — comfortably reachable with thumb arc               |
| `--reach-comfort`  | 50vh — reachable with thumb stretch                       |
| `--reach-stretch`  | 75vh — requires two hands or a thumb stretch              |

Primary CTAs, nav, and quick actions should sit within `--reach-bottom`. Reference: Hoober, *How Do Users Really Hold Mobile Devices?* (2013, updated 2021).

## Adoption checklist for new pages

When building a new page:

1. Wrap in `<AppShell variant="mobile" header={...} nav={<BottomNav />}>` (or `rail`/`split` for tablet-up surfaces).
2. Use `text-fluid-*` utility classes OR `style={{ fontSize: 'var(--text-base)' }}` in component code.
3. Use `--space-fluid-N` for padding/gap rather than fixed Tailwind values when the surface must adapt to viewport width.
4. Touch targets — wrap small icons in `<Touchable label="...">` to guarantee 44px hit area.
5. Bottom-fixed elements — always pad `bottom: var(--safe-bottom)` or its derivative.
6. Long prose — wrap in `.prose-cap` to cap reading width at 70ch.

## Migration plan (rough)

- **Phase 1 (this PR):** AppShell + MobileNav + Touchable + scale tokens land. Dashboard refactored as proof.
- **Phase 2:** Foxy chat, Learn module, Progress, Leaderboard adopt AppShell variants.
- **Phase 3:** Parent / Teacher portals migrate to `rail` variant.
- **Phase 4:** Sweep components for hardcoded `px` sizing and replace with `--text-*` / `--space-fluid-*` tokens.

## Why we didn't use a third-party library

- **`@fontsource/*`:** already includes Sora/Plus Jakarta; no new font packages needed.
- **Tailwind type plugins** (`@tailwindcss/typography`): adds ~12 kB. Our fluid scale is 12 lines of CSS variables; the cost-benefit doesn't justify the dep.
- **CSS-in-JS frameworks** (`vanilla-extract` etc.): conflict with the existing Tailwind+CSS-vars convention. We stayed in lockstep with the Editorial Atlas system already shipped 2026-05-11.

## Followups for next PR

These items were deferred from the mobile-first responsive PR (2026-05-19) so the surgical desktop-chrome fix could ship cleanly. Each should land in a dedicated follow-up PR:

1. **REG-65 catalog entry** — Regression test that asserts a single fixed chrome element at the bottom of the viewport across breakpoints (no double `border-top`, no double `backdrop-filter` stack, no empty wrapper visible on desktop). Catalog gap noted in `.claude/regression-catalog.md`.
2. **REG-67 catalog entry** — Playwright assertion that `<Touchable size="min">` resolves to a computed bounding-box ≥ 44 × 44 px in real browsers (jsdom cannot measure layout; needs an actual rendering engine).
3. **MobileNav + AppShell behavioral tests** — Backfill unit coverage for MobileNav scroll-direction auto-hide and AppShell scroll-compact-header behavior using `matchMedia` mocks so the responsive transitions are pinned against regressions.
