import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Alfanumrik',
  description: 'Terms of service for Alfanumrik adaptive learning platform.',
};

export default function TermsPage() {
  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <Link href="/dashboard" style={backLink}>&larr; Back</Link>
        <h1 style={h1}>Terms of Service</h1>
        <p style={updated}>Last updated: March 2026</p>

        <section style={section}>
          <h2 style={h2}>1. Acceptance of Terms</h2>
          <p style={p}>
            By using Alfanumrik, you agree to these Terms of Service. If you are under 18,
            your parent or guardian must agree to these terms on your behalf.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>2. Description of Service</h2>
          <p style={p}>
            Alfanumrik is an AI-powered adaptive learning platform for CBSE students.
            Features include Foxy AI Tutor, adaptive quizzes, spaced repetition review,
            interactive simulations, and progress tracking.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>3. User Accounts</h2>
          <ul style={ul}>
            <li style={li}>You must provide accurate information when creating an account.</li>
            <li style={li}>You are responsible for maintaining the security of your account.</li>
            <li style={li}>One account per student. Do not share your account credentials.</li>
            <li style={li}>We reserve the right to suspend accounts that violate these terms.</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>4. Acceptable Use</h2>
          <p style={p}>You agree not to:</p>
          <ul style={ul}>
            <li style={li}>Use the platform for any purpose other than educational learning.</li>
            <li style={li}>Attempt to manipulate XP, streaks, or leaderboard rankings.</li>
            <li style={li}>Share inappropriate or harmful content through the Foxy chat.</li>
            <li style={li}>Reverse engineer, scrape, or abuse the platform&apos;s APIs.</li>
            <li style={li}>Impersonate another user or create fake accounts.</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>5. Intellectual Property</h2>
          <p style={p}>
            All content, design, and technology on Alfanumrik is owned by Cusiosense Learning
            India Private Limited. You may not reproduce, distribute, or modify our content
            without permission.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>6. AI Tutor Disclaimer</h2>
          <p style={p}>
            Foxy AI Tutor provides educational assistance but is not a substitute for qualified
            teachers. While we strive for accuracy, AI-generated content may occasionally contain
            errors. Always verify critical information with your textbooks and teachers.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>7. Limitation of Liability</h2>
          <p style={p}>
            Alfanumrik is provided &quot;as is&quot; without warranties. We are not liable for
            academic outcomes, exam results, or decisions made based on our platform&apos;s recommendations.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>8. Changes to Terms</h2>
          <p style={p}>
            We may update these terms from time to time. Continued use of Alfanumrik after changes
            constitutes acceptance of the new terms.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>9. Contact</h2>
          <p style={p}>
            Questions about these terms? Email us at{' '}
            <a href="mailto:legal@alfanumrik.com" style={link}>legal@alfanumrik.com</a>.
          </p>
        </section>

        <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border, #e5e0d8)' }}>
          <Link href="/privacy" style={link}>Privacy Policy</Link>
        </div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: '100vh', padding: '24px 16px 80px', fontFamily: 'var(--font-body)', background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)' };
const containerStyle: React.CSSProperties = { maxWidth: 680, margin: '0 auto' };
const backLink: React.CSSProperties = { fontSize: 13, color: 'var(--text-3, #888)', textDecoration: 'none', fontWeight: 500 };
const h1: React.CSSProperties = { fontSize: 28, fontWeight: 800, margin: '16px 0 4px', fontFamily: 'var(--font-display)' };
const updated: React.CSSProperties = { fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 32 };
const section: React.CSSProperties = { marginBottom: 28 };
const h2: React.CSSProperties = { fontSize: 17, fontWeight: 700, marginBottom: 8, fontFamily: 'var(--font-display)' };
const p: React.CSSProperties = { fontSize: 14, lineHeight: 1.7, color: 'var(--text-2, #444)' };
const ul: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };
const li: React.CSSProperties = { fontSize: 14, lineHeight: 1.7, color: 'var(--text-2, #444)', padding: '3px 0', paddingLeft: 16, position: 'relative' };
const link: React.CSSProperties = { color: 'var(--orange, #E8581C)', textDecoration: 'none', fontWeight: 600, fontSize: 14 };
