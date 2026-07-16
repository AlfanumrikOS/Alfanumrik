import type { Metadata } from 'next';
import Link from 'next/link';
import Breadcrumbs from '@alfanumrik/ui/Breadcrumbs';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

// SEO layer, 2026-07-16: adopted the marketing metadata builder.
// Canonical URL unchanged; builder adds complete openGraph incl. og:image.
export const metadata: Metadata = buildMarketingMetadata({
  path: '/refunds',
  title: 'Refunds & Cancellations — Alfanumrik',
  description:
    'Plain-language refund and cancellation policy for Alfanumrik subscriptions — monthly and annual CBSE learning plans (Class 6–12). DPDPA-compliant, India-based.',
});

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

function PolicySection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} style={{ marginBottom: 32 }}>
      <h2 id={id} style={h2Style}>{title}</h2>
      <div style={{ ...card }}>
        {children}
      </div>
    </section>
  );
}

/* ─── Main Page ─── */

export default function RefundsPage() {
  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      <Navbar />
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/welcome' },
          { label: 'Legal' },
          { label: 'Refunds' },
        ]}
      />

      <main>
        {/* Hero */}
        <section style={{ textAlign: 'center', padding: '64px 16px 32px', maxWidth: 800, margin: '0 auto' }}>
          <span style={badgeStyle}>REFUND POLICY</span>
          <h1 style={h1Style}>Refunds &amp; cancellations</h1>
          <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 600, margin: '0 auto' }}>
            Plain-language refund terms for Alfanumrik subscriptions. Last updated 4 May 2026.
          </p>
        </section>

        {/* Policy body */}
        <section style={{ padding: '24px 16px 64px' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <PolicySection id="cancellation" title="Cancellation">
              <ul style={listStyle}>
                <li>Cancel anytime from your account settings or by emailing <a href="mailto:billing@alfanumrik.com" style={inlineEmail}>billing@alfanumrik.com</a>.</li>
                <li>Cancellation takes effect at the end of the current billing month.</li>
                <li>You retain full access until the cancellation takes effect.</li>
                <li>No retention calls, no questions asked.</li>
              </ul>
            </PolicySection>

            <PolicySection id="refunds-monthly" title="Refunds — monthly plans">
              <ul style={listStyle}>
                <li>Monthly subscriptions are non-refundable for the current billing month after the first 7 days.</li>
                <li>Within the first 7 days of the first paid month: 100% refund on request, no questions.</li>
                <li>Beyond 7 days: subscription continues until the end of the current month, then ends. No partial refund.</li>
              </ul>
            </PolicySection>

            <PolicySection id="refunds-annual" title="Refunds — annual plans">
              <ul style={listStyle}>
                <li>
                  Annual subscriptions: prorated refund within the first 30 days = (months remaining / 12) × annual fee, minus any usage above the equivalent monthly rate.
                </li>
                <li>
                  Beyond 30 days: refund only in case of platform unavailability of more than 7 consecutive days, prorated for the affected period.
                </li>
                <li>Refunds processed via the original payment method within 7 working days.</li>
              </ul>
            </PolicySection>

            <PolicySection id="how-to-request" title="How to request a refund">
              <ul style={listStyle}>
                <li>
                  Email <a href="mailto:billing@alfanumrik.com" style={inlineEmail}>billing@alfanumrik.com</a> with your account email and Razorpay payment ID.
                </li>
                <li>We acknowledge within 1 business day, process within 7 working days.</li>
              </ul>
            </PolicySection>

            <PolicySection id="disputes" title="Disputes &amp; escalation">
              <ul style={listStyle}>
                <li>
                  Disputes can be escalated to <a href="mailto:grievance@alfanumrik.com" style={inlineEmail}>grievance@alfanumrik.com</a> or, under DPDPA, to the Data Protection Board of India.
                </li>
                <li>Last resort: courts of competent jurisdiction in Bengaluru, Karnataka.</li>
              </ul>
            </PolicySection>
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
const h2Style: React.CSSProperties = {
  fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 12,
  color: 'var(--text-1, #1a1a1a)',
};

const card: React.CSSProperties = {
  background: 'var(--bg, #FBF8F4)', border: '1px solid var(--border, #e5e0d8)', borderRadius: 16, padding: 24,
};
const listStyle: React.CSSProperties = {
  margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: 'var(--text-2, #444)',
};
const inlineEmail: React.CSSProperties = { color: 'var(--orange, #E8581C)', fontWeight: 600, textDecoration: 'none' };

const footerStyle: React.CSSProperties = { borderTop: '1px solid var(--border, #e5e0d8)', padding: '32px 16px', textAlign: 'center' };
const footerInner: React.CSSProperties = { maxWidth: 800, margin: '0 auto' };
const footerLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--orange, #E8581C)', textDecoration: 'none' };
