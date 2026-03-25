import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About Alfanumrik — Cusiosense Learning India',
  description:
    'Alfanumrik is built by Cusiosense Learning India Pvt. Ltd., a DPIIT recognised startup on a mission to democratize quality education across India through AI.',
  openGraph: {
    title: 'About Alfanumrik — Cusiosense Learning India',
    description:
      'Building India\'s smartest learning OS. Meet the team behind Alfanumrik.',
    url: 'https://alfanumrik.com/about',
    siteName: 'Alfanumrik',
    type: 'website',
    locale: 'en_IN',
  },
  alternates: { canonical: 'https://alfanumrik.com/about' },
};

/* ─── Data ─── */

const VALUES = [
  {
    icon: '🎓',
    title: 'Student-First',
    desc: 'Every product decision starts with one question: does this help the student learn better?',
  },
  {
    icon: '🔒',
    title: 'Privacy by Design',
    desc: 'Data minimization, encryption, and DPDPA compliance are built into our architecture from day one.',
  },
  {
    icon: '🔬',
    title: 'Research-Backed',
    desc: 'Our algorithms are grounded in learning science — Bayesian Knowledge Tracing, Bloom\'s Taxonomy, and spaced repetition.',
  },
  {
    icon: '🇮🇳',
    title: 'Made in India',
    desc: 'Designed for Indian classrooms, Indian curricula, and Indian languages. Proudly built from India, for India.',
  },
];

const TEAM_MEMBERS = [
  { initials: 'Founding Team', role: 'Engineering, AI & Product', desc: 'Building adaptive learning systems for the Indian classroom.' },
  { initials: 'Advisors', role: 'Education & Research', desc: 'Domain experts in pedagogy, assessment design, and curriculum alignment.' },
  { initials: 'Contributors', role: 'Content & Design', desc: 'Teachers, designers, and subject-matter experts shaping every interaction.' },
];

/* ─── Sub-Components ─── */

function SectionTitle({ badge, title, subtitle }: { badge: string; title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 32, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
      <span style={badgeStyle}>{badge}</span>
      <h2 style={h2Style}>{title}</h2>
      <p style={subtitleStyle}>{subtitle}</p>
    </div>
  );
}

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

/* ─── Main Page ─── */

export default function AboutPage() {
  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      <Navbar />

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '64px 16px 48px', maxWidth: 800, margin: '0 auto' }}>
        <span style={badgeStyle}>ABOUT US</span>
        <h1 style={h1Style}>Building India&apos;s Smartest Learning OS</h1>
        <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 600, margin: '0 auto' }}>
          Alfanumrik is an adaptive learning platform built by{' '}
          <strong>Cusiosense Learning India Private Limited</strong> — a DPIIT recognised
          startup on a mission to democratize quality education across India through AI.
        </p>
      </section>

      {/* Mission */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <SectionTitle
            badge="OUR MISSION"
            title="Democratize Quality Education"
            subtitle="Every student in India deserves a personal tutor that understands how they learn, speaks their language, and adapts to their pace. AI makes this possible at scale."
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {[
              { value: '16', label: 'Subjects Covered' },
              { value: '6-12', label: 'Grades Supported' },
              { value: 'Hindi + English', label: 'Bilingual Tutoring' },
              { value: 'CBSE', label: 'Board Aligned' },
            ].map(s => (
              <div key={s.label} style={statCard}>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--orange, #E8581C)', fontFamily: 'var(--font-display)' }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3, #888)', fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <SectionTitle
            badge="OUR VALUES"
            title="What We Stand For"
            subtitle="These principles guide every line of code we write and every feature we ship."
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {VALUES.map(v => (
              <div key={v.title} style={card}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>{v.icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 8 }}>{v.title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <SectionTitle
            badge="THE TEAM"
            title="Founding Team at Cusiosense Learning"
            subtitle="A passionate team of engineers, educators, and researchers building the future of learning in India."
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {TEAM_MEMBERS.map(m => (
              <div key={m.initials} style={card}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(232,88,28,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--orange, #E8581C)', marginBottom: 12 }}>
                  {m.initials.charAt(0)}
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 4 }}>{m.initials}</h3>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--orange, #E8581C)', marginBottom: 8 }}>{m.role}</p>
                <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-2, #444)' }}>{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Company Info */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <SectionTitle
            badge="COMPANY"
            title="Cusiosense Learning India Pvt. Ltd."
            subtitle="Registered in India. Recognised by the Department for Promotion of Industry and Internal Trade (DPIIT)."
          />
          <div style={{ ...card, maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
            <p style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-2, #444)' }}>
              <strong>Cusiosense Learning India Private Limited</strong><br />
              DPIIT Recognised Startup<br />
              India
            </p>
            <div style={{ marginTop: 16, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <span style={companyBadge}>DPIIT Recognised</span>
              <span style={companyBadge}>ISO 27001</span>
              <span style={companyBadge}>Made in India</span>
            </div>
          </div>
        </div>
      </section>

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
const statCard: React.CSSProperties = {
  ...card, textAlign: 'center', padding: 20,
};
const companyBadge: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
  background: 'rgba(232,88,28,0.06)', color: 'var(--orange, #E8581C)', border: '1px solid rgba(232,88,28,0.12)',
};

const footerStyle: React.CSSProperties = { borderTop: '1px solid var(--border, #e5e0d8)', padding: '32px 16px', textAlign: 'center' };
const footerInner: React.CSSProperties = { maxWidth: 800, margin: '0 auto' };
const footerLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--orange, #E8581C)', textDecoration: 'none' };
