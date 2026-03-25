import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'For Parents — Alfanumrik',
  description:
    'Know exactly how your child is learning. Weekly progress reports, subject-wise mastery tracking, study time monitoring, and exam readiness scores.',
};

/* ─── Data ─── */

const WHAT_YOU_GET = [
  { icon: '📊', title: 'Weekly Progress Reports', desc: 'Receive clear, visual reports every week showing what your child studied, how they performed, and where they improved.' },
  { icon: '📚', title: 'Subject-Wise Mastery Tracking', desc: 'See exactly how strong your child is in each subject and topic — from remembering facts to applying concepts.' },
  { icon: '⏱️', title: 'Study Time Monitoring', desc: 'Track how much time your child spends learning each day and week. No guesswork, just real data.' },
  { icon: '🎯', title: 'Exam Readiness Scores', desc: 'Know whether your child is on track for board exams with readiness scores across all subjects.' },
  { icon: '🔔', title: 'Alert When Streaks Are at Risk', desc: 'Get notified when your child\'s learning streak is about to break, so you can encourage them to stay consistent.' },
];

const CONNECT_STEPS = [
  { step: '1', title: 'Get Link Code', desc: 'Your child generates a unique link code from their Alfanumrik profile.' },
  { step: '2', title: 'Enter in Parent Portal', desc: 'Sign up as a parent and enter the link code to connect to your child\'s account.' },
  { step: '3', title: 'See Live Progress', desc: 'Instantly access your child\'s learning dashboard with real-time data and weekly reports.' },
];

const SAFETY = [
  { icon: '🚫', title: 'No Ads', desc: 'Alfanumrik is completely ad-free. Your child learns without distractions or manipulative marketing.' },
  { icon: '🔒', title: 'No Data Selling', desc: 'We never sell student or parent data to anyone. Period. Your data stays yours.' },
  { icon: '📜', title: 'DPDPA Compliant', desc: 'We comply with India\'s Digital Personal Data Protection Act. Privacy is built into our platform from day one.' },
  { icon: '👶', title: 'Parental Consent for Under-13', desc: 'Students under 13 require verified parental consent before their account is activated.' },
];

/* ─── Page ─── */

export default function ForParentsPage() {
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
            FOR PARENTS
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight mb-5" style={{ fontFamily: 'var(--font-display)' }}>
            Know Exactly How Your<br />
            <span style={{ color: 'var(--orange)' }}>Child is Learning</span>
          </h1>
          <p className="text-base sm:text-lg max-w-2xl mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            Alfanumrik keeps you informed with real-time progress data, weekly reports,
            and exam readiness scores — so you always know where your child stands.
          </p>
          <Link
            href="/login?role=parent"
            className="inline-block text-sm font-bold px-8 py-3.5 rounded-xl text-white"
            style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
          >
            Join as Parent
          </Link>
        </div>
      </section>

      {/* ═══ WHAT YOU GET ═══ */}
      <section className="py-14 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            What You Get
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {WHAT_YOU_GET.map(item => (
              <div
                key={item.title}
                className="rounded-2xl p-6"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <span className="text-2xl mb-3 block">{item.icon}</span>
                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{item.title}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ HOW TO CONNECT ═══ */}
      <section className="py-14 sm:py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            How to Connect
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {CONNECT_STEPS.map(s => (
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

      {/* ═══ SAFETY & PRIVACY ═══ */}
      <section className="py-14 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            Safety &amp; Privacy
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {SAFETY.map(item => (
              <div
                key={item.title}
                className="rounded-2xl p-6"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <span className="text-2xl mb-3 block">{item.icon}</span>
                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{item.title}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="py-16 sm:py-24 text-center">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            Stay Connected to Your Child&apos;s Learning
          </h2>
          <p className="text-sm sm:text-base max-w-lg mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            Join thousands of parents who use Alfanumrik to support their children&apos;s education.
          </p>
          <Link
            href="/login?role=parent"
            className="inline-block text-sm font-bold px-8 py-3.5 rounded-xl text-white"
            style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
          >
            Join as Parent
          </Link>
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
