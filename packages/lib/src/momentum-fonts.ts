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
import {
  Fraunces,
  Plus_Jakarta_Sans,
  Sora,
  Noto_Sans_Devanagari,
  Noto_Serif_Devanagari,
} from 'next/font/google';

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-fraunces',
  // Latin/serif fallbacks only; Devanagari falls through the var() stack below.
  fallback: ['Georgia', 'serif'],
});

// ─── Devanagari fallbacks (P7 fix, Phase 1) ───────────────────────────────
// Fraunces / Sora / Plus Jakarta Sans carry NO Devanagari glyphs, yet they are
// applied to isHi (Hindi) headings and body across 62 files — so Hindi runs
// previously fell to whatever the OS happened to ship (inconsistent, sometimes
// tofu). These two self-hosted Noto Devanagari faces are appended to the END of
// every font stack below (Latin runs still get Fraunces/Sora/Jakarta first; the
// browser only reaches these for Devanagari codepoints).
//
// P10 budget: `preload: false` + the `devanagari` subset only. The @font-face is
// registered unconditionally but the file is NOT fetched until Devanagari text
// actually paints — English-only sessions ship zero extra font bytes.
const notoSansDeva = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--font-noto-sans-deva',
  preload: false,
});

const notoSerifDeva = Noto_Serif_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--font-noto-serif-deva',
  preload: false,
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
export const momentumFontClass = `${fraunces.variable} ${jakarta.variable} ${sora.variable} ${notoSansDeva.variable} ${notoSerifDeva.variable}`;

// Inline style that maps the hashed next/font variables onto the canonical
// token names globals.css already reads. The self-hosted Noto Devanagari vars
// are appended AFTER the Latin faces so Hindi (Devanagari) headings/body always
// render with real glyphs instead of tofu, while Latin runs keep the premium
// Fraunces/Sora/Jakarta voice. The literal family names ("Noto … Devanagari")
// are kept as a further fallback to a system-installed copy on budget Androids.
export const momentumFontVars: React.CSSProperties = {
  ['--font-body' as string]: `var(--font-jakarta), "Plus Jakarta Sans", var(--font-noto-sans-deva), "Noto Sans Devanagari", system-ui, sans-serif`,
  ['--font-display' as string]: `var(--font-sora), "Sora", var(--font-noto-sans-deva), "Noto Sans Devanagari", system-ui, sans-serif`,
  ['--font-serif' as string]: `var(--font-fraunces), "Fraunces", var(--font-noto-serif-deva), "Noto Serif Devanagari", Georgia, serif`,
};
