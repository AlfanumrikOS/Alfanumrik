import type { Metadata } from 'next';
import Link from 'next/link';
import Breadcrumbs from '@alfanumrik/ui/Breadcrumbs';

export const metadata: Metadata = {
  title: 'Careers — Alfanumrik',
  description:
    'Build the learning OS for India. Senior engineering, content, and customer success roles at Alfanumrik (Cusiosense Learning India).',
  openGraph: {
    title: 'Careers — Alfanumrik',
    description:
      'Build the learning OS for India. Senior engineering, content, and customer success roles at Alfanumrik (Cusiosense Learning India).',
    url: 'https://alfanumrik.com/careers',
    siteName: 'Alfanumrik',
    type: 'website',
    locale: 'en_IN',
  },
  alternates: { canonical: 'https://alfanumrik.com/careers' },
};

/* ─── Data ─── */

const WHY = [
  {
    icon: '🎯',
    title: 'Real impact',
    desc: '12,000+ children across 247 cities. Every line of code reaches a real student.',
  },
  {
    icon: '🌏',
    title: 'Mission-driven',
    desc: 'DPIIT-recognised. NCERT-aligned. Built in Bengaluru, for Indian classrooms.',
  },
  {
    icon: '🧠',
    title: 'Hard problems',
    desc: 'Adaptive learning, RAG over textbooks, bilingual AI tutoring. The work is non-trivial.',
  },
];

const ROLES = [
  {
    title: 'Senior AI/ML Engineer — Foxy tutor & RAG pipeline',
    desc: 'Own the retrieval and reasoning stack behind our patient AI tutor. Voyage embeddings, Claude orchestration, NCERT grounding.',
  },
  {
    title: 'Senior Backend Engineer — payments, notifications, edge functions',
    desc: 'Razorpay subscriptions, Supabase Edge Functions in Deno, transactional email and WhatsApp. Reliability matters here.',
  },
  {
    title: 'Senior Frontend Engineer — Next.js, React, accessibility',
    desc: 'Next.js 16 App Router, SWR, Tailwind. Bilingual UI, mobile-first, designed for Indian 4G.',
  },
  {
    title: 'Content & Curriculum Lead — CBSE 6-12, NEP-aligned',
    desc: 'Map every chapter into question banks, concept graphs, and Bloom\'s-tagged exercises. Teacher background preferred.',
  },
  {
    title: 'Customer Success — Bilingual, K-12 schools',
    desc: 'Onboard schools and parents. Hindi + English fluency. Comfort with classroom realities and tier-2 city logistics.',
  },
];

/* ─── Sub-Components ─── */

