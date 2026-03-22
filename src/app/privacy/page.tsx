'use client';

import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <Link href="/dashboard" style={backLink}>&larr; Back</Link>
        <h1 style={h1}>Privacy Policy</h1>
        <p style={updated}>Last updated: March 2026</p>

        <section style={section}>
          <h2 style={h2}>1. Who We Are</h2>
          <p style={p}>
            Alfanumrik is operated by <strong>Cusiosense Learning India Private Limited</strong>.
            We build adaptive learning technology for CBSE students in India.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>2. Information We Collect</h2>
          <ul style={ul}>
            <li style={li}><strong>Account Data:</strong> Name, email, phone number, grade, board, school, city, state.</li>
            <li style={li}><strong>Learning Data:</strong> Quiz responses, mastery levels, XP, streaks, study time, Foxy chat history.</li>
            <li style={li}><strong>Device Data:</strong> Browser type, screen size, IP address (for security).</li>
            <li style={li}><strong>Parent/Guardian Data:</strong> Name and phone number (if provided by student).</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>3. How We Use Your Data</h2>
          <ul style={ul}>
            <li style={li}>Personalizing your learning experience (adaptive difficulty, recommendations).</li>
            <li style={li}>Tracking your progress and generating study plans.</li>
            <li style={li}>Providing teacher and parent dashboards.</li>
            <li style={li}>Improving our AI tutor (Foxy) and platform features.</li>
            <li style={li}>Sending important notifications (streak reminders, achievements).</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>4. Data Storage & Security</h2>
          <p style={p}>
            Your data is stored securely on Supabase infrastructure with row-level security (RLS).
            All data is encrypted in transit (TLS 1.3) and at rest. We do not sell your data to third parties.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>5. Your Rights</h2>
          <ul style={ul}>
            <li style={li}><strong>Access:</strong> View all your data in your profile.</li>
            <li style={li}><strong>Export:</strong> Download your data as JSON from Profile &rarr; Download My Data.</li>
            <li style={li}><strong>Delete:</strong> Permanently delete your account from Profile &rarr; Delete Account.</li>
            <li style={li}><strong>Correct:</strong> Update your profile information anytime.</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>6. Children&apos;s Privacy</h2>
          <p style={p}>
            Alfanumrik is designed for students aged 10-18. Students under 13 should use the platform
            with parental consent. Parents can monitor their child&apos;s activity through the Parent Portal.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>7. Third-Party Services</h2>
          <ul style={ul}>
            <li style={li}><strong>Supabase:</strong> Database and authentication.</li>
            <li style={li}><strong>Google OAuth:</strong> Optional sign-in method.</li>
            <li style={li}><strong>Vercel:</strong> Hosting and analytics.</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>8. Contact Us</h2>
          <p style={p}>
            For privacy questions or data requests, email us at{' '}
            <a href="mailto:privacy@alfanumrik.com" style={link}>privacy@alfanumrik.com</a>.
          </p>
        </section>

        <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border, #e5e0d8)' }}>
          <Link href="/terms" style={link}>Terms of Service</Link>
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
