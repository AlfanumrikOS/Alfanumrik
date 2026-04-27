# Bundle Budget — P10 status

Last reconciled: 2026-04-27. Authoritative cap source: `scripts/check-bundle-size.mjs` (P10 in `.claude/CLAUDE.md`).

## Current state (gzipped, after Tier-1 work)

| Metric | Value | Cap | Status |
|---|---|---|---|
| Shared JS (rootMain + nomodule polyfill) | **168.5 kB** | 160 kB | OVER by 8.5 kB |
| Shared JS (rootMain only — modern browsers actually load) | **129.8 kB** | 160 kB | PASS |
| Middleware | 110.5 kB | 120 kB | PASS |
| Per-page worst case (`/foxy`) | 200.4 kB | 260 kB | PASS |

The **modern-browser** number (129.8 kB) is what every P10 target user actually downloads and executes. The 38.7 kB nomodule polyfill is shipped via `<script nomodule>` and is silently skipped by every browser that supports ES modules — Chrome 61+, Firefox 60+, Safari 11+, Edge 16+. Our browserslist (`package.json`) targets Chrome 90+ / iOS 14+, so 100% of real users skip the polyfill download entirely.

## What's in the 168.5 kB shared bundle

| Chunk | Gz size | What it is | Removable? |
|---|---|---|---|
| `0~rf3ekq7kn~0.js` | 71.1 kB | Next.js framework runtime (Script, stylesheets, hydration) | No — framework |
| `0el7o1qxpkv5k.js` | 36.6 kB | App Router runtime (loading boundaries, prefetch, RSC transport) | No — framework |
| `04cohx4lk6r9g.js` | 9.0 kB | Next.js router/error helpers | No — framework |
| `0ej4y_2_xlpd1.js` | 9.0 kB | React core | No |
| `turbopack-*.js` | 4.1 kB | Turbopack runtime | No |
| `03~yq9q893hmn.js` | 38.7 kB | core-js polyfill (`nomodule`) | Skipped by modern browsers |

There is no application code in the shared bundle. Every byte is framework or polyfill.

## Top 5 heaviest pages (gzipped, ex-shared)

| Page | Cost | Notes |
|---|---|---|
| `/foxy` | 200.4 kB | RichContent (markdown + KaTeX), Spline 3D, Supabase realtime |
| `/stem-centre` | 147.7 kB | Spline 3D widget (lazy after first paint) |
| `/dashboard` | 137.9 kB | SWR widgets, RBAC permission checks |
| `/quiz` | 133.9 kB | Quiz orchestrator, CelebrationOverlay (canvas-confetti) |
| `/welcome` | 125.0 kB | Landing-v2 hero (CSS-only animations) |

## Tier-1 work shipped 2026-04-27

1. Added `browserslist` to `package.json` (Chrome 90+, iOS 14+, Edge 90+, Firefox 90+, Safari 14+) — informs SWC code generation to skip transforms for modern targets.
2. Added `experimental.optimizePackageImports` in `next.config.js` for `@sentry/nextjs`, `@supabase/supabase-js`, `@supabase/ssr`, `@upstash/*`, `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`, `swr`, `zod`, `clsx`, `tailwind-merge` — Next.js rewrites named imports for finer tree-shaking.
3. Removed unused `framer-motion` dependency (`Animations.tsx` already uses CSS-only IntersectionObserver — the dep was dead but installed).
4. Replaced `import * as Sentry from '@sentry/nextjs'` with named imports (`captureException`, `captureMessage`) in 12 client error boundaries + `logger.ts`. Lets `optimizePackageImports` actually drop unused symbols from page bundles.

These changes pass the bundle-size check on the modern-browser number (129.8 kB ≪ 160 kB) but do not move the gzipped total below 160 kB because the polyfill chunk is hardcoded in `node_modules/next/dist/build/polyfills/polyfill-nomodule.js` and emitted by Next.js regardless of `browserslist`. There is no `next.config.js` flag to opt out.

## Why the CI "414 kB" warning differs from this report

The CI step at `.github/workflows/ci.yml:374-381` measures the largest **uncompressed** chunk in `.next/static/chunks/` and compares it to the **gzipped** 160 kB cap. That's an apples-to-oranges comparison. The 414 kB chunk is `0ehtdy5d70bi.js` (Spline runtime + zod, lazy-loaded only on `/foxy` and `/stem-centre`) — its gzipped real-world transfer cost is ~115 kB and it is never in the first-load critical path. CI emits a warning, not a failure.

## Roadmap to close the remaining 8.5 kB gap

These would each require an architecture decision and are out of scope for the P10 tightening pass. Listed in order of safety:

1. **Patch Next.js to allow disabling the nomodule polyfill chunk** when `browserslist` excludes legacy targets. Saves 38.7 kB shared. Would need to be a Next.js PR or local patch — risky for our ~12-month-out maintenance burden.
2. **Lazy-load Supabase auth client in non-authenticated routes** (`/welcome`, `/about`, `/pricing`, `/contact`, `/privacy`, `/terms`). Currently every page eagerly imports `AuthContext` which pulls in `@supabase/supabase-js` (218 kB unzipped, ~70 kB gzipped on the page-specific axis). Saves ~70 kB on landing pages but requires splitting the `AuthContext` into `AuthContextLight` + `AuthContextFull`.
3. **Drop Spline from `/welcome`**. Currently lazy-loaded but the chunk graph still references it. Replace with a lighter Lottie animation (~30 kB). Saves ~115 kB on `/foxy` and `/stem-centre` initial load.
4. **Move PostHog initialization to a route-handler-triggered postMessage** instead of dynamic-import-on-mount. Marginal — already lazy.

## Per-page sizes (top 5 — see `npm run check:bundle-size` for full list)

```
[ok  ]  200.4 kB  /foxy
[ok  ]  147.7 kB  /stem-centre
[ok  ]  137.9 kB  /dashboard
[ok  ]  133.9 kB  /quiz
[ok  ]  125.0 kB  /welcome
```

All pages are well under the 260 kB cap.