function Navbar() {
  return (
    <nav style={navStyle}>
      <div style={navInner}>
        <Link href="/welcome" style={logoLink}>
          <span style={{ fontSize: 24 }}>🦊</span>
          <span style={logoText}>Alfanumrik</span>
        </Link>
        <Link href="/welcome" style={navLink}>Home</Link>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer style={footerStyle}>
      <div style={footerInner}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/privacy" style={footerLink}>Privacy Policy</Link>
          <Link href="/terms" style={footerLink}>Terms of Service</Link>
          <Link href="/contact" style={footerLink}>Contact</Link>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3, #888)', marginTop: 16 }}>
          &copy; {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

function SectionTitle({ badge, title, subtitle }: { badge: string; title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 32, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
      <span style={badgeStyle}>{badge}</span>
      <h2 style={h2Style}>{title}</h2>
      <p style={subtitleStyle}>{subtitle}</p>
    </div>
  );
}

/* ─── Main Page ─── */

export default function CareersPage() {
  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      <Navbar />
      <Breadcrumbs items={[{ label: 'Home', href: '/welcome' }, { label: 'Careers' }]} />

      <main>
        {/* Hero */}
        <section style={{ textAlign: 'center', padding: '64px 16px 32px', maxWidth: 800, margin: '0 auto' }}>
          <span style={badgeStyle}>CAREERS</span>
          <h1 style={h1Style}>Build the learning OS for India</h1>
          <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 580, margin: '0 auto' }}>
            We&apos;re a small, deliberate team building patient AI tutors for K-12 India. If that sentence excites you, we&apos;d like to meet.
          </p>
        </section>

        {/* Why Alfanumrik */}
        <section
          aria-labelledby="why-alfanumrik"
          style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px', borderTop: '1px solid var(--border, #e5e0d8)' }}
        >
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <SectionTitle
              badge="WHY"
              title="Why Alfanumrik"
              subtitle="Three reasons people stay."
            />
            <h2 id="why-alfanumrik" style={srOnly}>Why Alfanumrik</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {WHY.map(w => (
                <div key={w.title} style={card}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>{w.icon}</div>
                  <h3 style={cardTitle}>{w.title}</h3>
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>{w.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* We're hiring */}
        <section aria-labelledby="hiring-roles" style={{ padding: '48px 16px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <SectionTitle
              badge="OPEN ROLES"
              title="We&apos;re hiring"
              subtitle="Bengaluru / Remote (India). Full-time. Market-rate compensation."
            />
            <h2 id="hiring-roles" style={srOnly}>Open roles</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
              {ROLES.map(r => (
                <li key={r.title} style={card}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 6 }}>
                    {r.title}
                  </h3>
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>{r.desc}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Apply */}
        <section
          aria-labelledby="apply"
          style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px', borderTop: '1px solid var(--border, #e5e0d8)' }}
        >
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <SectionTitle
              badge="APPLY"
              title="How to apply"
              subtitle="Email is the only channel. We read every message."
            />
            <div style={{ ...card, maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>✉️</div>
              <h3 id="apply" style={cardTitle}>Email careers@alfanumrik.com</h3>
              <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)', marginBottom: 16 }}>
                A one-liner pitch + your CV / portfolio. No cover-letter theatre. We&apos;ll reply within 5 business days.
              </p>
              <a href="mailto:careers@alfanumrik.com" style={emailButton}>careers@alfanumrik.com</a>
            </div>
          </div>
        </section>

        {/* What we don't do */}
        <section aria-labelledby="what-we-dont-do" style={{ padding: '48px 16px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <SectionTitle
              badge="HONESTY"
              title="What we don&apos;t do"
              subtitle="A short list of things we have decided against."
            />
            <div style={{ ...card, maxWidth: 640, margin: '0 auto' }}>
              <h3 id="what-we-dont-do" style={srOnly}>What we don&apos;t do</h3>
              <p style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-2, #444)' }}>
                We don&apos;t post on LinkedIn every Friday. We don&apos;t have ping-pong tables. We don&apos;t do unpaid trials. We pay market rates, ship things that matter, and respect the work.
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

/* ─── Styles ─── */

const navStyle: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 50,
  background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
  borderBottom: '1px solid var(--border, #e5e0d8)',
};
const navInner: React.CSSProperties = { maxWidth: 800, margin: '0 auto', padding: '0 16px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const logoLink: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' };
const logoText: React.CSSProperties = { fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-1, #1a1a1a)' };
const navLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-2, #444)', textDecoration: 'none' };

const badgeStyle: React.CSSProperties = {
  display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 999,
  background: 'rgba(232,88,28,0.08)', color: 'var(--orange, #E8581C)', marginBottom: 12, letterSpacing: 0.5,
};
const h1Style: React.CSSProperties = { fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1.2, marginBottom: 16 };
const h2Style: React.CSSProperties = { fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 12, color: 'var(--text-1, #1a1a1a)' };
const subtitleStyle: React.CSSProperties = { fontSize: 14, lineHeight: 1.7, color: 'var(--text-2, #444)' };

const card: React.CSSProperties = {
  background: 'var(--bg, #FBF8F4)', border: '1px solid var(--border, #e5e0d8)', borderRadius: 16, padding: 24,
};
const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 8 };
const emailButton: React.CSSProperties = {
  display: 'inline-block', padding: '12px 24px', fontSize: 14, fontWeight: 700, borderRadius: 12,
  background: 'var(--orange, #E8581C)', color: '#fff', textDecoration: 'none',
  fontFamily: 'var(--font-display)',
};
const srOnly: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden',
  clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
};

const footerStyle: React.CSSProperties = { borderTop: '1px solid var(--border, #e5e0d8)', padding: '32px 16px', textAlign: 'center' };
const footerInner: React.CSSProperties = { maxWidth: 800, margin: '0 auto' };
const footerLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--orange, #E8581C)', textDecoration: 'none' };
