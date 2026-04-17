# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/welcome` from an 800-line monolithic page into a 5-section parent-focused conversion page with premium CSS-only visuals, custom branded icons, and scroll animations.

**Architecture:** Decompose the monolith into 10 focused components under `src/components/landing/`. The page shell (`src/app/welcome/page.tsx`) becomes a thin composer. All icons and graphics are CSS-only (no images, no emoji, no icon libraries). Existing `Animations.tsx`, `LangToggle.tsx`, and `T.tsx` are reused as-is. Two new CSS keyframes are added to `globals.css`.

**Tech Stack:** Next.js 16 App Router, React 18, Tailwind 3.4, CSS-only graphics (clip-path, gradients, borders), IntersectionObserver for scroll triggers

**Spec:** `docs/superpowers/specs/2026-04-17-landing-page-redesign-design.md`

---

## File Map

| File | Responsibility | Status |
|------|---------------|--------|
| `src/components/landing/FoxyMark.tsx` | Branded CSS-only fox avatar at 3 sizes (sm/md/lg) | Create |
| `src/components/landing/CustomIcons.tsx` | All 11 custom CSS-only icons (problem, solution, trust, product) | Create |
| `src/components/landing/StickyMobileCTA.tsx` | Mobile-only sticky bar with IntersectionObserver show/hide | Create |
| `src/components/landing/Hero.tsx` | Hero section: headline, CTA, phone mockup, stats strip | Create |
| `src/components/landing/ProblemSolution.tsx` | 3 problem + 3 solution cards with visual connector | Create |
| `src/components/landing/ProductShowcase.tsx` | 3 elevated product mockup cards (Foxy, Parent, Quiz) | Create |
| `src/components/landing/CredibilityStrip.tsx` | Trust badges, metrics line, social proof line | Create |
| `src/components/landing/FinalCTA.tsx` | Closing pitch, CTA button with pulse-glow, 3-item FAQ | Create |
| `src/components/landing/Footer.tsx` | 3-column footer with bottom bar | Create |
| `src/app/welcome/page.tsx` | Thin page shell composing all sections | Rewrite |
| `src/app/welcome/layout.tsx` | Updated SEO metadata | Modify |
| `src/app/globals.css` | Add `pulse-glow` keyframe | Modify |
| `src/components/landing/Animations.tsx` | Used as-is (no changes) | Unchanged |
| `src/components/landing/LangToggle.tsx` | Used as-is (no changes) | Unchanged |
| `src/components/landing/T.tsx` | Used as-is (no changes) | Unchanged |

---

## Task 1: FoxyMark Component — Branded CSS Fox Avatar

**Files:**
- Create: `src/components/landing/FoxyMark.tsx`
- Test: Visual verification (no unit test — pure presentational CSS component)

- [ ] **Step 1: Create the FoxyMark component**

Create `src/components/landing/FoxyMark.tsx`:

```tsx
'use client';

/**
 * Branded CSS-only geometric fox avatar.
 * Replaces all 🦊 emoji on landing pages.
 * Three sizes: sm (w-7), md (w-12), lg (w-16).
 */
export function FoxyMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 28, md: 48, lg: 64 }[size];
  const earSize = { sm: 8, md: 14, lg: 18 }[size];
  const eyeSize = { sm: 2, md: 4, lg: 5 }[size];
  const noseSize = { sm: 3, md: 5, lg: 7 }[size];

  return (
    <div
      className="relative shrink-0"
      style={{ width: dims, height: dims }}
      aria-hidden="true"
    >
      {/* Circular base */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'linear-gradient(135deg, #E8581C, #F5A623)',
          boxShadow: '0 2px 8px rgba(232,88,28,0.25)',
        }}
      />
      {/* Left ear */}
      <div
        className="absolute"
        style={{
          width: 0,
          height: 0,
          borderLeft: `${earSize * 0.6}px solid transparent`,
          borderRight: `${earSize * 0.6}px solid transparent`,
          borderBottom: `${earSize}px solid #D4520F`,
          top: -earSize * 0.35,
          left: dims * 0.12,
          transform: 'rotate(-8deg)',
        }}
      />
      {/* Right ear */}
      <div
        className="absolute"
        style={{
          width: 0,
          height: 0,
          borderLeft: `${earSize * 0.6}px solid transparent`,
          borderRight: `${earSize * 0.6}px solid transparent`,
          borderBottom: `${earSize}px solid #D4520F`,
          top: -earSize * 0.35,
          right: dims * 0.12,
          transform: 'rotate(8deg)',
        }}
      />
      {/* Left eye */}
      <div
        className="absolute rounded-full bg-white"
        style={{
          width: eyeSize,
          height: eyeSize,
          top: '42%',
          left: '30%',
        }}
      />
      {/* Right eye */}
      <div
        className="absolute rounded-full bg-white"
        style={{
          width: eyeSize,
          height: eyeSize,
          top: '42%',
          right: '30%',
        }}
      />
      {/* Nose */}
      <div
        className="absolute"
        style={{
          width: 0,
          height: 0,
          borderLeft: `${noseSize * 0.5}px solid transparent`,
          borderRight: `${noseSize * 0.5}px solid transparent`,
          borderTop: `${noseSize * 0.6}px solid white`,
          bottom: '28%',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify it renders**

Open the dev server (if running) and temporarily import `<FoxyMark size="lg" />` into any test page, or visually confirm in the next task when Hero uses it.

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/FoxyMark.tsx
git commit -m "feat(landing): add FoxyMark branded CSS fox avatar component"
```

---

## Task 2: CustomIcons Component — All CSS-Only Icons

**Files:**
- Create: `src/components/landing/CustomIcons.tsx`

This file exports all 11 custom icons used across the landing page. Each is a pure CSS construction — no images, no emoji, no icon libraries.

- [ ] **Step 1: Create the CustomIcons component file**

Create `src/components/landing/CustomIcons.tsx`:

```tsx
'use client';

/**
 * Custom CSS-only icons for the landing page.
 * Every icon is built with gradients, borders, clip-path, and positioned elements.
 * No emoji. No icon libraries. No images.
 */

const ICON_SIZE = 48;

/* ─── Problem Icons ──────────────────────────────────────── */

/** Brain outline with dotted fade-out — concepts dissolving */
export function IconBrainFade() {
  return (
    <div className="relative shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      {/* Brain shape */}
      <div className="absolute" style={{
        width: 32, height: 28, top: 10, left: 8,
        borderRadius: '50% 50% 45% 45%',
        border: '2.5px solid var(--text-3)',
        opacity: 0.8,
      }} />
      {/* Center divide */}
      <div className="absolute" style={{
        width: 2, height: 16, top: 14, left: 23,
        background: 'var(--text-3)',
        opacity: 0.5,
      }} />
      {/* Fade-out dots (knowledge dissolving) */}
      {[
        { x: 34, y: 8, opacity: 0.5, size: 3 },
        { x: 38, y: 14, opacity: 0.35, size: 2.5 },
        { x: 40, y: 22, opacity: 0.2, size: 2 },
        { x: 36, y: 28, opacity: 0.12, size: 2 },
        { x: 30, y: 34, opacity: 0.08, size: 1.5 },
      ].map((dot, i) => (
        <div key={i} className="absolute rounded-full" style={{
          width: dot.size, height: dot.size,
          left: dot.x, top: dot.y,
          background: 'var(--text-3)',
          opacity: dot.opacity,
        }} />
      ))}
    </div>
  );
}

/** Scattered dots converging nowhere — random practice */
export function IconScatteredDots() {
  return (
    <div className="relative shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      {[
        { x: 6, y: 12, size: 5, color: 'var(--text-3)', opacity: 0.7 },
        { x: 22, y: 4, size: 4, color: '#E8581C', opacity: 0.5 },
        { x: 38, y: 18, size: 6, color: 'var(--text-3)', opacity: 0.4 },
        { x: 14, y: 32, size: 4.5, color: '#E8581C', opacity: 0.6 },
        { x: 30, y: 36, size: 3, color: 'var(--text-3)', opacity: 0.3 },
        { x: 8, y: 24, size: 3.5, color: '#E8581C', opacity: 0.35 },
        { x: 36, y: 8, size: 3, color: 'var(--text-3)', opacity: 0.5 },
        { x: 24, y: 22, size: 5, color: 'var(--text-3)', opacity: 0.25 },
      ].map((dot, i) => (
        <div key={i} className="absolute rounded-full" style={{
          width: dot.size, height: dot.size,
          left: dot.x, top: dot.y,
          background: dot.color,
          opacity: dot.opacity,
        }} />
      ))}
    </div>
  );
}

