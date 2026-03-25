import type { Metadata } from 'next';
import Link from 'next/link';
import { PricingCards } from './PricingCards';

export const metadata: Metadata = {
  title: 'Pricing — Alfanumrik Adaptive Learning OS',
  description:
    'Simple, transparent pricing for every learner. Start free with Foxy, upgrade when you need more chats, quizzes, and subjects.',
  openGraph: {
    title: 'Pricing — Alfanumrik Adaptive Learning OS',
    description:
      'Start free, upgrade when you\'re ready. Plans for students, schools, and institutions.',
    url: 'https://alfanumrik.com/pricing',
    siteName: 'Alfanumrik',
    type: 'website',
    locale: 'en_IN',
  },
  alternates: { canonical: 'https://alfanumrik.com/pricing' },
};

/* ─── Data ─── */

const B2B_FEATURES = [
  { icon: '🏢', title: 'Admin Dashboard', desc: 'School-wide analytics covering all classes, teachers, and students in one unified view.' },
  { icon: '📚', title: 'Multi-Class Management', desc: 'Manage multiple sections, grades, and subjects across your entire school from a single admin panel.' },
  { icon: '🎯', title: 'Board Exam Analytics', desc: 'Predictive analytics showing school-wide and per-student readiness for CBSE board examinations.' },
  { icon: '🛠️', title: 'Teacher Tools', desc: 'Worksheet generators, assignment management, and class-wide mastery tracking for every teacher.' },
  { icon: '👨‍👩‍👧', title: 'Parent Portal', desc: 'Give parents real-time visibility into their child\'s progress, streaks, and exam readiness.' },
  { icon: '🔗', title: 'API Access', desc: 'Integrate Alfanumrik with your existing school ERP, LMS, or student information systems.' },
];

const FAQS = [
  {
    q: 'Can I try Alfanumrik for free before upgrading?',
    a: 'Yes! The Explorer plan is completely free with 5 Foxy chats and 5 quizzes per day across 2 subjects. No credit card required. Upgrade anytime when you need more.',
  },
  {
    q: 'How does the annual billing work?',
    a: 'When you choose annual billing, you pay for the full year upfront and save 33% compared to monthly billing. For example, the Pro plan is \u20B9699/month or \u20B95,599/year (equivalent to \u20B9467/month).',
  },
  {
    q: 'What is your refund policy?',
    a: 'We offer a 7-day money-back guarantee on all paid plans. If you\'re not satisfied within the first 7 days of your subscription, contact us for a full refund. No questions asked.',
  },
  {
    q: 'Can I switch plans at any time?',
    a: 'Absolutely. You can upgrade or downgrade your plan at any time. When upgrading, you\'ll be charged the prorated difference. When downgrading, the remaining credit will be applied to your next billing cycle.',
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
        <Link href="/welcome" style={navLinkStyle}>Home</Link>
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

export default function PricingPage() {
  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      <Navbar />

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '64px 16px 32px', maxWidth: 800, margin: '0 auto' }}>
        <span style={badgeStyle}>PRICING</span>
        <h1 style={h1Style}>Simple, Transparent Pricing</h1>
        <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 520, margin: '0 auto' }}>
          Start free, upgrade when you&apos;re ready. Every plan includes Foxy, your personal AI tutor.
        </p>
      </section>

      {/* Toggle + Plan Cards (client component for interactivity) */}
      <PricingCards />

      {/* B2B School Section */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '64px 16px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
            <span style={badgeStyle}>FOR SCHOOLS</span>
            <h2 style={h2Style}>For Schools &amp; Institutions</h2>
            <p style={subtitleStyle}>
              Custom pricing based on student count. Deploy Alfanumrik across your entire school
              with dedicated support, training, and integration assistance.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {B2B_FEATURES.map(f => (
              <div key={f.title} style={card}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 6 }}>{f.title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>{f.desc}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 40, flexWrap: 'wrap' }}>
            <Link href="/contact" style={ctaPrimary}>Contact Sales</Link>
            <Link href="/demo" style={ctaSecondary}>Book a Demo</Link>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section style={{ padding: '64px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <span style={badgeStyle}>FAQ</span>
            <h2 style={h2Style}>Frequently Asked Questions</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {FAQS.map(faq => (
              <div key={faq.q} style={faqCard}>
                <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 8, color: 'var(--text-1, #1a1a1a)' }}>
                  {faq.q}
                </h3>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>
                  {faq.a}
                </p>
              </div>
            ))}
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
const navInner: React.CSSProperties = { maxWidth: 1100, margin: '0 auto', padding: '0 16px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const logoLink: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' };
const logoText: React.CSSProperties = { fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-1, #1a1a1a)' };
const navLinkStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-2, #444)', textDecoration: 'none' };

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
const faqCard: React.CSSProperties = {
  background: 'var(--surface-1, #FFFFFF)', border: '1px solid var(--border, #e5e0d8)', borderRadius: 16, padding: 24,
};

const ctaPrimary: React.CSSProperties = {
  display: 'inline-block', padding: '14px 32px', fontSize: 15, fontWeight: 700, borderRadius: 12,
  background: 'var(--orange, #E8581C)', color: '#fff', textDecoration: 'none',
  fontFamily: 'var(--font-display)',
};
const ctaSecondary: React.CSSProperties = {
  display: 'inline-block', padding: '14px 32px', fontSize: 15, fontWeight: 700, borderRadius: 12,
  background: 'transparent', color: 'var(--orange, #E8581C)', textDecoration: 'none',
  fontFamily: 'var(--font-display)', border: '2px solid var(--orange, #E8581C)',
};

const footerStyle: React.CSSProperties = { borderTop: '1px solid var(--border, #e5e0d8)', padding: '32px 16px', textAlign: 'center' };
const footerInner: React.CSSProperties = { maxWidth: 1100, margin: '0 auto' };
const footerLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--orange, #E8581C)', textDecoration: 'none' };
