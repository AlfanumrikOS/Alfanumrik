import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'For Teachers — Alfanumrik',
  description:
    'Teach smarter with AI-powered tools. Automated grading, real-time mastery data, adaptive assignments, and automated parent reports.',
};

/* ─── Data ─── */

const PAIN_POINTS = [
  { before: 'Grading takes hours', after: 'Automated assessment', icon: '✅', desc: 'AI grades quizzes instantly and generates detailed performance reports for every student.' },
  { before: 'Can\'t track every student', after: 'Real-time mastery data', icon: '📊', desc: 'See exactly where each student stands on every topic with live mastery dashboards.' },
  { before: 'Generic assignments', after: 'Adaptive difficulty', icon: '🎯', desc: 'Assignments automatically adjust difficulty to each student\'s level — challenging but never frustrating.' },
  { before: 'No parent engagement', after: 'Automated parent reports', icon: '📧', desc: 'Parents receive weekly progress updates without you lifting a finger.' },
];

const FEATURES = [
  { icon: '🏫', title: 'Class Management', desc: 'Create classes, add students, and organize sections. Students join with a simple class code.' },
  { icon: '📝', title: 'Worksheet Generator', desc: 'Generate CBSE-aligned worksheets in seconds. Choose topics, difficulty, and question types.' },
  { icon: '📈', title: 'Student Analytics', desc: 'Individual and class-wide analytics. Identify struggling students before they fall behind.' },
  { icon: '📋', title: 'Assignment Creation', desc: 'Create practice sets, homework, and tests. Set due dates and track completion rates.' },
  { icon: '🔍', title: 'Progress Tracking', desc: 'Monitor mastery progression, study time, quiz scores, and learning velocity for every student.' },
];

/* ─── Page ─── */

export default function ForTeachersPage() {
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
            FOR TEACHERS
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight mb-5" style={{ fontFamily: 'var(--font-display)' }}>
            Teach Smarter,<br />
            <span style={{ color: 'var(--orange)' }}>Not Harder</span>
          </h1>
          <p className="text-base sm:text-lg max-w-2xl mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            Alfanumrik gives you AI-powered tools to automate grading, track every student&apos;s progress,
            and create adaptive assignments — so you can focus on what matters most: teaching.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login?role=teacher"
              className="text-sm font-bold px-8 py-3.5 rounded-xl text-white w-full sm:w-auto text-center"
              style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
            >
              Start Free
            </Link>
            <Link
              href="/demo"
              className="text-sm font-semibold px-6 py-3.5 rounded-xl w-full sm:w-auto text-center"
              style={{ color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
            >
              Book a Demo
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ PAIN POINTS SOLVED ═══ */}
      <section className="py-14 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            Problems We Solve
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {PAIN_POINTS.map(p => (
              <div
                key={p.before}
                className="rounded-2xl p-6"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <span className="text-2xl mb-3 block">{p.icon}</span>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm line-through" style={{ color: 'var(--text-3)' }}>{p.before}</span>
                  <span className="text-sm" style={{ color: 'var(--text-3)' }}>&rarr;</span>
                  <span className="text-sm font-bold" style={{ color: 'var(--orange)' }}>{p.after}</span>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section className="py-14 sm:py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            Everything You Need
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(f => (
              <div
                key={f.title}
                className="rounded-2xl p-6"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
              >
                <span className="text-2xl mb-3 block">{f.icon}</span>
                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{f.title}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="py-16 sm:py-24 text-center" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            Ready to Save Hours Every Week?
          </h2>
          <p className="text-sm sm:text-base max-w-lg mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            Join thousands of teachers who use Alfanumrik to teach more effectively.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login?role=teacher"
              className="text-sm font-bold px-8 py-3.5 rounded-xl text-white w-full sm:w-auto text-center"
              style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
            >
              Start Free
            </Link>
            <Link
              href="/demo"
              className="text-sm font-semibold px-6 py-3.5 rounded-xl w-full sm:w-auto text-center"
              style={{ color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
            >
              Book a Demo
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
