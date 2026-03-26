import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Alfanumrik',
  description: 'How Alfanumrik protects student data and privacy. CBSE adaptive learning platform privacy policy.',
};

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
          <h2 style={h2}>5. Data Retention</h2>
          <ul style={ul}>
            <li style={li}><strong>Active Accounts:</strong> Your data is retained for as long as your account remains active.</li>
            <li style={li}><strong>Inactive Accounts:</strong> Data is retained for 2 years after your last login, after which it is anonymized.</li>
            <li style={li}><strong>Deleted Accounts:</strong> Personal data is purged within 30 days of account deletion. Anonymized learning analytics may be retained for platform improvement.</li>
            <li style={li}><strong>Backups:</strong> Backup copies are purged within 90 days of account deletion.</li>
            <li style={li}><strong>Legal Obligations:</strong> Data may be retained beyond these periods if required by applicable law.</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>6. Your Rights</h2>
          <ul style={ul}>
            <li style={li}><strong>Access:</strong> View all your data in your profile.</li>
            <li style={li}><strong>Export:</strong> Download your data as JSON from Profile &rarr; Download My Data.</li>
            <li style={li}><strong>Delete:</strong> Permanently delete your account from Profile &rarr; Delete Account.</li>
            <li style={li}><strong>Correct:</strong> Update your profile information anytime.</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>7. Your Rights Under Indian Law (DPDPA Compliance)</h2>
          <p style={p}>
            Under the Digital Personal Data Protection Act, 2023 (DPDPA), you are entitled to the following rights as a Data Principal:
          </p>
          <ul style={ul}>
            <li style={li}><strong>Right to Access:</strong> You may request a summary of the personal data we process about you. Use Profile &rarr; Download My Data to export your data.</li>
            <li style={li}><strong>Right to Correction:</strong> You may request correction of inaccurate or incomplete personal data. Update your information via Profile &rarr; Edit Profile.</li>
            <li style={li}><strong>Right to Erasure:</strong> You may request deletion of your personal data. Use Profile &rarr; Delete Account to permanently remove your data.</li>
            <li style={li}><strong>Right to Withdraw Consent:</strong> You may withdraw your consent for data processing at any time by contacting our Data Protection Officer at <a href="mailto:dpo@alfanumrik.com" style={link}>dpo@alfanumrik.com</a>.</li>
            <li style={li}><strong>Right to Grievance Redressal:</strong> You may raise concerns about our data practices through the grievance process described below.</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>8. Children&apos;s Privacy</h2>
          <p style={p}>
            Alfanumrik is designed for students aged 10-18. Students under 13 should use the platform
            with parental consent. Parents can monitor their child&apos;s activity through the Parent Portal.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>9. Third-Party Services</h2>
          <ul style={ul}>
            <li style={li}><strong>Supabase:</strong> Database and authentication.</li>
            <li style={li}><strong>Google OAuth:</strong> Optional sign-in method.</li>
            <li style={li}><strong>Vercel:</strong> Hosting and analytics.</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>10. Grievance Redressal</h2>
          <p style={p}>
            If you have concerns about how your data is handled, you may submit a grievance to our Grievance Officer at{' '}
            <a href="mailto:grievance@alfanumrik.com" style={link}>grievance@alfanumrik.com</a>.
            We will acknowledge your grievance and respond within 30 days.
          </p>
          <p style={p}>
            If your grievance remains unresolved, you may escalate the matter to our Data Protection Officer at{' '}
            <a href="mailto:dpo@alfanumrik.com" style={link}>dpo@alfanumrik.com</a>.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>11. Data Protection Officer</h2>
          <p style={p}>
            <strong>Data Protection Officer, Cusiosense Learning India Pvt. Ltd.</strong><br />
            Email: <a href="mailto:dpo@alfanumrik.com" style={link}>dpo@alfanumrik.com</a>
          </p>
          <p style={p}>
            For any data protection concerns or DPDPA inquiries, contact our DPO. The DPO is responsible for
            overseeing our data protection strategy and ensuring compliance with applicable privacy laws.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>12. Contact Us</h2>
          <p style={p}>
            For general privacy questions or data requests, email us at{' '}
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
