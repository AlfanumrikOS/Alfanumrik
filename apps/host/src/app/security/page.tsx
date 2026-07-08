import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Security & Compliance — Alfanumrik',
  description:
    'Alfanumrik employs enterprise-grade security for student data — Row Level Security, PKCE authentication, RBAC, DPDPA compliance, and AI safety measures.',
  robots: { index: false, follow: false },
  openGraph: {
    title: 'Security & Compliance — Alfanumrik',
    description:
      'Enterprise-grade security for student data. Learn about our infrastructure, authentication, and compliance measures.',
    url: 'https://alfanumrik.com/security',
    siteName: 'Alfanumrik',
    type: 'website',
    locale: 'en_IN',
  },
  alternates: { canonical: 'https://alfanumrik.com/security' },
};

/* ─── Data ─── */

const INFRASTRUCTURE = [
  { icon: '🌐', title: 'Vercel (CDN & Edge)', desc: 'Global CDN with edge functions for minimal latency. Server-side rendering and static generation for performance and SEO.' },
  { icon: '🗄️', title: 'Supabase (PostgreSQL + RLS)', desc: 'Managed PostgreSQL with Row Level Security policies on every table. Real-time subscriptions with policy enforcement.' },
  { icon: '🇮🇳', title: 'Mumbai Region', desc: 'Primary database and edge functions deployed in the Mumbai (ap-south-1) region for low-latency access across India.' },
  { icon: '🔐', title: 'Encrypted at Rest & In Transit', desc: 'AES-256 encryption at rest for all database storage. TLS 1.3 for all data in transit. No unencrypted data paths.' },
];

const AUTHENTICATION = [
  { icon: '🔑', title: 'PKCE Flow', desc: 'Proof Key for Code Exchange (PKCE) for secure OAuth flows. No client secrets exposed to the browser.' },
  { icon: '🎫', title: 'JWT Tokens', desc: 'Short-lived JWT access tokens with secure refresh token rotation. Tokens contain role and permission claims.' },
  { icon: '🖥️', title: 'Server-Side Session Validation', desc: 'All sensitive operations validate sessions server-side. No client-side-only authentication checks for protected resources.' },
  { icon: '👥', title: 'RBAC: 6 Roles, 26 Permissions', desc: 'Role-Based Access Control with student, teacher, parent, admin, school_admin, and super_admin roles across 26 granular permissions.' },
];

const DATA_PROTECTION = [
  { icon: '🛡️', title: 'Row Level Security', desc: 'RLS policies on all database tables ensure users can only access their own data. Enforced at the database level, not application level.' },
  { icon: '🔒', title: 'Field-Level Encryption for PII', desc: 'Personally identifiable information (names, emails, phone numbers) is encrypted at the field level using application-layer encryption.' },
  { icon: '📋', title: 'Audit Logging', desc: 'All admin actions, data access events, and configuration changes are logged with timestamps, actor IDs, and action details.' },
  { icon: '🇮🇳', title: 'DPDPA Compliance', desc: 'Full compliance with the Digital Personal Data Protection Act, 2023 — consent management, data principal rights, and grievance redressal.' },
];

const ACCESS_CONTROL = [
  { icon: '👤', title: 'Role-Based Access', desc: 'Strict role separation: students, teachers, parents, and admins each see only what they need. No role escalation possible.' },
  { icon: '🏷️', title: 'Resource-Level Ownership', desc: 'Every resource has an owner. Ownership is checked on every read, write, and delete operation at both API and database levels.' },
  { icon: '⏱️', title: 'Rate Limiting (Redis)', desc: 'Distributed rate limiting via Redis protects against abuse. Per-user, per-endpoint, and global rate limits with sliding windows.' },
  { icon: '🤖', title: 'Bot Protection', desc: 'Automated bot detection and CAPTCHA challenges for suspicious activity. Protects sign-up, login, and API endpoints.' },
];

const AI_SAFETY = [
  { icon: '🛡️', title: 'Prompt Injection Prevention', desc: 'Multi-layer input sanitization and system prompt hardening prevent prompt injection attacks against the AI tutor.' },
  { icon: '📝', title: 'Content Moderation', desc: 'All AI outputs pass through content filters for age-appropriateness, accuracy, and safety before reaching students.' },
  { icon: '🎮', title: 'XP Manipulation Prevention', desc: 'Server-side validation of all XP awards, streak calculations, and leaderboard entries. No client-side trust for gamification.' },
  { icon: '🔄', title: 'Session Isolation', desc: 'Each AI tutoring session is isolated. No cross-session data leakage between students. Conversation history is per-user and encrypted.' },
];

const CERTIFICATIONS = [
  { icon: '🛡️', label: 'ISO 27001', desc: 'Information Security Management System' },
  { icon: '🤖', label: 'ISO 42001', desc: 'AI Management System' },
  { icon: '📋', label: 'ISO 42005', desc: 'AI Impact Assessment' },
  { icon: '💳', label: 'PCI-DSS', desc: 'Payment Card Industry Data Security Standard' },
  { icon: '🇮🇳', label: 'DPIIT Recognised', desc: 'Department for Promotion of Industry and Internal Trade' },
];

