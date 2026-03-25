import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'For Schools — Alfanumrik School Intelligence OS',
  description:
    'Transform your school with AI-powered adaptive learning. Real-time student analytics, reduced teacher workload, and board exam readiness tracking for CBSE schools.',
};

/* ─── Data ─── */

const BENEFITS = [
  { icon: '📈', title: 'Better Learning Outcomes', desc: 'AI adapts to each student\'s level, ensuring every learner progresses at their optimal pace.' },
  { icon: '📊', title: 'Real-Time Student Analytics', desc: 'Track mastery, engagement, and performance across every class and section from one dashboard.' },
  { icon: '⏱️', title: 'Reduced Teacher Workload', desc: 'Automated grading, report generation, and assignment creation save teachers hours every week.' },
  { icon: '🎯', title: 'Board Exam Readiness Tracking', desc: 'Monitor institution-wide preparedness with CBSE board-pattern practice and gap analysis.' },
];

const STEPS = [
  { step: '1', title: 'Onboard Your School', desc: 'We set up your institution with classes, teachers, and subjects in under a day.' },
  { step: '2', title: 'Teachers Create Classes', desc: 'Teachers add students, assign subjects, and configure their virtual classrooms.' },
  { step: '3', title: 'Students Learn Adaptively', desc: 'Every student gets a personalized AI tutor that adapts to their learning pace and style.' },
  { step: '4', title: 'Track Progress Institution-Wide', desc: 'Admins see school-wide analytics, class comparisons, and individual student drill-downs.' },
];

const INCLUDED = [
  { icon: '🦊', title: 'AI Tutor for Every Student', desc: 'Foxy teaches 16 subjects in Hindi and English with step-by-step explanations.' },
  { icon: '👩‍🏫', title: 'Teacher Dashboards', desc: 'Class management, assignment creation, mastery tracking, and automated reports.' },
  { icon: '👨‍👩‍👧', title: 'Parent Portal', desc: 'Weekly progress reports keep parents informed and engaged in their child\'s learning.' },
  { icon: '📋', title: 'Analytics & Reporting', desc: 'Institution-level analytics, board readiness scores, and exportable reports.' },
];

/* ─── Page ─── */

export default function ForSchoolsPage() {
  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text-1)', minHeight: '100vh' }}>
      {/* ═══ NAV ═══ */}
      <nav
        className="sticky top-0 z-50 border-b"
        style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}
      >
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/welcome" className="flex items-center gap-2">
            <span className="text-2xl">🦊</span>
            <span className="text-lg font-extrabold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>Alfanumrik</span>
          </Link>
          <Link href="/login" className="text-sm font-semibold px-4 py-2 rounded-lg" style={{ color: 'var(--text-2)' }}>
            Log In
          </Link>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="py-16 sm:py-24 text-center">
        <div className="max-w-5xl mx-auto px-4">
          <span
            className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-4"
            style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}
          >
            FOR SCHOOLS
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight mb-5" style={{ fontFamily: 'var(--font-display)' }}>
            Transform Your School with<br />
            <span style={{ color: 'var(--orange)' }}>AI-Powered Learning</span>
          </h1>
          <p className="text-base sm:text-lg max-w-2xl mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            Give every student a personal AI tutor. Give every teacher real-time analytics.
            Give your school a competitive edge in board exam outcomes.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/demo"
              className="text-sm font-bold px-8 py-3.5 rounded-xl text-white w-full sm:w-auto text-center"
              style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
            >
              Book a Demo
            </Link>
            <Link
              href="/contact"
              className="text-sm font-semibold px-6 py-3.5 rounded-xl w-full sm:w-auto text-center"
              style={{ color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
            >
              Contact Sales
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ BENEFITS ═══ */}
      <section className="py-14 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            Why Schools Choose Alfanumrik
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {BENEFITS.map(b => (
              <div
                key={b.title}
                className="rounded-2xl p-6"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <span className="text-2xl mb-3 block">{b.icon}</span>
                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{b.title}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section className="py-14 sm:py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            How It Works
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map(s => (
              <div key={s.step} className="text-center">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-extrabold mx-auto mb-4 text-white"
                  style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
                >
                  {s.step}
                </div>
                <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--text-1)' }}>{s.title}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ WHAT'S INCLUDED ═══ */}
      <section className="py-14 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            What&apos;s Included
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {INCLUDED.map(i => (
              <div
                key={i.title}
                className="rounded-2xl p-6"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <span className="text-2xl mb-3 block">{i.icon}</span>
                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{i.title}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{i.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="py-16 sm:py-24 text-center">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            Ready to Transform Your School?
          </h2>
          <p className="text-sm sm:text-base max-w-lg mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            Join forward-thinking schools using AI to deliver better learning outcomes.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/demo"
              className="text-sm font-bold px-8 py-3.5 rounded-xl text-white w-full sm:w-auto text-center"
              style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
            >
              Book a Demo
            </Link>
            <Link
              href="/contact"
              className="text-sm font-semibold px-6 py-3.5 rounded-xl w-full sm:w-auto text-center"
              style={{ color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
            >
              Contact Sales
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t py-8" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
          <p>&copy; {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" style={{ color: 'var(--text-3)' }}>Privacy</Link>
            <Link href="/terms" style={{ color: 'var(--text-3)' }}>Terms</Link>
            <Link href="/contact" style={{ color: 'var(--text-3)' }}>Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
