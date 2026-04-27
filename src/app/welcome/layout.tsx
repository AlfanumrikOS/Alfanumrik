import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, Newsreader, Mukta, JetBrains_Mono } from 'next/font/google';
import JsonLd from '@/components/JsonLd';

/* ────────────────────────────────────────────────────────────────
   Self-hosted Google Fonts via next/font.
   These are only loaded for the /welcome route — the root layout
   uses Sora + Plus Jakarta Sans for the rest of the app.
   `display: 'swap'` keeps text visible during load.
   ──────────────────────────────────────────────────────────────── */

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-inter',
  display: 'swap',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
  display: 'swap',
});

// Mukta has the Devanagari subset (Mukta Vaani exists too, but next/font's
// Mukta_Vaani type only exposes latin/gujarati subsets). Mukta is the same
// family lineage from Ek Type and matches the editorial intent of the design
// spec; its Devanagari weight 700 carries the hero numeral cleanly.
const mukta = Mukta({
  subsets: ['latin', 'devanagari'],
  weight: ['500', '700'],
  variable: '--font-mukta',
  display: 'swap',
  preload: true, // hero numeral uses 700 — preload it for LCP
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

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
  // Compose the font CSS-variable classes on a wrapper so child components
  // can resolve var(--font-newsreader) / var(--font-mukta) / etc.
  const fontVars = [
    inter.variable,
    newsreader.variable,
    mukta.variable,
    jetbrains.variable,
  ].join(' ');

  return (
    <div className={fontVars}>
      <JsonLd />
      {children}
    </div>
  );
}