/** Eye with strike-through — no visibility for parent */
export function IconEyeStrike() {
  return (
    <div className="relative shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      {/* Eye shape */}
      <div className="absolute" style={{
        width: 34, height: 18, top: 15, left: 7,
        borderRadius: '50%',
        border: '2.5px solid var(--text-3)',
        opacity: 0.7,
      }} />
      {/* Pupil */}
      <div className="absolute rounded-full" style={{
        width: 10, height: 10, top: 19, left: 19,
        background: 'var(--text-3)',
        opacity: 0.6,
      }} />
      {/* Strike-through line */}
      <div className="absolute" style={{
        width: 42, height: 2.5, top: 23, left: 3,
        background: '#E8581C',
        transform: 'rotate(-35deg)',
        transformOrigin: 'center',
        borderRadius: 2,
        opacity: 0.85,
      }} />
    </div>
  );
}

/* ─── Solution Icons ─────────────────────────────────────── */

/** Brain with glowing connected nodes — clarity achieved */
export function IconBrainConnected() {
  return (
    <div className="relative shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      {/* Brain shape */}
      <div className="absolute" style={{
        width: 32, height: 28, top: 10, left: 8,
        borderRadius: '50% 50% 45% 45%',
        border: '2.5px solid #E8581C',
        opacity: 0.8,
      }} />
      {/* Center divide */}
      <div className="absolute" style={{
        width: 2, height: 16, top: 14, left: 23,
        background: '#E8581C',
        opacity: 0.4,
      }} />
      {/* Connected nodes with glow */}
      {[
        { x: 14, y: 16, size: 5 },
        { x: 28, y: 14, size: 5 },
        { x: 18, y: 28, size: 4 },
        { x: 30, y: 26, size: 4 },
      ].map((node, i) => (
        <div key={i} className="absolute rounded-full" style={{
          width: node.size, height: node.size,
          left: node.x, top: node.y,
          background: '#E8581C',
          boxShadow: '0 0 6px rgba(232,88,28,0.5)',
        }} />
      ))}
      {/* Connection lines (simplified with a pseudo-SVG approach using thin divs) */}
      <svg className="absolute inset-0" width={ICON_SIZE} height={ICON_SIZE} style={{ opacity: 0.35 }}>
        <line x1="16" y1="18" x2="30" y2="16" stroke="#E8581C" strokeWidth="1.5" />
        <line x1="16" y1="18" x2="20" y2="30" stroke="#E8581C" strokeWidth="1.5" />
        <line x1="30" y1="16" x2="32" y2="28" stroke="#E8581C" strokeWidth="1.5" />
        <line x1="20" y1="30" x2="32" y2="28" stroke="#E8581C" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

/** Arrow hitting bullseye — targeted practice */
export function IconBullseye() {
  return (
    <div className="relative shrink-0 flex items-center justify-center" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      {/* Outer ring */}
      <div className="absolute rounded-full" style={{
        width: 36, height: 36,
        border: '2px solid var(--text-3)',
        opacity: 0.3,
      }} />
      {/* Middle ring */}
      <div className="absolute rounded-full" style={{
        width: 24, height: 24,
        border: '2px solid var(--text-3)',
        opacity: 0.5,
      }} />
      {/* Center dot */}
      <div className="absolute rounded-full" style={{
        width: 10, height: 10,
        background: '#E8581C',
        boxShadow: '0 0 8px rgba(232,88,28,0.4)',
      }} />
      {/* Arrow shaft */}
      <div className="absolute" style={{
        width: 18, height: 2,
        background: '#E8581C',
        top: 14, right: 2,
        transform: 'rotate(40deg)',
        transformOrigin: 'right center',
        borderRadius: 1,
      }} />
      {/* Arrow head */}
      <div className="absolute" style={{
        width: 0, height: 0,
        borderTop: '4px solid transparent',
        borderBottom: '4px solid transparent',
        borderRight: '7px solid #E8581C',
        top: 20, right: 14,
        transform: 'rotate(40deg)',
      }} />
    </div>
  );
}

/** Open eye with dashboard bars — daily visibility */
export function IconEyeDashboard() {
  return (
    <div className="relative shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      {/* Eye shape */}
      <div className="absolute" style={{
        width: 36, height: 20, top: 14, left: 6,
        borderRadius: '50%',
        border: '2.5px solid #16A34A',
        opacity: 0.8,
      }} />
      {/* Pupil area — contains mini bar chart */}
      <div className="absolute rounded-full flex items-end justify-center gap-px" style={{
        width: 14, height: 14, top: 17, left: 17,
        background: 'rgba(22,163,74,0.15)',
        padding: 2,
        overflow: 'hidden',
      }}>
        <div style={{ width: 2.5, height: 4, background: '#16A34A', borderRadius: 1, opacity: 0.7 }} />
        <div style={{ width: 2.5, height: 7, background: '#16A34A', borderRadius: 1, opacity: 0.85 }} />
        <div style={{ width: 2.5, height: 10, background: '#16A34A', borderRadius: 1 }} />
      </div>
    </div>
  );
}

/* ─── Trust Badge Icons ──────────────────────────────────── */

/** Ashoka Chakra-inspired motif — DPIIT */
export function IconAshoka() {
  return (
    <div className="relative shrink-0" style={{ width: 18, height: 18 }} aria-hidden="true">
      <div className="absolute inset-0 rounded-full" style={{
        border: '1.5px solid #1a237e',
        background: `conic-gradient(
          from 0deg,
          #E8581C 0deg, transparent 8deg, transparent 37deg,
          #E8581C 37deg, transparent 45deg, transparent 82deg,
          #E8581C 82deg, transparent 90deg, transparent 127deg,
          #E8581C 127deg, transparent 135deg, transparent 172deg,
          #E8581C 172deg, transparent 180deg, transparent 217deg,
          #E8581C 217deg, transparent 225deg, transparent 262deg,
          #E8581C 262deg, transparent 270deg, transparent 307deg,
          #E8581C 307deg, transparent 315deg, transparent 352deg,
          #E8581C 352deg, transparent 360deg
        )`,
      }} />
      <div className="absolute rounded-full" style={{
        width: 6, height: 6, top: 5, left: 5,
        background: '#1a237e',
      }} />
    </div>
  );
}

/** Shield — DPDPA */
export function IconShield() {
  return (
    <div className="relative shrink-0" style={{ width: 18, height: 18 }} aria-hidden="true">
      <div style={{
        width: 16, height: 18,
        clipPath: 'polygon(50% 0%, 100% 20%, 100% 65%, 50% 100%, 0% 65%, 0% 20%)',
        background: 'linear-gradient(135deg, #16A34A, #0891B2)',
        margin: '0 auto',
      }} />
      <div className="absolute" style={{
        width: 6, height: 6,
        top: 5, left: 7,
        borderLeft: '2px solid white',
        borderBottom: '2px solid white',
        transform: 'rotate(-45deg)',
        opacity: 0.9,
      }} />
    </div>
  );
}

/** Padlock — Encryption */
export function IconPadlock() {
  return (
    <div className="relative shrink-0" style={{ width: 18, height: 18 }} aria-hidden="true">
      {/* Shackle */}
      <div className="absolute" style={{
        width: 10, height: 8, top: 1, left: 4,
        borderRadius: '5px 5px 0 0',
        border: '2px solid #92400E',
        borderBottom: 'none',
      }} />
      {/* Body */}
      <div className="absolute" style={{
        width: 14, height: 10, top: 8, left: 2,
        borderRadius: 2,
        background: 'linear-gradient(135deg, #D97706, #F5A623)',
      }} />
      {/* Keyhole */}
      <div className="absolute rounded-full" style={{
        width: 3, height: 3, top: 11, left: 7.5,
        background: '#92400E',
      }} />
    </div>
  );
}

/** Open book — NCERT */
export function IconBook() {
  return (
    <div className="relative shrink-0 flex items-center justify-center" style={{ width: 18, height: 18 }} aria-hidden="true">
      {/* Left page */}
      <div style={{
        width: 8, height: 12,
        background: '#16A34A',
        borderRadius: '2px 0 0 2px',
        transform: 'skewY(-3deg)',
        opacity: 0.85,
      }} />
      {/* Spine */}
      <div style={{ width: 1.5, height: 13, background: '#15803D' }} />
      {/* Right page */}
      <div style={{
        width: 8, height: 12,
        background: '#16A34A',
        borderRadius: '0 2px 2px 0',
        transform: 'skewY(3deg)',
        opacity: 0.7,
      }} />
    </div>
  );
}

/** Prohibition circle — No Ads */
export function IconNoAds() {
  return (
    <div className="relative shrink-0" style={{ width: 18, height: 18 }} aria-hidden="true">
      <div className="absolute inset-0 rounded-full" style={{
        border: '2px solid #DC2626',
        opacity: 0.7,
      }} />
      <div className="absolute" style={{
        width: 14, height: 2,
        top: 8, left: 2,
        background: '#DC2626',
        transform: 'rotate(-45deg)',
        transformOrigin: 'center',
        borderRadius: 1,
        opacity: 0.7,
      }} />
    </div>
  );
}

/* ─── Product Card Icons ─────────────────────────────────── */

/** Bloom's taxonomy level indicator — 3 stacked triangles */
export function IconBloomLevel({ activeLevel = 2 }: { activeLevel?: 0 | 1 | 2 }) {
  const levels = [
    { y: 28, size: 10, label: 'Remember' },
    { y: 17, size: 8, label: 'Apply' },
    { y: 8, size: 6, label: 'Analyse' },
  ];
  return (
    <div className="relative shrink-0" style={{ width: 18, height: 18 }} aria-hidden="true">
      {levels.map((lvl, i) => (
        <div key={i} className="absolute" style={{
          left: '50%',
          top: lvl.y - 8,
          transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: `${lvl.size / 2}px solid transparent`,
          borderRight: `${lvl.size / 2}px solid transparent`,
          borderBottom: `${lvl.size * 0.7}px solid ${i === activeLevel ? '#2563EB' : 'var(--text-3)'}`,
          opacity: i === activeLevel ? 1 : 0.35,
        }} />
      ))}
    </div>
  );
}

/** Star-burst XP icon */
export function IconXPStar() {
  return (
    <div className="shrink-0" style={{
      width: 16, height: 16,
      clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
      background: 'linear-gradient(135deg, #E8581C, #F5A623)',
    }} aria-hidden="true" />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/landing/CustomIcons.tsx
git commit -m "feat(landing): add 13 custom CSS-only icon components for landing page"
```

---

## Task 3: StickyMobileCTA Component

**Files:**
- Create: `src/components/landing/StickyMobileCTA.tsx`

- [ ] **Step 1: Create the StickyMobileCTA component**

Create `src/components/landing/StickyMobileCTA.tsx`:

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useLang } from './LangToggle';

/**
 * Mobile-only sticky CTA bar.
 * Appears when hero CTA scrolls out of view.
 * Disappears when final CTA section enters view.
 * Uses IntersectionObserver (same pattern as Animations.tsx useInView).
 */
export function StickyMobileCTA() {
  const { t } = useLang();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const heroCTA = document.getElementById('hero-cta');
    const finalCTA = document.getElementById('final-cta');
    if (!heroCTA) return;

    let heroOut = false;
    let finalIn = false;

    const update = () => setVisible(heroOut && !finalIn);

    const heroObs = new IntersectionObserver(
      ([entry]) => { heroOut = !entry.isIntersecting; update(); },
      { threshold: 0 }
    );
    heroObs.observe(heroCTA);

    let finalObs: IntersectionObserver | undefined;
    if (finalCTA) {
      finalObs = new IntersectionObserver(
        ([entry]) => { finalIn = entry.isIntersecting; update(); },
        { threshold: 0 }
      );
      finalObs.observe(finalCTA);
    }

    return () => {
      heroObs.disconnect();
      finalObs?.disconnect();
    };
  }, []);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 sm:hidden flex items-center justify-center gap-3 px-4"
      style={{
        height: 56,
        background: 'rgba(251,248,244,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--border)',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.3s ease-out',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <Link
        href="/login"
        className="text-sm font-bold px-6 py-2.5 rounded-xl text-white"
        style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
      >
        {t('Start Free', 'मुफ्त शुरू करें')}
      </Link>
      <Link
        href="/login?role=parent"
        className="text-xs font-semibold"
        style={{ color: '#16A34A' }}
      >
        {t('For Parents', 'माता-पिता के लिए')}
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/landing/StickyMobileCTA.tsx
git commit -m "feat(landing): add StickyMobileCTA with IntersectionObserver show/hide"
```

---

## Task 4: Add `pulse-glow` Keyframe to globals.css

**Files:**
- Modify: `src/app/globals.css` (after existing keyframes around line 372)

- [ ] **Step 1: Add the pulse-glow keyframe**

In `src/app/globals.css`, after the `@keyframes spin-slow` line (line 372), add:

```css
@keyframes pulse-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(232, 88, 28, 0.3); } 50% { box-shadow: 0 0 0 12px rgba(232, 88, 28, 0); } }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(landing): add pulse-glow keyframe for CTA button idle animation"
```

---

## Task 5: Hero Section Component

**Files:**
- Create: `src/components/landing/Hero.tsx`

This is the largest single component. It contains: simplified nav, headline, CTA, phone mockup with Foxy conversation, and stats strip.

- [ ] **Step 1: Create Hero.tsx**

Create `src/components/landing/Hero.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useLang, LangToggle } from './LangToggle';
import { FoxyMark } from './FoxyMark';
import { FadeIn } from './Animations';

/* ─── Nav (simplified) ───────────────────────────────────── */
function Nav() {
  const { t } = useLang();
  return (
    <nav
      className="sticky top-0 z-50 border-b"
      style={{
        background: 'rgba(251,248,244,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="max-w-6xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/welcome" className="flex items-center gap-2">
          <FoxyMark size="sm" />
          <span
            className="text-lg font-extrabold gradient-text"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Alfanumrik™
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <LangToggle />
          <Link
            href="/login"
            className="hidden sm:inline-block text-sm font-semibold px-4 py-2 rounded-lg"
            style={{ color: 'var(--text-2)' }}
          >
            {t('Log In', 'लॉग इन')}
          </Link>
          <Link
            href="/login"
            className="text-sm font-bold px-5 py-2.5 rounded-xl text-white"
            style={{ background: 'var(--orange)' }}
          >
            {t('Sign Up Free', 'मुफ्त साइन अप')}
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ─── Phone Mockup ───────────────────────────────────────── */
function PhoneMockup() {
  return (
    <div
      className="relative mx-auto animate-float"
      style={{ width: 280, maxWidth: '100%' }}
    >
      {/* Phone frame */}
      <div
        className="rounded-3xl overflow-hidden"
        style={{
          border: '2px solid var(--border)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)',
          background: 'var(--bg)',
        }}
      >
        {/* Status bar / notch hint */}
        <div
          className="flex items-center justify-center py-1.5"
          style={{ background: 'var(--surface-1)' }}
        >
          <div
            className="rounded-full"
            style={{ width: 48, height: 4, background: 'var(--border)' }}
          />
        </div>

        {/* Foxy header */}
        <div
          className="px-3 py-2 flex items-center gap-2 border-b"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
        >
          <FoxyMark size="sm" />
          <span
            className="text-xs font-bold"
            style={{ color: '#E8581C', fontFamily: 'var(--font-display)' }}
          >
            Foxy AI Tutor
          </span>
          <div className="ml-auto flex gap-1">
            {['Learn', 'Practice', 'Quiz'].map((mode, i) => (
              <span
                key={mode}
                className="text-[9px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: i === 0 ? '#E8581C' : 'var(--surface-2)',
                  color: i === 0 ? '#fff' : 'var(--text-3)',
                }}
              >
                {mode}
              </span>
            ))}
          </div>
        </div>

        {/* Chat content */}
        <div className="p-3 space-y-2.5" style={{ minHeight: 200 }}>
          {/* Student message */}
          <div className="flex justify-end">
            <div
              className="rounded-2xl rounded-br-md px-3 py-2 max-w-[80%] text-[11px] leading-relaxed"
              style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}
            >
              Photosynthesis samjhao step by step
            </div>
          </div>
          {/* Foxy response */}
          <div className="flex gap-2 items-start">
            <FoxyMark size="sm" />
            <div
              className="rounded-2xl rounded-bl-md px-3 py-2 max-w-[85%] text-[11px] leading-relaxed"
              style={{ background: 'var(--surface-1)', color: 'var(--text-1)' }}
            >
              <p className="mb-1.5">
                <span className="font-bold">Photosynthesis</span> mein plants
                sunlight se food banate hain:
              </p>
              <p className="mb-1">
                <span className="font-semibold" style={{ color: '#E8581C' }}>
                  Step 1:
                </span>{' '}
                Chlorophyll absorbs light
              </p>
              <p className="mb-1">
                <span className="font-semibold" style={{ color: '#E8581C' }}>
                  Step 2:
                </span>{' '}
                Water splits (photolysis)
              </p>
              <p className="mb-1.5">
                <span className="font-semibold" style={{ color: '#E8581C' }}>
                  Step 3:
                </span>{' '}
                CO₂ → glucose
              </p>
              <div
                className="inline-block text-[9px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}
              >
                6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂
              </div>
              <p className="mt-1.5" style={{ color: 'var(--text-2)' }}>
                Bata sakte ho chlorophyll kahan hota hai? 🌿
              </p>
            </div>
          </div>
          {/* Typing indicator */}
          <div className="flex items-center gap-1.5 pl-9">
            <div className="flex gap-0.5">
              {[0.5, 0.35, 0.2].map((op, i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--text-3)', opacity: op }}
                />
              ))}
            </div>
            <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>
              Type your answer...
            </span>
          </div>
        </div>
      </div>

      {/* Fox mascot peeking from behind phone */}
      <div
        className="absolute -bottom-3 -right-4"
        style={{ transform: 'rotate(12deg)' }}
      >
        <FoxyMark size="md" />
      </div>
    </div>
  );
}

/* ─── Stats Strip ────────────────────────────────────────── */
function StatsStrip() {
  const { isHi } = useLang();
  const stats = [
    { value: '16', label: 'Subjects', labelHi: 'विषय' },
    { value: '6–12', label: 'Grades', labelHi: 'कक्षाएँ' },
    { value: 'हिन्दी+En', label: 'Bilingual', labelHi: 'द्विभाषी' },
    { value: 'DPIIT', label: 'Recognized', labelHi: 'मान्यता प्राप्त' },
  ];
  return (
    <div className="grid grid-cols-4 gap-3 sm:gap-8 max-w-md sm:max-w-none mx-auto mt-10">
      {stats.map((s, i) => (
        <FadeIn key={s.label} delay={i * 0.1}>
          <div className="text-center">
            <div
              className="text-sm sm:text-xl font-extrabold"
              style={{ color: 'var(--orange)' }}
            >
              {s.value}
            </div>
            <div
              className="text-[10px] sm:text-xs font-medium"
              style={{ color: 'var(--text-3)' }}
            >
              {isHi ? s.labelHi : s.label}
            </div>
          </div>
        </FadeIn>
      ))}
    </div>
  );
}

/* ─── Hero (exported) ────────────────────────────────────── */
export function Hero() {
  const { t } = useLang();
  return (
    <>
      <Nav />
      <section className="relative overflow-hidden">
        <div
          className="mesh-bg"
          style={{ position: 'absolute', inset: 0, opacity: 0.5 }}
        />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-10 sm:pt-14 sm:pb-18">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Left — text */}
            <div className="text-center lg:text-left">
              <div
                className="inline-flex items-center gap-2 text-xs font-bold px-4 py-1.5 rounded-full mb-4"
                style={{
                  background: 'rgba(232,88,28,0.08)',
                  color: 'var(--orange)',
                  border: '1px solid rgba(232,88,28,0.15)',
                }}
              >
                <span>🇮🇳</span>
                {t(
                  'CBSE Grades 6–12 · Hindi & English',
                  'CBSE कक्षा 6–12 · हिन्दी और अंग्रेज़ी'
                )}
              </div>

              <h1
                className="text-2xl sm:text-4xl lg:text-5xl font-extrabold leading-tight mb-4"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {t(
                  'What if your child walked into ',
                  'क्या होगा अगर आपका बच्चा '
                )}
                <span className="gradient-text">
                  {t('every exam', 'हर परीक्षा')}
                </span>
                {t(
                  " knowing they're prepared?",
                  ' में तैयार होकर जाए?'
                )}
              </h1>

              <p
                className="text-sm sm:text-lg max-w-xl mb-6"
                style={{ color: 'var(--text-2)', lineHeight: 1.7 }}
              >
                {t(
                  'Alfanumrik is a structured learning system that replaces guesswork with real concept clarity — so you stop worrying and start seeing progress.',
                  'Alfanumrik एक संरचित शिक्षा प्रणाली है जो अंदाज़ों की जगह असली कॉन्सेप्ट क्लैरिटी लाती है — ताकि आप चिंता करना बंद करें और प्रगति देखना शुरू करें।'
                )}
              </p>

              <div id="hero-cta" className="flex flex-col sm:flex-row items-center lg:items-start gap-3">
                <Link
                  href="/login"
                  className="text-base px-8 py-4 rounded-xl font-bold text-white w-full sm:w-auto text-center"
                  style={{
                    background: 'linear-gradient(135deg, #E8581C, #F5A623)',
                  }}
                >
                  {t('Start Learning Free', 'मुफ्त सीखना शुरू करें')}
                </Link>
              </div>
              <p
                className="text-xs mt-2 text-center lg:text-left"
                style={{ color: 'var(--text-3)' }}
              >
                {t(
                  'No credit card · 5 free sessions daily · Cancel anytime',
                  'क्रेडिट कार्ड नहीं · रोज़ 5 मुफ्त सेशन · कभी भी रद्द करें'
                )}
              </p>
              <p className="mt-2 text-center lg:text-left">
                <Link
                  href="/login?role=teacher"
                  className="text-xs hover:underline"
                  style={{ color: 'var(--text-3)' }}
                >
                  {t('Are you a teacher?', 'क्या आप शिक्षक हैं?')}
                </Link>
              </p>
            </div>

            {/* Right — phone mockup */}
            <div className="flex justify-center lg:justify-end">
              <PhoneMockup />
            </div>
          </div>

          <StatsStrip />
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/landing/Hero.tsx
git commit -m "feat(landing): add Hero section with nav, phone mockup, stats strip"
```

---

## Task 6: ProblemSolution Section Component

**Files:**
- Create: `src/components/landing/ProblemSolution.tsx`

- [ ] **Step 1: Create ProblemSolution.tsx**

Create `src/components/landing/ProblemSolution.tsx`:

```tsx
'use client';

import { useLang } from './LangToggle';
import {
  IconBrainFade, IconScatteredDots, IconEyeStrike,
  IconBrainConnected, IconBullseye, IconEyeDashboard,
} from './CustomIcons';
import { FadeIn, StaggerContainer, StaggerItem, HoverScale } from './Animations';

const PROBLEMS = [
  {
    Icon: IconBrainFade,
    title: "Concepts don't stick",
    titleHi: 'कॉन्सेप्ट याद नहीं रहते',
    desc: "They read the chapter, attend the class — and still can't answer the exam question.",
    descHi: 'चैप्टर पढ़ते हैं, क्लास जाते हैं — फिर भी परीक्षा में जवाब नहीं दे पाते।',
  },
  {
    Icon: IconScatteredDots,
    title: 'Practice is random',
    titleHi: 'प्रैक्टिस बेतरतीब है',
    desc: "50 easy questions don't fix the 5 hard ones they keep getting wrong.",
    descHi: '50 आसान सवाल हल करने से वो 5 कठिन सवाल ठीक नहीं होते जो बार-बार गलत होते हैं।',
  },
  {
    Icon: IconEyeStrike,
    title: "You can't see the real picture",
    titleHi: 'आपको असली तस्वीर नहीं दिखती',
    desc: 'By the time the report card arrives, months of gaps have already piled up.',
    descHi: 'जब तक रिपोर्ट कार्ड आता है, महीनों की कमियाँ जमा हो चुकी होती हैं।',
  },
];

const SOLUTIONS = [
  {
    Icon: IconBrainConnected,
    title: 'Concepts explained until they click',
    titleHi: 'कॉन्सेप्ट तब तक समझाए जाते हैं जब तक समझ न आ जाए',
    desc: 'Foxy AI tutor breaks every topic step-by-step. In Hindi or English. Adapts to what your child already knows.',
    descHi: 'Foxy AI ट्यूटर हर टॉपिक स्टेप-बाय-स्टेप समझाता है। हिन्दी या अंग्रेज़ी में। बच्चे की मौजूदा समझ के अनुसार ढलता है।',
  },
  {
    Icon: IconBullseye,
    title: 'Practice targets weak spots only',
    titleHi: 'प्रैक्टिस सिर्फ कमज़ोर जगहों पर',
    desc: "Smart quizzes adapt to your child's level. Board-exam patterns. Bloom's taxonomy built in. No wasted repetition.",
    descHi: 'स्मार्ट क्विज़ बच्चे के स्तर के अनुसार बदलते हैं। बोर्ड परीक्षा पैटर्न। Bloom\'s टैक्सोनॉमी शामिल। बेकार दोहराव नहीं।',
  },
  {
    Icon: IconEyeDashboard,
    title: 'You see progress every day',
    titleHi: 'आप हर दिन प्रगति देखते हैं',
    desc: "Your parent dashboard shows what they studied, what's strong, what needs work — updated after every session.",
    descHi: 'आपका पैरेंट डैशबोर्ड दिखाता है क्या पढ़ा, क्या मज़बूत है, किस पर काम चाहिए — हर सेशन के बाद अपडेट।',
  },
];

export function ProblemSolution() {
  const { isHi, t } = useLang();

  return (
    <section className="py-12 sm:py-16" style={{ background: 'var(--surface-1)' }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <FadeIn className="text-center mb-8 max-w-2xl mx-auto">
          <span
            className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3"
            style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}
          >
            {t('THE REAL PROBLEM', 'असली समस्या')}
          </span>
          <h2
            className="text-2xl sm:text-3xl font-extrabold mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t(
              "Most students study hard. The system they follow doesn't work.",
              'ज़्यादातर बच्चे मेहनत करते हैं। जो सिस्टम वो फॉलो करते हैं, वो काम नहीं करता।'
            )}
          </h2>
        </FadeIn>

        {/* Problem cards */}
        <StaggerContainer className="grid sm:grid-cols-3 gap-4 mb-8">
          {PROBLEMS.map((p) => (
            <StaggerItem key={p.title}>
              <div
                className="rounded-2xl p-5 flex gap-4 items-start"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <p.Icon />
                <div>
                  <h3
                    className="text-sm font-bold mb-1"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {isHi ? p.titleHi : p.title}
                  </h3>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: 'var(--text-2)' }}
                  >
                    {isHi ? p.descHi : p.desc}
                  </p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>

        {/* Visual connector */}
        <FadeIn className="flex flex-col items-center gap-2 my-8">
          <div
            className="w-full max-w-xs h-px"
            style={{
              background: 'linear-gradient(90deg, transparent, #E8581C, #7C3AED, transparent)',
            }}
          />
          <div
            className="flex items-center justify-center w-8 h-8 rounded-full"
            style={{
              background: 'linear-gradient(135deg, rgba(232,88,28,0.1), rgba(124,58,237,0.1))',
              border: '1px solid rgba(232,88,28,0.2)',
            }}
          >
            <span
              className="text-xs"
              style={{ color: 'var(--orange)', lineHeight: 1 }}
            >
              ↓
            </span>
          </div>
          <span
            className="text-xs font-bold"
            style={{ color: 'var(--orange)' }}
          >
            {t("Here's what changes", 'यहाँ बदलाव आता है')}
          </span>
        </FadeIn>

        {/* Solution cards */}
        <StaggerContainer className="grid sm:grid-cols-3 gap-4">
          {SOLUTIONS.map((s) => (
            <StaggerItem key={s.title}>
              <HoverScale>
                <div
                  className="rounded-2xl p-5 flex gap-4 items-start"
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderLeft: '3px solid #16A34A',
                  }}
                >
                  <s.Icon />
                  <div>
                    <h3
                      className="text-sm font-bold mb-1"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {isHi ? s.titleHi : s.title}
                    </h3>
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: 'var(--text-2)' }}
                    >
                      {isHi ? s.descHi : s.desc}
                    </p>
                  </div>
                </div>
              </HoverScale>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/landing/ProblemSolution.tsx
git commit -m "feat(landing): add ProblemSolution section with custom icons and animations"
```

---

## Task 7: ProductShowcase Section Component

**Files:**
- Create: `src/components/landing/ProductShowcase.tsx`

- [ ] **Step 1: Create ProductShowcase.tsx**

Create `src/components/landing/ProductShowcase.tsx`:

```tsx
'use client';

import { useLang } from './LangToggle';
import { FoxyMark } from './FoxyMark';
import { IconBloomLevel, IconXPStar } from './CustomIcons';
import { FadeIn, StaggerContainer, StaggerItem, HoverScale } from './Animations';

/* ─── Card 1: Foxy AI Tutor ─────────────────────────────── */
function FoxyCard() {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}
    >
      <div
        className="px-4 py-3 flex items-center gap-2 border-b"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      >
        <FoxyMark size="sm" />
        <span
          className="text-sm font-bold"
          style={{ fontFamily: 'var(--font-display)', color: '#E8581C' }}
        >
          Foxy AI Tutor
        </span>
        <div className="ml-auto flex gap-1">
          {['Learn', 'Practice', 'Quiz'].map((mode, i) => (
            <span
              key={mode}
              className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
              style={{
                background: i === 0 ? '#E8581C' : 'var(--surface-2)',
                color: i === 0 ? '#fff' : 'var(--text-3)',
              }}
            >
              {mode}
            </span>
          ))}
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex justify-end">
          <div
            className="rounded-2xl rounded-br-md px-3.5 py-2.5 max-w-[80%] text-xs leading-relaxed"
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}
          >
            Photosynthesis samjhao step by step
          </div>
        </div>
        <div className="flex gap-2 items-start">
          <FoxyMark size="sm" />
          <div
            className="rounded-2xl rounded-bl-md px-3.5 py-2.5 max-w-[85%] text-xs leading-relaxed"
            style={{ background: 'var(--surface-1)', color: 'var(--text-1)' }}
          >
            <p className="mb-2">
              <span className="font-bold">Photosynthesis</span> mein plants
              sunlight se food banate hain:
            </p>
            <p className="mb-1">
              <span className="font-semibold" style={{ color: '#E8581C' }}>Step 1:</span>{' '}
              Chlorophyll absorbs light
            </p>
            <p className="mb-1">
              <span className="font-semibold" style={{ color: '#E8581C' }}>Step 2:</span>{' '}
              Water splits (photolysis)
            </p>
            <p className="mb-2">
              <span className="font-semibold" style={{ color: '#E8581C' }}>Step 3:</span>{' '}
              CO₂ → glucose
            </p>
            <div
              className="inline-block text-[10px] font-mono px-2 py-0.5 rounded"
              style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}
            >
              6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂
            </div>
            <p className="mt-2" style={{ color: 'var(--text-2)' }}>
              Bata sakte ho chlorophyll kahan hota hai? 🌿
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Card 2: Parent Dashboard (highlighted) ─────────────── */
function ParentCard() {
  return (
    <div
      className="rounded-2xl overflow-hidden relative sm:-translate-y-2"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        boxShadow: '0 8px 32px rgba(22,163,74,0.12)',
      }}
    >
      {/* "For You" badge */}
      <div
        className="absolute top-3 right-3 text-[10px] font-bold px-2.5 py-1 rounded-full z-10"
        style={{ background: 'rgba(22,163,74,0.1)', color: '#16A34A', border: '1px solid rgba(22,163,74,0.2)' }}
      >
        For You
      </div>
      <div
        className="px-4 py-3 flex items-center gap-2 border-b"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      >
        <span className="text-lg">👨‍👩‍👧</span>
        <span
          className="text-sm font-bold"
          style={{ fontFamily: 'var(--font-display)', color: '#16A34A' }}
        >
          Parent Dashboard
        </span>
      </div>
      <div className="p-4 space-y-3">
        {/* Child info */}
        <div
          className="flex items-center gap-3 rounded-xl p-3"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
            style={{
              background: 'linear-gradient(135deg, rgba(232,88,28,0.15), rgba(251,248,244,0.8))',
              color: '#E8581C',
            }}
          >
            A
          </div>
          <div>
            <div className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>
              Aarav Sharma
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
              Class 8 · CBSE
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: '#16A34A' }}
            />
            <span className="text-[10px] font-semibold" style={{ color: '#16A34A' }}>
              Active today
            </span>
          </div>
        </div>

        {/* Weekly summary */}
        <div
          className="rounded-xl p-3"
          style={{
            background: 'rgba(22,163,74,0.04)',
            border: '1px solid rgba(22,163,74,0.12)',
          }}
        >
          <div className="text-[10px] font-semibold mb-2" style={{ color: '#16A34A' }}>
            This Week
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { val: '5', label: 'Quizzes' },
              { val: '82%', label: 'Avg Score' },
              { val: '45m', label: 'Study Time' },
            ].map((m) => (
              <div key={m.label}>
                <div className="text-sm font-extrabold" style={{ color: 'var(--text-1)' }}>
                  {m.val}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Strengths / Weaknesses with mastery bars */}
        <div className="grid grid-cols-2 gap-2">
          <div
            className="rounded-xl p-2.5"
            style={{
              background: 'rgba(22,163,74,0.04)',
              border: '1px solid rgba(22,163,74,0.12)',
              borderLeft: '3px solid #16A34A',
            }}
          >
            <div className="text-[10px] font-semibold mb-1.5" style={{ color: '#16A34A' }}>
              Strong
            </div>
            {['Algebra', 'Photosynthesis', 'Grammar'].map((topic) => (
              <div key={topic} className="flex items-center gap-1.5 mb-1">
                <div
                  className="h-1.5 rounded-full flex-1"
                  style={{ background: 'rgba(22,163,74,0.15)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${75 + Math.random() * 20}%`,
                      background: '#16A34A',
                    }}
                  />
                </div>
                <span className="text-[9px] shrink-0 w-16" style={{ color: 'var(--text-2)' }}>
                  {topic}
                </span>
              </div>
            ))}
          </div>
          <div
            className="rounded-xl p-2.5"
            style={{
              background: 'rgba(232,88,28,0.04)',
              border: '1px solid rgba(232,88,28,0.12)',
              borderLeft: '3px solid #E8581C',
            }}
          >
            <div className="text-[10px] font-semibold mb-1.5" style={{ color: '#E8581C' }}>
              Needs Work
            </div>
            {['Geometry', 'Chemical Rxns'].map((topic) => (
              <div key={topic} className="flex items-center gap-1.5 mb-1">
                <div
                  className="h-1.5 rounded-full flex-1"
                  style={{ background: 'rgba(232,88,28,0.1)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${30 + Math.random() * 20}%`,
                      background: '#E8581C',
                    }}
                  />
                </div>
                <span className="text-[9px] shrink-0 w-16" style={{ color: 'var(--text-2)' }}>
                  {topic}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Card 3: Smart Quiz ─────────────────────────────────── */
function QuizCard() {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}
    >
      <div
        className="px-4 py-3 flex items-center justify-between border-b"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span
            className="text-sm font-bold"
            style={{ fontFamily: 'var(--font-display)', color: '#2563EB' }}
          >
            Smart Quiz
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}
          >
            <IconBloomLevel activeLevel={1} /> Apply
          </span>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(232,88,28,0.08)', color: '#E8581C' }}
          >
            Medium
          </span>
        </div>
      </div>
      <div className="p-4 space-y-3">
        {/* Segmented progress bar */}
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold" style={{ color: 'var(--text-3)' }}>
            Question 7 of 10
          </span>
          <span className="text-[10px] font-bold" style={{ color: '#E8581C' }}>
            7/10
          </span>
        </div>
        <div className="flex gap-0.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="h-1.5 flex-1 rounded-sm"
              style={{
                background: i < 7
                  ? 'linear-gradient(90deg, #E8581C, #F5A623)'
                  : 'var(--surface-2)',
              }}
            />
          ))}
        </div>

        {/* Question */}
        <p
          className="text-xs font-semibold leading-relaxed mt-2"
          style={{ color: 'var(--text-1)' }}
        >
          Which of the following is the correct product of photosynthesis?
        </p>

        {/* Options */}
        <div className="space-y-2 mt-2">
          {[
            { label: 'A', text: 'Carbon dioxide and water', correct: false },
            { label: 'B', text: 'Glucose and oxygen', correct: true },
            { label: 'C', text: 'Starch and nitrogen', correct: false },
            { label: 'D', text: 'Protein and hydrogen', correct: false },
          ].map((opt) => (
            <div
              key={opt.label}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs"
              style={{
                background: opt.correct ? 'rgba(22,163,74,0.08)' : 'var(--surface-1)',
                border: opt.correct
                  ? '1.5px solid rgba(22,163,74,0.4)'
                  : '1px solid var(--border)',
                color: opt.correct ? '#16A34A' : 'var(--text-1)',
                fontWeight: opt.correct ? 600 : 400,
              }}
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{
                  background: opt.correct ? '#16A34A' : 'var(--surface-2)',
                  color: opt.correct ? '#fff' : 'var(--text-3)',
                }}
              >
                {opt.correct ? '✓' : opt.label}
              </span>
              {opt.text}
            </div>
          ))}
        </div>

        {/* XP feedback */}
        <div
          className="flex items-center gap-1.5 text-[10px] font-semibold mt-1"
          style={{ color: '#16A34A' }}
        >
          <span>✅</span> Correct!{' '}
          <span className="inline-flex items-center gap-0.5" style={{ color: '#E8581C' }}>
            +10 <IconXPStar /> XP
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Exported Section ───────────────────────────────────── */
export function ProductShowcase() {
  const { t } = useLang();
  return (
    <section className="py-12 sm:py-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <FadeIn className="text-center mb-8 max-w-2xl mx-auto">
          <span
            className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3"
            style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}
          >
            {t('SEE IT IN ACTION', 'देखें कैसे काम करता है')}
          </span>
          <h2
            className="text-2xl sm:text-3xl font-extrabold mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t('Real product. Real interface. Not stock photos.', 'असली प्रोडक्ट। असली इंटरफ़ेस। स्टॉक फ़ोटो नहीं।')}
          </h2>
        </FadeIn>

        {/* Mobile: Parent card first (stacked). Desktop: 3-col grid */}
        <StaggerContainer className="grid sm:grid-cols-3 gap-5">
          {/* On mobile, parent card renders first via order utility */}
          <StaggerItem className="sm:order-1 order-2">
            <HoverScale>
              <FoxyCard />
            </HoverScale>
            <p className="text-xs text-center mt-3" style={{ color: 'var(--text-2)' }}>
              {t(
                'Your child asks. Foxy explains. In Hindi, English, or both.',
                'आपका बच्चा पूछता है। Foxy समझाता है। हिन्दी, अंग्रेज़ी, या दोनों में।'
              )}
            </p>
          </StaggerItem>
          <StaggerItem className="sm:order-2 order-1">
            <HoverScale>
              <ParentCard />
            </HoverScale>
            <p className="text-xs text-center mt-3" style={{ color: 'var(--text-2)' }}>
              {t(
                "See what they studied. Know what's weak. No surprises.",
                'देखें क्या पढ़ा। जानें क्या कमज़ोर है। कोई सरप्राइज़ नहीं।'
              )}
            </p>
          </StaggerItem>
          <StaggerItem className="sm:order-3 order-3">
            <HoverScale>
              <QuizCard />
            </HoverScale>
            <p className="text-xs text-center mt-3" style={{ color: 'var(--text-2)' }}>
              {t(
                'Board-pattern questions. Instant feedback. Real improvement.',
                'बोर्ड-पैटर्न सवाल। तुरंत फीडबैक। असली सुधार।'
              )}
            </p>
          </StaggerItem>
        </StaggerContainer>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/landing/ProductShowcase.tsx
git commit -m "feat(landing): add ProductShowcase with Foxy, Parent, Quiz mockup cards"
```

---

## Task 8: CredibilityStrip Section Component

**Files:**
- Create: `src/components/landing/CredibilityStrip.tsx`

- [ ] **Step 1: Create CredibilityStrip.tsx**

Create `src/components/landing/CredibilityStrip.tsx`:

```tsx
'use client';

import { useLang } from './LangToggle';
import {
  IconAshoka, IconShield, IconPadlock, IconBook, IconNoAds,
} from './CustomIcons';
import { FadeIn, StaggerContainer, StaggerItem } from './Animations';

const BADGES = [
  { Icon: IconAshoka, label: 'DPIIT Recognized Startup', labelHi: 'DPIIT मान्यता प्राप्त स्टार्टअप' },
  { Icon: IconShield, label: 'DPDPA Compliant', labelHi: 'DPDPA अनुपालित' },
  { Icon: IconPadlock, label: 'Data Encrypted', labelHi: 'डेटा एन्क्रिप्टेड' },
  { Icon: IconBook, label: 'NCERT Aligned', labelHi: 'NCERT के अनुरूप' },
  { Icon: IconNoAds, label: 'No Ads. Ever.', labelHi: 'कभी विज्ञापन नहीं।' },
];

export function CredibilityStrip() {
  const { isHi, t } = useLang();

  return (
    <section
      className="py-8 sm:py-10 border-y"
      style={{
        background: 'linear-gradient(135deg, rgba(232,88,28,0.03), rgba(124,58,237,0.03))',
        borderColor: 'var(--border)',
      }}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col items-center gap-5">
        {/* Layer 1: Trust badges */}
        <StaggerContainer className="flex flex-wrap items-center justify-center gap-2.5">
          {BADGES.map((badge) => (
            <StaggerItem key={badge.label}>
              <span
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full"
                style={{
                  background: 'rgba(255,255,255,0.6)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.4)',
                  color: 'var(--text-2)',
                }}
              >
                <badge.Icon />
                {isHi ? badge.labelHi : badge.label}
              </span>
            </StaggerItem>
          ))}
        </StaggerContainer>

        {/* Layer 2: Metrics line */}
        <FadeIn>
          <p className="text-sm font-medium text-center" style={{ color: 'var(--text-2)' }}>
            {[
              { val: '16', label: t('subjects', 'विषय') },
              { val: '7', label: t('grades', 'कक्षाएँ') },
              { val: '115', label: t('STEM experiments', 'STEM प्रयोग') },
              { val: '6', label: t("Bloom's levels in every quiz", 'हर क्विज़ में Bloom\'s स्तर') },
              { val: '', label: t('Hindi & English', 'हिन्दी और अंग्रेज़ी') },
              { val: '', label: t('Built in India', 'भारत में निर्मित') },
            ].map((m, i, arr) => (
              <span key={i}>
                {m.val && (
                  <span className="font-bold" style={{ color: 'var(--text-1)' }}>
                    {m.val}{' '}
                  </span>
                )}
                {m.label}
                {i < arr.length - 1 && (
                  <span style={{ color: 'var(--orange)', opacity: 0.5 }}> · </span>
                )}
              </span>
            ))}
          </p>
        </FadeIn>

        {/* Layer 3: Aspirational line + legal */}
        <FadeIn>
          <div className="text-center">
            <p className="text-xs italic" style={{ color: 'var(--text-3)' }}>
              {t(
                'Trusted by parents who want more than tuition classes.',
                'उन माता-पिता का भरोसा जो ट्यूशन क्लास से ज़्यादा चाहते हैं।'
              )}
            </p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
              Cusiosense Learning India Pvt. Ltd. · CIN: U58200UP2025PTC238093
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/landing/CredibilityStrip.tsx
git commit -m "feat(landing): add CredibilityStrip with glass-morphism trust badges"
```

---

## Task 9: FinalCTA Section Component (with FAQ)

**Files:**
- Create: `src/components/landing/FinalCTA.tsx`

- [ ] **Step 1: Create FinalCTA.tsx**

Create `src/components/landing/FinalCTA.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useLang } from './LangToggle';
import { FoxyMark } from './FoxyMark';
import { FadeIn } from './Animations';

const FAQS = [
  {
    q: 'Is it really free?',
    qHi: 'क्या यह सच में मुफ्त है?',
    a: 'Yes. The free plan includes 5 AI tutor sessions and 5 quizzes per day across 2 subjects. No credit card needed. Upgrade to Starter (₹399/mo), Pro (₹699/mo), or Unlimited (₹999/mo) when you want more.',
    aHi: 'हाँ। फ्री प्लान में रोज़ 2 विषयों में 5 AI ट्यूटर सेशन और 5 क्विज़ शामिल हैं। क्रेडिट कार्ड नहीं चाहिए। Starter (₹399/माह), Pro (₹699/माह), या Unlimited (₹999/माह) में अपग्रेड करें जब ज़रूरत हो।',
  },
  {
    q: 'Is it safe for my child?',
    qHi: 'क्या यह मेरे बच्चे के लिए सुरक्षित है?',
    a: "All data is encrypted. We follow India's DPDPA data protection rules. We never show ads, never sell data, and AI responses are filtered to stay age-appropriate and within CBSE curriculum.",
    aHi: 'सारा डेटा एन्क्रिप्टेड है। हम भारत के DPDPA डेटा सुरक्षा नियमों का पालन करते हैं। हम कभी विज्ञापन नहीं दिखाते, कभी डेटा नहीं बेचते, और AI जवाब उम्र के अनुसार और CBSE पाठ्यक्रम के अंदर रहते हैं।',
  },
  {
    q: 'Which grades and subjects?',
    qHi: 'कौन सी कक्षाएँ और विषय?',
    a: 'CBSE Grades 6–12. 16 subjects including Mathematics, Science, Physics, Chemistry, Biology, English, Hindi, Social Science, and more.',
    aHi: 'CBSE कक्षा 6–12। 16 विषय जिनमें गणित, विज्ञान, भौतिकी, रसायन विज्ञान, जीव विज्ञान, अंग्रेज़ी, हिन्दी, सामाजिक विज्ञान, और बहुत कुछ शामिल है।',
  },
];

function FaqJsonLd() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function FinalCTA() {
  const { isHi, t } = useLang();

  return (
    <>
      <FaqJsonLd />
      <section id="final-cta" className="relative overflow-hidden py-14 sm:py-20">
        <div
          className="mesh-bg"
          style={{ position: 'absolute', inset: 0, opacity: 0.4 }}
        />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
          {/* Foxy mark */}
          <FadeIn className="flex justify-center mb-4">
            <div className="animate-scale-in">
              <FoxyMark size="lg" />
            </div>
          </FadeIn>

          {/* Headline */}
          <h2
            className="text-2xl sm:text-4xl font-extrabold mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t(
              'Every week without a system is a week of ',
              'बिना सिस्टम के हर हफ्ता '
            )}
            <span className="gradient-text">
              {t('guesswork', 'अंदाज़ों')}
            </span>
            {t('.', ' का हफ्ता है।')}
          </h2>

          <p
            className="text-sm sm:text-lg mb-8"
            style={{ color: 'var(--text-2)', lineHeight: 1.7 }}
          >
            {t(
              'Start free. See the difference in how your child studies within the first week.',
              'मुफ्त शुरू करें। पहले हफ्ते में ही फर्क देखें।'
            )}
          </p>

          {/* Primary CTA with pulse-glow */}
          <Link
            href="/login"
            className="inline-block text-base px-10 py-4 rounded-2xl font-bold text-white"
            style={{
              background: 'linear-gradient(135deg, #E8581C, #F5A623)',
              animation: 'pulse-glow 3s ease-in-out infinite',
            }}
          >
            {t('Start Learning Free', 'मुफ्त सीखना शुरू करें')}
          </Link>

          <p
            className="text-xs mt-3"
            style={{ color: 'var(--text-3)' }}
          >
            {t(
              'No credit card · 5 free sessions daily · Works on any phone',
              'क्रेडिट कार्ड नहीं · रोज़ 5 मुफ्त सेशन · किसी भी फ़ोन पर'
            )}
          </p>

          {/* Secondary role links */}
          <p className="mt-3 text-xs" style={{ color: 'var(--text-3)' }}>
            {t("I'm a ", 'मैं ')}{' '}
            <Link href="/login?role=teacher" className="underline hover:no-underline">
              {t('teacher', 'शिक्षक हूँ')}
            </Link>
            {' · '}
            {t("I'm a ", 'मैं ')}{' '}
            <Link href="/login" className="underline hover:no-underline">
              {t('student', 'छात्र हूँ')}
            </Link>
          </p>

          {/* Compressed FAQ */}
          <div className="mt-12 max-w-2xl mx-auto text-left">
            <h3
              className="text-sm font-bold mb-3 text-center"
              style={{ color: 'var(--text-3)' }}
            >
              {t('Quick answers', 'त्वरित जवाब')}
            </h3>
            <div className="space-y-2">
              {FAQS.map((faq) => (
                <details
                  key={faq.q}
                  className="group rounded-2xl"
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <summary
                    className="flex items-center justify-between cursor-pointer px-4 py-3.5 text-sm font-semibold list-none"
                    style={{ color: 'var(--text-1)' }}
                  >
                    {isHi ? faq.qHi : faq.q}
                    <span
                      className="text-lg transition-transform duration-200 group-open:rotate-45 shrink-0 ml-3"
                      style={{ color: 'var(--text-3)' }}
                    >
                      +
                    </span>
                  </summary>
                  <div
                    className="px-4 pb-3.5 text-sm leading-relaxed"
                    style={{ color: 'var(--text-2)' }}
                  >
                    {isHi ? faq.aHi : faq.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/landing/FinalCTA.tsx
git commit -m "feat(landing): add FinalCTA section with pulse-glow button and 3-item FAQ"
```

---

## Task 10: Footer Component

**Files:**
- Create: `src/components/landing/Footer.tsx`

- [ ] **Step 1: Create Footer.tsx**

Create `src/components/landing/Footer.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useLang } from './LangToggle';
import { FoxyMark } from './FoxyMark';

export function Footer() {
  const { t } = useLang();

  return (
    <footer
      className="py-8 sm:py-10 border-t"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Row 1: Three columns */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 mb-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FoxyMark size="sm" />
              <span
                className="text-base font-extrabold gradient-text"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Alfanumrik
              </span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {t(
                'Structured learning for CBSE students',
                'CBSE छात्रों के लिए संरचित शिक्षा'
              )}
              <br />
              Cusiosense Learning India Pvt. Ltd.
            </p>
          </div>

          {/* Quick links */}
          <div>
            <h4
              className="text-xs font-bold uppercase tracking-wider mb-3"
              style={{ color: 'var(--text-3)' }}
            >
              {t('Product', 'उत्पाद')}
            </h4>
            <div className="space-y-2">
              {[
                { href: '/pricing', label: 'Pricing', labelHi: 'मूल्य' },
                { href: '/for-schools', label: 'For Schools', labelHi: 'स्कूलों के लिए' },
                { href: '/login', label: 'Student Login', labelHi: 'छात्र लॉगिन' },
                { href: '/login?role=parent', label: 'Parent Login', labelHi: 'पैरेंट लॉगिन' },
                { href: '/login?role=teacher', label: 'Teacher Login', labelHi: 'शिक्षक लॉगिन' },
              ].map((l) => (
                <Link
                  key={l.href + l.label}
                  href={l.href}
                  className="block text-sm hover:underline"
                  style={{ color: 'var(--text-2)' }}
                >
                  {t(l.label, l.labelHi)}
                </Link>
              ))}
            </div>
          </div>

          {/* Contact & Legal */}
          <div>
            <h4
              className="text-xs font-bold uppercase tracking-wider mb-3"
              style={{ color: 'var(--text-3)' }}
            >
              {t('Contact & Legal', 'संपर्क और कानूनी')}
            </h4>
            <div className="space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
              <p>support@alfanumrik.com</p>
              <Link href="/privacy" className="block hover:underline">
                {t('Privacy Policy', 'गोपनीयता नीति')}
              </Link>
              <Link href="/terms" className="block hover:underline">
                {t('Terms', 'शर्तें')}
              </Link>
            </div>
          </div>
        </div>

        {/* Row 2: Bottom bar */}
        <div
          className="pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            © {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd.{' '}
            {t('All rights reserved.', 'सर्वाधिकार सुरक्षित।')}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {t(
              'DPIIT Recognized · DPDPA Compliant · Data Encrypted · No Ads',
              'DPIIT मान्यता प्राप्त · DPDPA अनुपालित · डेटा एन्क्रिप्टेड · कोई विज्ञापन नहीं'
            )}
          </p>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/landing/Footer.tsx
git commit -m "feat(landing): add Footer with 3-column layout and trust bottom bar"
```

---

## Task 11: Rewrite page.tsx — Compose All Sections

**Files:**
- Rewrite: `src/app/welcome/page.tsx`

- [ ] **Step 1: Rewrite page.tsx as thin composer**

Replace the entire content of `src/app/welcome/page.tsx` with:

```tsx
'use client';

import { LangProvider } from '@/components/landing/LangToggle';
import { Hero } from '@/components/landing/Hero';
import { ProblemSolution } from '@/components/landing/ProblemSolution';
import { ProductShowcase } from '@/components/landing/ProductShowcase';
import { CredibilityStrip } from '@/components/landing/CredibilityStrip';
import { FinalCTA } from '@/components/landing/FinalCTA';
import { Footer } from '@/components/landing/Footer';
import { StickyMobileCTA } from '@/components/landing/StickyMobileCTA';

export default function WelcomePage() {
  return (
    <LangProvider>
      <div style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>
        <Hero />
        <ProblemSolution />
        <ProductShowcase />
        <CredibilityStrip />
        <FinalCTA />
        <Footer />
        <StickyMobileCTA />
      </div>
    </LangProvider>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/welcome/page.tsx
git commit -m "feat(landing): rewrite welcome page as thin composer of 6 section components"
```

---

## Task 12: Update SEO Metadata in layout.tsx

**Files:**
- Modify: `src/app/welcome/layout.tsx`

- [ ] **Step 1: Update metadata**

Replace the entire `metadata` export in `src/app/welcome/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Alfanumrik — What if your child walked into every exam prepared?',
  description:
    'Alfanumrik is a structured learning system for CBSE students in Grades 6–12. Replaces guesswork with real concept clarity, targeted practice, and daily progress tracking — in Hindi and English.',
  keywords:
    'CBSE learning platform, adaptive learning India, exam preparation CBSE, concept clarity students, parent dashboard education, AI tutor Hindi English, structured learning system, board exam preparation, NCERT aligned platform, online education India',
  openGraph: {
    title: 'Alfanumrik — What if your child walked into every exam prepared?',
    description:
      'Structured learning that replaces guesswork with concept clarity. CBSE Grades 6–12 in Hindi & English. Free to start.',
    url: 'https://alfanumrik.com/welcome',
    locale: 'en_IN',
    type: 'website',
    siteName: 'Alfanumrik',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alfanumrik — Structured Learning for CBSE Students',
    description:
      'What if your child walked into every exam prepared? Concept clarity, targeted practice, daily progress. Grades 6–12.',
  },
  alternates: { canonical: 'https://alfanumrik.com/welcome' },
};

export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return children;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/welcome/layout.tsx
git commit -m "feat(landing): update SEO metadata with parent-focused headline and keywords"
```

---

## Task 13: Type-Check and Lint

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript type-check**

Run: `npm run type-check`
Expected: Exit 0 with no errors

- [ ] **Step 2: Run ESLint**

Run: `npm run lint`
Expected: Exit 0 (warnings OK, no errors)

- [ ] **Step 3: Fix any issues found**

If type-check or lint fail, fix the specific errors in the affected component files and re-run. Common issues:
- Missing `'use client'` directives (all landing components need them)
- Unused imports
- Apostrophes in JSX text (use `&apos;` or `{'\''}}`)

- [ ] **Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix(landing): resolve type-check and lint issues"
```

---

## Task 14: Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run production build**

Run: `npm run build`
Expected: Exit 0. Check that the `/welcome` page builds successfully.

- [ ] **Step 2: Check bundle size**

In the build output, locate the `/welcome` page entry. Verify:
- Page JS < 260 kB (P10 budget)
- No new heavy chunks added

If bundle exceeds budget, split the largest component or defer non-critical sections.

- [ ] **Step 3: Final commit with passing build**

```bash
git add -A
git commit -m "build: verify landing page redesign passes production build within P10 budget"
```

---

## Summary

| Task | Component | Est. Time |
|------|-----------|-----------|
| 1 | FoxyMark (branded CSS fox) | 3 min |
| 2 | CustomIcons (13 CSS icons) | 5 min |
| 3 | StickyMobileCTA | 3 min |
| 4 | pulse-glow keyframe | 2 min |
| 5 | Hero section | 5 min |
| 6 | ProblemSolution section | 4 min |
| 7 | ProductShowcase section | 5 min |
| 8 | CredibilityStrip section | 3 min |
| 9 | FinalCTA + FAQ section | 4 min |
| 10 | Footer | 3 min |
| 11 | page.tsx composer rewrite | 2 min |
| 12 | SEO metadata update | 2 min |
| 13 | Type-check + lint | 3 min |
| 14 | Build verification | 3 min |
| **Total** | **14 tasks** | **~47 min** |