// Alfa Momentum — self-hosted fonts (Wave 0)
//
// Replaces the render-blocking raw Google Fonts <link> in layout.tsx with
// next/font/google, which self-hosts the files, inlines the @font-face with
// `display: swap`, and exposes CSS variables. We wire each font to the SAME
// variable NAMES that globals.css already consumes (--font-display /
// --font-body / --font-serif) so zero CSS has to change.
//
//   --font-body    → Plus Jakarta Sans (UI / body)
//   --font-display → Sora              (headings / data-voice)
//   --font-serif   → Fraunces          (premium editorial headlines)
//
// Fraunces has NO Devanagari glyphs. The fallback stack baked into the
// variable values below keeps Hindi (isHi) headings legible — the browser
// falls through to the system sans for Devanagari runs while Latin runs get
// Fraunces. We DO NOT pass `fallback` glyphs that would break that handoff.
import { Fraunces, Plus_Jakarta_Sans, Sora } from 'next/font/google';

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-fraunces',
  // Latin/serif fallbacks only; Devanagari falls through the var() stack below.
  fallback: ['Georgia', 'serif'],
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-jakarta',
  fallback: ['system-ui', 'sans-serif'],
});

const sora = Sora({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-sora',
  fallback: ['system-ui', 'sans-serif'],
});

// Space-joined className that mounts next/font's hashed variables on <html>.
export const momentumFontClass = `${fraunces.variable} ${jakarta.variable} ${sora.variable}`;

// Inline style that maps the hashed next/font variables onto the canonical
// token names globals.css already reads. Devanagari fallbacks are appended so
// Hindi headings never disappear when Fraunces/Sora lack the glyphs.
export const momentumFontVars: React.CSSProperties = {
  ['--font-body' as string]: `var(--font-jakarta), "Plus Jakarta Sans", system-ui, sans-serif`,
  ['--font-display' as string]: `var(--font-sora), "Sora", system-ui, sans-serif`,
  ['--font-serif' as string]: `var(--font-fraunces), "Fraunces", Georgia, serif`,
};
