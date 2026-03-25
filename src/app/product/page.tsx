import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Product — Alfanumrik Adaptive Learning OS',
  description:
    'Explore the complete Alfanumrik platform: AI tutoring, adaptive quizzes, teacher dashboards, parent reports, and school intelligence — all in one place.',
  openGraph: {
    title: 'Product — Alfanumrik Adaptive Learning OS',
    description:
      'The complete school intelligence OS. For students, teachers, parents, and schools.',
    url: 'https://alfanumrik.com/product',
    siteName: 'Alfanumrik',
    type: 'website',
    locale: 'en_IN',
  },
  alternates: { canonical: 'https://alfanumrik.com/product' },
};

/* ─── Data ─── */

const FOR_STUDENTS = [
  { icon: '🦊', title: 'AI Tutor — Foxy', desc: 'Chat with your personal AI tutor in Hindi or English. Get step-by-step explanations tailored to your level.' },
  { icon: '🎯', title: 'Adaptive Quizzes', desc: 'Questions adjust difficulty in real-time based on your mastery. Always in your zone of proximal development.' },
  { icon: '🔁', title: 'Spaced Repetition', desc: 'SM-2 algorithm schedules reviews at the optimal time to move knowledge from short-term to long-term memory.' },
  { icon: '🔬', title: 'Interactive Simulations', desc: 'Explore physics, chemistry, and math through hands-on virtual experiments and visualizations.' },
  { icon: '🎮', title: 'Gamified Learning', desc: 'Earn XP, maintain streaks, climb leaderboards, and unlock achievements as you learn.' },
];

const FOR_TEACHERS = [
  { icon: '🏫', title: 'Class Management', desc: 'Create and manage multiple classes. Add students, set subjects, and organize your virtual classroom.' },
  { icon: '📝', title: 'Assignment Creation', desc: 'Generate quizzes and worksheets aligned to CBSE curriculum with one click.' },
  { icon: '📊', title: 'Student Analytics', desc: 'Track individual and class-wide mastery levels, identify gaps, and see learning patterns.' },
  { icon: '📄', title: 'Worksheet Generator', desc: 'AI-generated worksheets based on topic, difficulty, and Bloom\'s taxonomy level.' },
  { icon: '📈', title: 'Progress Tracking', desc: 'Real-time dashboards showing quiz completion, mastery growth, and study time per student.' },
];

const FOR_PARENTS = [
  { icon: '📊', title: 'Child Progress Reports', desc: 'See detailed breakdowns of your child\'s learning — subjects, topics, mastery levels, and more.' },
  { icon: '📋', title: 'Weekly Summaries', desc: 'Receive clear, easy-to-understand weekly summaries of study time, quiz performance, and growth.' },
  { icon: '🔔', title: 'Alert System', desc: 'Get notified when streaks are at risk, when milestones are reached, or when attention is needed.' },
  { icon: '📝', title: 'Exam Tracking', desc: 'Monitor board exam readiness with subject-wise progress and recommended focus areas.' },
];

const FOR_SCHOOLS = [
  { icon: '🏢', title: 'Institutional Dashboard', desc: 'School-wide analytics covering all classes, teachers, and students in one unified view. Coming soon.' },
  { icon: '📚', title: 'Multi-Class Management', desc: 'Manage multiple sections, grades, and subjects across your entire school from a single admin panel.' },
  { icon: '🎯', title: 'Board Exam Readiness Analytics', desc: 'Predictive analytics showing school-wide and per-student readiness for CBSE board examinations.' },
];

/* ─── Sub-Components ─── */

function SectionTitle({ badge, title, subtitle }: { badge: string; title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 32, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
      <span style={badgeEl}>{badge}</span>
      <h2 style={h2Style}>{title}</h2>
      <p style={subtitleStyle}>{subtitle}</p>
    </div>
  );
}

function FeatureGrid({ items }: { items: { icon: string; title: string; desc: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
      {items.map(f => (
        <div key={f.title} style={card}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
          <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 6 }}>{f.title}</h3>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>{f.desc}</p>
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

export default function ProductPage() {
  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      <Navbar />

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '64px 16px 48px', maxWidth: 800, margin: '0 auto' }}>
        <span style={badgeEl}>PRODUCT</span>
        <h1 style={h1Style}>The Complete School Intelligence OS</h1>
        <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 600, margin: '0 auto' }}>
          One platform that adapts to every stakeholder in the education ecosystem — students, teachers,
          parents, and school administrators.
        </p>
      </section>

      {/* For Students */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="FOR STUDENTS"
            title="Your Personal AI Learning Companion"
            subtitle="Foxy adapts to your pace, speaks your language, and makes learning feel less like work."
          />
          <FeatureGrid items={FOR_STUDENTS} />
        </div>
      </section>

      {/* For Teachers */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="FOR TEACHERS"
            title="Manage, Track, and Support Every Student"
            subtitle="Save hours on administration. Focus on what matters — teaching."
          />
          <FeatureGrid items={FOR_TEACHERS} />
        </div>
      </section>

      {/* For Parents */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="FOR PARENTS"
            title="Stay Connected to Your Child&apos;s Learning"
            subtitle="Clear, actionable reports without needing to understand the technology."
          />
          <FeatureGrid items={FOR_PARENTS} />
        </div>
      </section>

      {/* For Schools */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="FOR SCHOOLS"
            title="Institutional Intelligence at Scale"
            subtitle="School-wide analytics, multi-class management, and board exam readiness tracking."
          />
          <FeatureGrid items={FOR_SCHOOLS} />
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '64px 16px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ ...h2Style, fontSize: 28, marginBottom: 16 }}>Ready to Transform Learning?</h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-2, #444)', marginBottom: 24 }}>
            See Alfanumrik in action. Schedule a personalized demo for your school or institution.
          </p>
          <Link href="/demo" style={ctaButton}>
            Book a Demo
          </Link>
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

const badgeEl: React.CSSProperties = {
  display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 999,
  background: 'rgba(232,88,28,0.08)', color: 'var(--orange, #E8581C)', marginBottom: 12, letterSpacing: 0.5,
};
const h1Style: React.CSSProperties = { fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1.2, marginBottom: 16 };
const h2Style: React.CSSProperties = { fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 12, color: 'var(--text-1, #1a1a1a)' };
const subtitleStyle: React.CSSProperties = { fontSize: 14, lineHeight: 1.7, color: 'var(--text-2, #444)' };

const card: React.CSSProperties = {
  background: 'var(--bg, #FBF8F4)', border: '1px solid var(--border, #e5e0d8)', borderRadius: 16, padding: 24,
};

const ctaButton: React.CSSProperties = {
  display: 'inline-block', padding: '14px 32px', fontSize: 15, fontWeight: 700, borderRadius: 12,
  background: 'var(--orange, #E8581C)', color: '#fff', textDecoration: 'none',
  fontFamily: 'var(--font-display)',
};

const footerStyle: React.CSSProperties = { borderTop: '1px solid var(--border, #e5e0d8)', padding: '32px 16px', textAlign: 'center' };
const footerInner: React.CSSProperties = { maxWidth: 900, margin: '0 auto' };
const footerLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--orange, #E8581C)', textDecoration: 'none' };
