# Motion (framer-motion) — adoption pattern

Status: **foundation only. Zero adopters, therefore zero bundle impact today.**

Nothing in the app imports this directory — verify before trusting the claim:

```bash
grep -rn "@alfanumrik/ui/motion\|createMotionIsland" apps packages \
  --include=*.ts --include=*.tsx | grep -v packages/ui/src/motion/
```

Empty output ⇒ the directory is unreachable from the app graph and contributes
nothing to any route. It exists so the first person who needs runtime motion
gets the safe path by default instead of typing
`import { motion } from 'framer-motion'` into a page.

---

## ⚠️ Read this before you adopt

**CSS-only motion is the default and the preferred approach on every surface.**
`framer-motion` is **permitted, conditionally** — CEO-approved 2026-08-09 along
with the rest of the premium UI stack. That approval is recorded in
`.claude/skills/student-frontend/SKILL.md` (§3 Motion) and
`.claude/skills/student-dashboard-design/SKILL.md` (Motion), which **supersede
the previous blanket ban.** If this README ever disagrees with those skills, the
skills win — re-read them before adopting.

The conditions, on every surface including student pages:

| Condition | Meaning |
|---|---|
| **Only for what CSS genuinely cannot express** | gesture/drag, shared-layout (`layoutId`), orchestrated exit-on-unmount (`AnimatePresence`), spring/velocity-aware interruption. Anything CSS already does, do in CSS. |
| **Never in the shared import graph** | not `apps/host/src/app/layout.tsx`, not `packages/lib/src/AuthContext.tsx`, not anything either graph pulls — that lands the cost on every route at once. Per-surface only. |
| **Behind a `next/dynamic({ ssr: false })` boundary** | which is exactly what `createMotionIsland()` gives you. |
| **A measured bundle diff in the PR** | see rule 4 below. "It's lazy so it's free" is not a measurement. |

`packages/ui/src/landing/Animations.tsx` still says in code *"Replaces
framer-motion (40KB) with native IntersectionObserver (0KB)"* — that remains the
right call for scroll-reveal on landing, and the file is not obsolete. It is a
statement about scroll-reveal, not a ban.

**Student surfaces carry real P10 debt.** A large share of routes already exceed
`CAP_PAGE_KB` and the gate passes on a per-page ratchet against recorded
baselines, not because pages are under the cap — so a page with existing debt
has **zero** free bytes. Do not guess at the current numbers; derive them (see
"Deriving the current P10 numbers" below) before you assume headroom.

**Adopting this on a page that is already over its ratchet baseline is a budget
decision, not a design decision, and still needs the frontend → quality review
chain. Do not treat this README as that approval.**

### Deriving the current P10 numbers

This README deliberately hardcodes **no** kB figures or route counts — this repo
has a documented history of written-down metrics going stale. Derive them:

```bash
# enforced caps (authoritative)
grep -nE '^const CAP_' scripts/check-bundle-size.mjs

# per-page recorded baselines, route count, worst offender, and how many
# routes are over CAP_PAGE_KB — all from the checked-in baseline file
node -e "const b=require('./scripts/bundle-baseline.json');
const e=Object.entries(b.pages);
const [n,kb]=e.reduce((a,c)=>c[1]>a[1]?c:a);
console.log('routes',b.pageCount,'| cap',b.capPageKb,'kB | over cap',
  e.filter(([,v])=>v>b.capPageKb).length,'| worst',n,kb+'kB',
  '| baseline generated',b.generatedAt);"

# and after your change, the actual gate
node scripts/check-bundle-size.mjs
```

---

## The pattern

Four source files (`index.ts`, `presets.ts`, `dynamicMotion.tsx`,
`MotionProvider.tsx`), one rule: **outside this directory, framer-motion may
only be imported by a leaf module that is loaded through
`createMotionIsland()`.**

### 1. Write the animated leaf in its own file

```tsx
// HeroReveal.motion.tsx
'use client';

import { m } from 'framer-motion';                 // `m`, never `motion`
import { slideUp, staggerContainer } from '@alfanumrik/ui/motion';

export default function HeroReveal({ items }: { items: string[] }) {
  return (
    <m.ul variants={staggerContainer()} initial="hidden" animate="visible">
      {items.map((label) => (
        <m.li key={label} variants={slideUp}>{label}</m.li>
      ))}
    </m.ul>
  );
}
```

- **`m.*`, never `motion.*`.** `MotionProvider` runs `LazyMotion` in `strict`
  mode, so `motion.div` throws at runtime. That is intentional: one stray
  `motion.*` import silently re-inflates the bundle to the full feature set and
  makes the feature-split decorative.
- The component must be the **default export**.
- Copy comes in as props (P7). Never hardcode a user-facing string here.

### 2. Mount it as an island from a client component

```tsx
// HeroSection.tsx
'use client';

import { createMotionIsland } from '@alfanumrik/ui/motion';
import { Skeleton } from '@alfanumrik/ui/ui/primitives';

const HeroReveal = createMotionIsland(() => import('./HeroReveal.motion'), {
  fallback: <Skeleton className="h-24 w-full" />,   // REQUIRED; shape-matched, not a spinner
});

export function HeroSection({ isHi }: { isHi: boolean }) {
  return <HeroReveal items={isHi ? ITEMS_HI : ITEMS_EN} />;
}
```

That is the whole API. `createMotionIsland` gives you, without opt-in:

