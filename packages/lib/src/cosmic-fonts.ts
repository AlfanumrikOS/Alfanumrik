/**
 * Cosmic redesign — typography loader (Phase 0 foundation).
 *
 * Loads the cosmic visual-identity typefaces via `next/font/google` so they
 * are self-hosted (no third-party <link>, no FOUT, no ad-blocker breakage)
 * and tree-shaken per-subset:
 *
 *   - Space Grotesk → display / headings   → --font-cosmic-display
 *   - Onest         → body / UI            → --font-cosmic-body
 *   - Mukta         → Devanagari (Hindi)   → --font-cosmic-hi
 *   - JetBrains Mono→ tabular / code       → --font-cosmic-mono
 *
 * P10 bundle budget: every face uses a narrow weight set + `display: 'swap'`
 * and `preload: false`, so no cosmic font file is fetched until the cosmic CSS
 * actually matches it to rendered text. The CSS variables are emitted onto the
 * root layout's <html>; the cosmic token block in globals.css
 * (`html[data-design="cosmic"]`) is the ONLY place that consumes them, so when
 * `ff_cosmic_redesign_v1` is OFF (no `data-design` attribute) these variables
 * are defined but never referenced — the existing Sora / Plus Jakarta Sans
 * typography renders unchanged and no extra font bytes ship.
 *
 * Mukta is the chosen Devanagari face: `next/font`'s typed `Mukta` exposes the
 * `devanagari` subset and matches the prototype's editorial intent (the design
 * source used "Hind", which is the same Ek Type lineage; Mukta is its
 * next/font-typed sibling and is already used on /welcome).
 *
 * NOTE: `next/font` requires these calls to live at module scope (not inside a
 * function). Import the singleton `cosmicFontVars` string into the layout.
 */
import { Space_Grotesk, Onest, Mukta, JetBrains_Mono } from 'next/font/google';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-cosmic-display',
  display: 'swap',
  preload: false,
});

const onest = Onest({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-cosmic-body',
  display: 'swap',
  // preload:false on EVERY cosmic face is deliberate. The font CSS variables
  // are attached to <html> unconditionally, but the faces are only matched to
  // rendered text inside the html[data-design="cosmic"] scope. With the flag
  // OFF there is no such text, so the browser never fetches a cosmic font file
  // — the flag-OFF page stays byte-identical and within the P10 budget. When
  // the flag is ON the faces download lazily as the cosmic surfaces paint.
  preload: false,
});

const mukta = Mukta({
  subsets: ['latin', 'devanagari'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-cosmic-hi',
  display: 'swap',
  preload: false, // Devanagari is loaded lazily; only Hindi users pay for it
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-cosmic-mono',
  display: 'swap',
  preload: false,
});

/**
 * Space-joined string of all cosmic font CSS-variable class names. Apply this
 * to a wrapper element so descendants can resolve `var(--font-cosmic-display)`
 * etc. Safe to apply unconditionally — the variables only take visual effect
 * inside the `html[data-design="cosmic"]` scope.
 */
export const cosmicFontVars = [
  spaceGrotesk.variable,
  onest.variable,
  mukta.variable,
  jetbrainsMono.variable,
].join(' ');