const CHILD_PROTECTION = [
  { icon: '👨‍👩‍👧', title: 'Parental Consent for Under-13', desc: 'Verified parental consent is required before account creation for students under 13, in compliance with DPDPA child data provisions.' },
  { icon: '📦', title: 'Data Minimization', desc: 'We collect only the minimum data necessary for the learning experience. No unnecessary profiling or behavioral tracking.' },
  { icon: '🚫', title: 'No Ads, No Data Selling', desc: 'Alfanumrik will never show advertisements to students or sell student data to any third party, period.' },
];

const INCIDENT_RESPONSE = [
  { icon: '⏰', title: '24-Hour Disclosure', desc: 'Any confirmed data breach affecting student data will be disclosed to affected users and relevant authorities within 24 hours.' },
  { icon: '📊', title: 'Structured Error Reporting', desc: 'Automated error classification and escalation. Critical security events trigger immediate alerts to the security team.' },
  { icon: '📋', title: 'Audit Trail', desc: 'Complete, immutable audit trail of all security events, access patterns, and administrative actions for forensic analysis.' },
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

function ItemGrid({ items }: { items: { icon: string; title: string; desc: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
      {items.map(item => (
        <div key={item.title} style={card}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>{item.icon}</div>
          <h3 style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 6 }}>{item.title}</h3>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>{item.desc}</p>
        </div>
      ))}
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

export default function SecurityPage() {
  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      <Navbar />

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '64px 16px 48px', maxWidth: 800, margin: '0 auto' }}>
        <span style={badgeStyle}>SECURITY</span>
        <h1 style={h1Style}>Enterprise-Grade Security for Student Data</h1>
        <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 600, margin: '0 auto' }}>
          Student data is our most critical responsibility. Every layer of Alfanumrik is designed
          with defense-in-depth security principles.
        </p>
      </section>

      {/* Section 1: Infrastructure */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="INFRASTRUCTURE"
            title="Secure Cloud Architecture"
            subtitle="Built on battle-tested infrastructure with encryption at every layer."
          />
          <ItemGrid items={INFRASTRUCTURE} />
        </div>
      </section>

      {/* Section 2: Authentication */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="AUTHENTICATION"
            title="Identity & Session Security"
            subtitle="Modern authentication standards with server-side enforcement."
          />
          <ItemGrid items={AUTHENTICATION} />
        </div>
      </section>

      {/* Section 3: Data Protection */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="DATA PROTECTION"
            title="Multi-Layer Data Security"
            subtitle="Defense-in-depth data protection from the database to the API to the UI."
          />
          <ItemGrid items={DATA_PROTECTION} />
        </div>
      </section>

      {/* Section 4: Access Control */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="ACCESS CONTROL"
            title="Principle of Least Privilege"
            subtitle="Every user sees only what they need. Every request is verified."
          />
          <ItemGrid items={ACCESS_CONTROL} />
        </div>
      </section>

      {/* Section 5: AI Safety */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="AI SAFETY"
            title="Securing the AI Layer"
            subtitle="AI-specific security measures to protect against emerging threats."
          />
          <ItemGrid items={AI_SAFETY} />
        </div>
      </section>

      {/* Section 6: Certifications */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="CERTIFICATIONS & STANDARDS"
            title="Independently Verified"
            subtitle="Our security practices are validated against international standards."
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            {CERTIFICATIONS.map(c => (
              <div key={c.label} style={{ ...card, textAlign: 'center', padding: 20 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{c.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3, #888)', lineHeight: 1.5 }}>{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section 7: Child Data Protection */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="CHILD DATA PROTECTION"
            title="Extra Safeguards for Young Learners"
            subtitle="Additional protections for students under 13 and all minor users."
          />
          <ItemGrid items={CHILD_PROTECTION} />
        </div>
      </section>

      {/* Section 8: Incident Response */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="INCIDENT RESPONSE"
            title="When Things Go Wrong"
            subtitle="Transparent, rapid response protocols for security incidents."
          />
          <ItemGrid items={INCIDENT_RESPONSE} />
        </div>
      </section>

      {/* Contact CTA */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px', textAlign: 'center' }}>
        <div style={{ maxWidth: 500, margin: '0 auto' }}>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-2, #444)', marginBottom: 16 }}>
            For security concerns or to report a vulnerability, contact our security team at{' '}
            <a href="mailto:security@alfanumrik.com" style={{ color: 'var(--orange, #E8581C)', fontWeight: 600, textDecoration: 'none' }}>
              security@alfanumrik.com
            </a>.
          </p>
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
const navInner: React.CSSProperties = { maxWidth: 900, margin: '0 auto', padding: '0 16px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
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

const footerStyle: React.CSSProperties = { borderTop: '1px solid var(--border, #e5e0d8)', padding: '32px 16px', textAlign: 'center' };
const footerInner: React.CSSProperties = { maxWidth: 900, margin: '0 auto' };
const footerLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--orange, #E8581C)', textDecoration: 'none' };