- `ssr: false` — framer-motion never enters the server bundle. The island chunk
  is fetched on the client when the island first renders, not as part of the
  page's initial payload. Confirm on your own page with rule 4's measurement;
  that is the only thing that proves it for your route.
- `LazyMotion features={domAnimation}` — the DOM-animation + gesture feature
  bundle only, instead of the full `motion` export. Materially smaller; the
  exact delta is version- and build-dependent, so **measure it** (rule 4) rather
  than quoting a number.
- `strict` — `motion.*` throws, so the split above cannot silently regress.
- `MotionConfig reducedMotion="user"` — honours the OS
  `prefers-reduced-motion` setting, mirroring the CSS blanket at
  `globals.css:772-788`.
- The provider resolved in the **same lazy boundary** as your component and
  awaited alongside it, so it can never be forgotten and your component never
  renders un-wrapped. (Whether webpack emits one async chunk or two is its call
  — the guarantee here is the pairing, not the chunk count.)

### 3. Import cost, per module

What is claimed below is **framer-motion bytes in the eager chunk of whatever
imports the module** — not "zero bytes" in an absolute sense. Every module still
costs its own (small) code.

| Module | framer-motion bytes in the importer's eager chunk | Why |
|---|---|---|
| `presets` (`fadeIn`, `slideUp`, `EASE_*`, …) | **none** | its only framer reference is `import type`, erased at build time. Safe to import even from a first-paint file. |
| `dynamicMotion` (`createMotionIsland`) | **none** | static imports are `next/dynamic` + types only; `MotionProvider` is reached via a dynamic `import()`, which webpack emits as a separate async chunk. |
| `index.ts` (the `@alfanumrik/ui/motion` barrel) | **none** | it statically re-exports only the two rows above. |
| `MotionProvider` | **all of them** | static `import { LazyMotion, … } from 'framer-motion'`. **Not exported from the barrel** — reach it via `createMotionIsland()`. |

**Why the barrel row is load-bearing, and how it stays true.**
`packages/ui/package.json` has no `"sideEffects": false`, and `@alfanumrik/ui`
is listed in `transpilePackages` (`apps/host/next.config.js`). Webpack therefore
treats these modules as side-effectful and will **not** elide an unused
re-export: everything the barrel statically re-exports lands in the importer's
eager chunk regardless of what was destructured. The barrel used to re-export
`MotionProvider`, which pulled framer-motion into the eager chunk of any file
doing `import { createMotionIsland } from '@alfanumrik/ui/motion'` — defeating
the whole `ssr: false` island. That re-export has been removed. The invariant is
now: **no module statically re-exported from `index.ts` may import
framer-motion.** Do not add one.

> Follow-up, deliberately not done here: adding `"sideEffects": false` to
> `packages/ui/package.json` would let webpack elide unused re-exports across the
> whole package. That reaches far beyond this directory and needs its own review
> (quality flagged it as such) — it is **not** a prerequisite for the table
> above, which holds without it.

---

## Rules

1. **Never** `import { motion } from 'framer-motion'` in a page, layout, or
   shared component. Only a `*.motion.tsx` leaf may import framer-motion, and
   only as `m`.
2. **Never** import `MotionProvider` directly outside this directory. It is not
   exported from the barrel, so the only supported path is
   `createMotionIsland()` — which resolves it through a dynamic `import()` in
   the island's own chunk. If you find yourself needing it directly, that is a
   design conversation, not an import.
3. `fallback` is a **required** parameter — the API enforces this rule rather
   than merely asking for it. Pass a **shape-matched** skeleton: a spinner
   guarantees a layout shift when the island lands; a skeleton does not.
   `null` is permitted only for an island that reserves no layout space at all
   (e.g. a purely decorative overlay), and passing it should be justified in the
   PR.
4. Run `npm run build && node scripts/check-bundle-size.mjs` on the adopting
   page and put the before/after page kB in the PR description. "It's lazy so
   it's free" is not a measurement. Note that the gate ratchets against the
   recorded baseline in `scripts/bundle-baseline.json`, so a page already over
   `CAP_PAGE_KB` has no headroom even though the cap number looks distant.
5. Reuse `presets.ts`. Its easings and durations are copied from
   `tailwind.config.js` and `globals.css` so islands match the CSS-animated
   surfaces beside them. If you need a new curve, add it to the CSS first so
   the two systems cannot drift.
6. Looping / infinite animations still need an explicit reduced-motion answer.
   `reducedMotion="user"` drops transform channels; it does not decide that an
   infinite spinner was a bad idea.
7. Accessibility floor still applies — motion never encodes meaning on its own
   (WCAG 1.4.1), and no interactive target drops below 44px.

---

## Why not just use the CSS system?

Usually you should. CSS is the default on every surface, student surfaces
included, and "framer-motion is now permitted" is not a reason to move existing
CSS motion onto it. CSS keyframes plus the `--reveal-i` stagger ladder cover
reveal, fade, scale, and staggered lists at zero runtime cost, and three
IntersectionObserver helpers already exist
(`landing/Animations.tsx`, `landing/v3/MotionPrimitives.tsx`,
`cosmic/usePrefersReducedMotion.ts`).

Runtime motion earns its bytes only for things CSS genuinely cannot express:
gesture-driven motion (drag, pan), interruptible//velocity-aware transitions,
shared-layout (`layoutId`) transitions, and enter/**exit** animation of
unmounting nodes (`AnimatePresence`). If your use case is not on that list, use
CSS.
