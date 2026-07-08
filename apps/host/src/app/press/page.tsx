import type { Metadata } from 'next';
import Link from 'next/link';
import Breadcrumbs from '@alfanumrik/ui/Breadcrumbs';

export const metadata: Metadata = {
  title: 'Press & Media — Alfanumrik',
  description:
    'Press inquiries, brand assets, and recent coverage for Alfanumrik — the CBSE-aligned learning platform built by Cusiosense Learning India.',
  openGraph: {
    title: 'Press & Media — Alfanumrik',
    description:
      'Press inquiries, brand assets, and recent coverage for Alfanumrik — the CBSE-aligned learning platform built by Cusiosense Learning India.',
    url: 'https://alfanumrik.com/press',
    siteName: 'Alfanumrik',
    type: 'website',
    locale: 'en_IN',
  },
  alternates: { canonical: 'https://alfanumrik.com/press' },
};

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

export default function PressPage() {
  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      <Navbar />
      <Breadcrumbs items={[{ label: 'Home', href: '/welcome' }, { label: 'Press' }]} />

      <main>
        {/* Hero */}
        <section style={{ textAlign: 'center', padding: '64px 16px 32px', maxWidth: 800, margin: '0 auto' }}>
          <span style={badgeStyle}>PRESS</span>
          <h1 style={h1Style}>Press &amp; media</h1>
          <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 560, margin: '0 auto' }}>
            Reach out for interviews, brand assets, or product news. Replies within 2 business days from our Bengaluru office.
          </p>
        </section>

        {/* Press inquiries */}
        <section
          aria-labelledby="press-inquiries"
          style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px', borderTop: '1px solid var(--border, #e5e0d8)' }}
        >
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <SectionTitle
              badge="INQUIRIES"
              title="Press inquiries"
              subtitle="Journalists and analysts — write to us directly. We aim to reply within 2 business days."
            />
            <div style={{ ...card, maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>📧</div>
              <h3 id="press-inquiries" style={cardTitle}>Press desk</h3>
              <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)', marginBottom: 16 }}>
                Interviews, statements, fact-checks, and product news.
              </p>
              <a href="mailto:press@alfanumrik.com" style={emailButton}>press@alfanumrik.com</a>
            </div>
          </div>
        </section>

        {/* Brand assets */}
        <section aria-labelledby="brand-assets" style={{ padding: '48px 16px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <SectionTitle
              badge="BRAND KIT"
              title="Brand assets"
              subtitle="Logos, photos, and typography specs for editorial use."
            />
            <div style={{ ...card, maxWidth: 640, margin: '0 auto' }}>
              <h3 id="brand-assets" style={{ ...cardTitle, marginBottom: 12 }}>Available on request</h3>
              <p style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-2, #444)' }}>
                Our brand kit — including primary and monochrome logo files, founder and product photography, and typography specifications — is available on request via the press desk. Email <a href="mailto:press@alfanumrik.com" style={inlineEmail}>press@alfanumrik.com</a> with the publication name and a brief description of usage; we&apos;ll send a download link within 2 business days.
              </p>
            </div>
          </div>
        </section>

        {/* Recent coverage */}
        <section
          aria-labelledby="recent-coverage"
          style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px', borderTop: '1px solid var(--border, #e5e0d8)' }}
        >
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <SectionTitle
              badge="COVERAGE"
              title="Recent coverage"
              subtitle="Where Alfanumrik has been written about."
            />
            <div style={{ ...card, maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📰</div>
              <h3 id="recent-coverage" style={{ ...cardTitle, marginBottom: 12 }}>Coverage will appear here</h3>
              <p style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-2, #444)' }}>
                We&apos;re a young startup. Press coverage will appear here as it lands. Subscribe to product updates at{' '}
                <a href="mailto:hello@alfanumrik.com" style={inlineEmail}>hello@alfanumrik.com</a> to be notified.
              </p>
            </div>
          </div>
        </section>

        {/* About Cusiosense Learning */}
        <section aria-labelledby="about-cusiosense" style={{ padding: '48px 16px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <SectionTitle
              badge="COMPANY"
              title="About Cusiosense Learning"
              subtitle="The company behind Alfanumrik."
            />
            <div style={{ ...card, maxWidth: 640, margin: '0 auto' }}>
              <h3 id="about-cusiosense" style={{ ...cardTitle, marginBottom: 12 }}>Cusiosense Learning India Private Limited</h3>
              <p style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-2, #444)' }}>
                Alfanumrik is built by Cusiosense Learning India Private Limited, a DPIIT-recognised Indian startup based in Bengaluru. We build adaptive learning systems for CBSE students in Grades 6-12. Founded 2025.
              </p>
              <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span style={companyBadge}>DPIIT Recognised</span>
                <span style={companyBadge}>Bengaluru, India</span>
                <span style={companyBadge}>Founded 2025</span>
              </div>
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
const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 6 };
const inlineEmail: React.CSSProperties = { color: 'var(--orange, #E8581C)', fontWeight: 600, textDecoration: 'none' };
const emailButton: React.CSSProperties = {
  display: 'inline-block', padding: '12px 24px', fontSize: 14, fontWeight: 700, borderRadius: 12,
  background: 'var(--orange, #E8581C)', color: '#fff', textDecoration: 'none',
  fontFamily: 'var(--font-display)',
};
const companyBadge: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
  background: 'rgba(232,88,28,0.06)', color: 'var(--orange, #E8581C)', border: '1px solid rgba(232,88,28,0.12)',
};

const footerStyle: React.CSSProperties = { borderTop: '1px solid var(--border, #e5e0d8)', padding: '32px 16px', textAlign: 'center' };
const footerInner: React.CSSProperties = { maxWidth: 800, margin: '0 auto' };
const footerLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--orange, #E8581C)', textDecoration: 'none' };
