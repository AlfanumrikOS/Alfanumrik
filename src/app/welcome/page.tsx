import type { Metadata } from 'next';
import Link from 'next/link';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/landing/Animations';

/* ═══════════════════════════════════════════════════════════════
   ALFANUMRIK LANDING PAGE — Marketing & Conversion
   Server component for SEO. All CTAs route to auth at /.
   ═══════════════════════════════════════════════════════════════ */

export const metadata: Metadata = {
  title: 'Alfanumrik — India\'s Smartest AI Learning Platform for CBSE Students',
  description:
    'Alfanumrik is an adaptive AI learning platform for CBSE Grades 6–12. Personalized tutoring in Hindi & English, real-time progress tracking, smart quizzes, and interactive simulations. Built by Cusiosense Learning India.',
  keywords:
    'adaptive learning platform, AI learning app, personalized education, CBSE AI tutor, online learning India, AI tutor Hindi, board exam preparation, class 9 10 science math, Alfanumrik, Foxy AI tutor',
  openGraph: {
    title: 'Alfanumrik — AI-Powered Adaptive Learning for CBSE Students',
    description:
      'Meet Foxy, your personal AI tutor. 16 subjects, Hindi & English, Grades 6–12. Adaptive quizzes, spaced repetition, gamified learning. Start free.',
    url: 'https://alfanumrik.com/welcome',
    locale: 'en_IN',
    type: 'website',
    siteName: 'Alfanumrik',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alfanumrik — AI Tutor for CBSE Students',
    description:
      'Personalized AI tutoring in Hindi & English. Adaptive learning, smart quizzes, real-time progress. Grades 6–12.',
  },
  alternates: { canonical: 'https://alfanumrik.com/welcome' },
};

/* ─── Data ─── */

const FEATURES = [
  {
    icon: '🦊',
    title: 'AI Tutor — Foxy',
    desc: 'Chat or talk with Foxy, your personal AI tutor. Get step-by-step explanations in Hindi or English, exactly at your level.',
  },
  {
    icon: '🎯',
    title: 'Adaptive Learning',
    desc: 'Questions adjust to your skill level in real-time. Never too easy, never too hard — always in your learning zone.',
  },
  {
    icon: '⚡',
    title: 'Smart Quizzes',
    desc: 'Practice with CBSE board-pattern questions. Instant feedback, detailed explanations, and bloom-level analysis.',
  },
  {
    icon: '📊',
    title: 'Parent Reports',
    desc: 'Parents get clear weekly reports — what your child studied, where they need help, and how they\'re improving.',
  },
  {
    icon: '🏫',
    title: 'Teacher Dashboard',
    desc: 'Manage classes, assign worksheets, track every student\'s mastery — all in one place.',
  },
  {
    icon: '🔬',
    title: 'Interactive Simulations',
    desc: 'Physics, chemistry, and math come alive. Drag, play, and experiment with real science simulations.',
  },
];

const STEPS_STUDENT = [
  { num: '1', title: 'Sign Up Free', desc: 'Create your account in 30 seconds. Pick your grade, board, and subjects.' },
  { num: '2', title: 'Start Learning', desc: 'Chat with Foxy, take quizzes, or explore interactive labs. Learn your way.' },
  { num: '3', title: 'Track Progress', desc: 'See your mastery grow topic by topic. Earn XP, maintain streaks, climb ranks.' },
];

const STEPS_PARENT = [
  { num: '1', title: 'Connect to Child', desc: 'Enter the link code from your child\'s profile. Instant access to their learning journey.' },
  { num: '2', title: 'Review Reports', desc: 'Weekly reports show study time, quiz scores, strengths, and areas needing attention.' },
  { num: '3', title: 'Stay Involved', desc: 'Get alerts when streaks are at risk. Celebrate milestones together.' },
];

const STEPS_TEACHER = [
  { num: '1', title: 'Create Your Class', desc: 'Add students, assign subjects, and set up your virtual classroom.' },
  { num: '2', title: 'Assign & Track', desc: 'Create quizzes and worksheets. Monitor every student\'s mastery in real-time.' },
  { num: '3', title: 'Generate Reports', desc: 'One-click class reports, individual student analytics, and gap identification.' },
];

const BENEFITS = [
  { icon: '🚀', title: 'Learn 2× Faster', desc: 'AI adapts to your pace. No wasted time on what you already know.' },
  { icon: '🧠', title: 'Understand Deeply', desc: 'Bloom\'s taxonomy progression ensures real understanding, not just memorization.' },
  { icon: '😌', title: 'Less Exam Stress', desc: 'Spaced repetition and board-pattern practice build confidence before exams.' },
  { icon: '🎮', title: 'Actually Fun', desc: 'XP, streaks, leaderboards, and competitions make studying something you look forward to.' },
];

const TESTIMONIALS = [
  {
    quote: 'Foxy explains better than my tuition teacher. I went from 62% to 89% in science in just 3 months.',
    name: 'Priya S.',
    role: 'Class 10 Student, Delhi',
    avatar: '🎓',
  },
  {
    quote: 'Finally I can see exactly what my daughter is learning and where she needs help. The weekly reports are amazing.',
    name: 'Rajesh K.',
    role: 'Parent, Bangalore',
    avatar: '👨‍👩‍👧',
  },
  {
    quote: 'I manage 120 students across 4 sections. The dashboard saves me hours every week on tracking and reporting.',
    name: 'Meera T.',
    role: 'Science Teacher, Hyderabad',
    avatar: '👩‍🏫',
  },
];

const FAQS = [
  {
    q: 'What is Alfanumrik?',
    a: 'Alfanumrik is an AI-powered adaptive learning platform for CBSE students in Grades 6–12. It uses a personal AI tutor called Foxy to teach 16 subjects in Hindi and English, with smart quizzes, spaced repetition, and interactive simulations.',
  },
  {
    q: 'How does adaptive learning work?',
    a: 'Our system uses Bayesian mastery tracking and Bloom\'s taxonomy to understand what you know and what you need to learn next. Questions automatically adjust difficulty to keep you in your optimal learning zone — challenging enough to grow, but not so hard you get frustrated.',
  },
  {
    q: 'Is it safe for my child?',
    a: 'Absolutely. We follow DPDPA (Digital Personal Data Protection Act) compliance, encrypt all data, never show ads, and never sell data. Students under 13 require verified parental consent. ISO 27001 & ISO 42001 certified.',
  },
  {
    q: 'How do parents track their child\'s progress?',
    a: 'Parents connect via a simple link code from their child\'s profile. You\'ll see weekly reports covering study time, quiz scores, mastery progression, strengths, and areas needing attention — all without needing to understand the technology.',
  },
  {
    q: 'Is Alfanumrik free?',
    a: 'Yes! Alfanumrik offers a generous free tier with 50 Foxy chats per day, unlimited quizzes, and full access to all subjects. Premium plans are available for extended usage, voice tutoring, and advanced analytics.',
  },
  {
    q: 'Which boards and grades are supported?',
    a: 'Currently we support CBSE Grades 6–12 with 16 subjects including Math, Science, Physics, Chemistry, Biology, English, Hindi, Social Studies, Computer Science, and Commerce subjects. ICSE and State Board support coming soon.',
  },
];

const TRUST_BADGES = [
  { icon: '🛡️', label: 'ISO 27001', desc: 'Information Security' },
  { icon: '🤖', label: 'ISO 42001', desc: 'AI Management' },
  { icon: '📋', label: 'ISO 42005', desc: 'AI Impact Assessment' },
  { icon: '🔒', label: 'PCI-DSS', desc: 'Payment Security' },
  { icon: '🇮🇳', label: 'DPIIT', desc: 'Recognised Startup' },
];

/* ─── Sub-Components ─── */

function CTAButtons({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col sm:flex-row items-center gap-3 ${className}`}>
      <Link
        href="/login"
        className="btn-primary text-sm px-7 py-3.5 rounded-xl font-bold text-white w-full sm:w-auto text-center"
        style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
      >
        Start Learning Free
      </Link>
      <Link
        href="/login?role=parent"
        className="btn-ghost text-sm px-6 py-3 rounded-xl font-semibold w-full sm:w-auto text-center"
        style={{ color: '#16A34A', border: '1.5px solid #16A34A40' }}
      >
        For Parents
      </Link>
      <Link
        href="/login?role=teacher"
        className="btn-ghost text-sm px-6 py-3 rounded-xl font-semibold w-full sm:w-auto text-center"
        style={{ color: '#2563EB', border: '1.5px solid #2563EB40' }}
      >
        For Teachers
      </Link>
    </div>
  );
}

function SectionTitle({ badge, title, subtitle }: { badge: string; title: string; subtitle: string }) {
  return (
    <div className="text-center mb-10 max-w-2xl mx-auto">
      <span
        className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3"
        style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}
      >
        {badge}
      </span>
      <h2
        className="text-2xl sm:text-3xl font-extrabold mb-3"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
      >
        {title}
      </h2>
      <p className="text-sm sm:text-base" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
        {subtitle}
      </p>
    </div>
  );
}

/* ─── Main Page ─── */

export default function WelcomePage() {
  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>
      {/* ═══ NAVBAR ═══ */}
      <nav
        className="sticky top-0 z-50 border-b"
        style={{
          background: 'rgba(251,248,244,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/welcome" className="flex items-center gap-2">
            <span className="text-2xl">🦊</span>
            <span
              className="text-lg font-extrabold gradient-text"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Alfanumrik
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="text-sm font-semibold px-4 py-2 rounded-lg transition-all"
              style={{ color: 'var(--text-2)' }}
            >
              Log In
            </Link>
            <Link
              href="/login"
              className="text-sm font-bold px-5 py-2.5 rounded-xl text-white transition-all active:scale-[0.97]"
              style={{ background: 'var(--orange)' }}
            >
              Sign Up Free
            </Link>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative overflow-hidden">
        <div className="mesh-bg" style={{ position: 'absolute', inset: 0, opacity: 0.5 }} />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-28 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-bold px-4 py-1.5 rounded-full mb-6 animate-slide-up"
            style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)', border: '1px solid rgba(232,88,28,0.15)' }}>
            <span>🇮🇳</span> Built for Indian Students — CBSE Grades 6–12
          </div>

          <h1
            className="text-3xl sm:text-5xl lg:text-6xl font-extrabold leading-tight mb-5 animate-slide-up"
            style={{ fontFamily: 'var(--font-display)', animationDelay: '0.05s' }}
          >
            Learn Smarter with{' '}
            <span className="gradient-text">Your AI Tutor</span>
          </h1>

          <p
            className="text-base sm:text-lg max-w-2xl mx-auto mb-8 animate-slide-up"
            style={{ color: 'var(--text-2)', lineHeight: 1.7, animationDelay: '0.1s' }}
          >
            Alfanumrik adapts to <em>your</em> level. Foxy, your AI tutor, teaches 16 subjects in Hindi & English
            with smart quizzes, interactive labs, and real-time progress tracking.
          </p>

          <div className="animate-slide-up" style={{ animationDelay: '0.15s' }}>
            <CTAButtons />
          </div>

          {/* Stats bar */}
          <div
            className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 mt-12 animate-slide-up"
            style={{ animationDelay: '0.2s' }}
          >
            {[
              { value: '16', label: 'Subjects' },
              { value: 'Grades 6–12', label: 'CBSE' },
              { value: 'Hindi & English', label: 'Bilingual' },
              { value: 'Free', label: 'To Start' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className="text-lg sm:text-xl font-extrabold" style={{ color: 'var(--orange)' }}>{s.value}</div>
                <div className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PRODUCT OVERVIEW ═══ */}
      <section className="py-16 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <SectionTitle
            badge="WHAT IS ALFANUMRIK"
            title="An Adaptive Learning OS That Knows You"
            subtitle="Not a video library. Not a question bank. Alfanumrik is an intelligent system that learns how you learn — and teaches accordingly."
          />

          <StaggerContainer className="grid sm:grid-cols-3 gap-5">
            {[
              {
                icon: '🧠',
                title: 'Personalized Learning',
                desc: 'Bayesian mastery tracking identifies what you know and what you need next. Every session is unique to you.',
                color: '#7C3AED',
              },
              {
                icon: '🦊',
                title: 'AI-Powered Tutoring',
                desc: 'Foxy explains concepts step-by-step, answers doubts in seconds, and adjusts difficulty in real-time.',
                color: '#E8581C',
              },
              {
                icon: '📈',
                title: 'Real-Time Tracking',
                desc: 'Parents, teachers, and students all see live progress — mastery levels, quiz scores, and study patterns.',
                color: '#0891B2',
              },
            ].map(item => (
              <StaggerItem key={item.title}>
              <div
                className="rounded-2xl p-6 card-hover h-full"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
                }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4"
                  style={{ background: `${item.color}12` }}
                >
                  {item.icon}
                </div>
                <h3 className="text-base font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                  {item.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  {item.desc}
                </p>
              </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ═══ KEY FEATURES ═══ */}
      <section className="py-16 sm:py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <SectionTitle
            badge="FEATURES"
            title="Everything You Need to Excel"
            subtitle="From AI tutoring to interactive labs — built for how Indian students actually study."
          />

          <StaggerContainer className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <StaggerItem key={f.title}>
                <div
                  className="rounded-2xl p-5 transition-all hover:shadow-md h-full"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
                >
                  <div className="text-3xl mb-3">{f.icon}</div>
                  <h3 className="text-sm font-bold mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
                    {f.title}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                    {f.desc}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section className="py-16 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <SectionTitle
            badge="HOW IT WORKS"
            title="Get Started in 3 Simple Steps"
            subtitle="Whether you're a student, parent, or teacher — getting started takes less than a minute."
          />

          {/* Student Steps */}
          <div className="mb-12">
            <h3 className="text-center text-sm font-bold mb-6" style={{ color: 'var(--orange)' }}>
              🎓 For Students
            </h3>
            <div className="grid sm:grid-cols-3 gap-5">
              {STEPS_STUDENT.map(s => (
                <div key={s.num} className="text-center">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-extrabold text-white mx-auto mb-3"
                    style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
                  >
                    {s.num}
                  </div>
                  <h4 className="text-sm font-bold mb-1">{s.title}</h4>
                  <p className="text-sm" style={{ color: 'var(--text-2)' }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Parent Steps */}
          <div className="mb-12">
            <h3 className="text-center text-sm font-bold mb-6" style={{ color: '#16A34A' }}>
              👨‍👩‍👧 For Parents
            </h3>
            <div className="grid sm:grid-cols-3 gap-5">
              {STEPS_PARENT.map(s => (
                <div key={s.num} className="text-center">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-extrabold text-white mx-auto mb-3"
                    style={{ background: 'linear-gradient(135deg, #16A34A, #22C55E)' }}
                  >
                    {s.num}
                  </div>
                  <h4 className="text-sm font-bold mb-1">{s.title}</h4>
                  <p className="text-sm" style={{ color: 'var(--text-2)' }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Teacher Steps */}
          <div>
            <h3 className="text-center text-sm font-bold mb-6" style={{ color: '#2563EB' }}>
              👩‍🏫 For Teachers
            </h3>
            <div className="grid sm:grid-cols-3 gap-5">
              {STEPS_TEACHER.map(s => (
                <div key={s.num} className="text-center">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-extrabold text-white mx-auto mb-3"
                    style={{ background: 'linear-gradient(135deg, #2563EB, #3B82F6)' }}
                  >
                    {s.num}
                  </div>
                  <h4 className="text-sm font-bold mb-1">{s.title}</h4>
                  <p className="text-sm" style={{ color: 'var(--text-2)' }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ BENEFITS ═══ */}
      <section className="py-16 sm:py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <SectionTitle
            badge="WHY ALFANUMRIK"
            title="Built for How You Actually Learn"
            subtitle="Backed by cognitive science — Bloom's taxonomy, spaced repetition, and zone of proximal development."
          />

          <div className="grid sm:grid-cols-2 gap-5">
            {BENEFITS.map(b => (
              <div
                key={b.title}
                className="rounded-2xl p-5 flex gap-4 items-start card-hover"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
              >
                <div className="text-3xl shrink-0">{b.icon}</div>
                <div>
                  <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                    {b.title}
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--text-2)' }}>{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ TRUST & CREDIBILITY ═══ */}
      <section className="py-16 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <SectionTitle
            badge="TRUST & SECURITY"
            title="Your Data is Safe With Us"
            subtitle="Enterprise-grade security certifications. DPDPA compliant. No ads. No data selling. Ever."
          />

          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
            {TRUST_BADGES.map(b => (
              <div
                key={b.label}
                className="rounded-2xl px-5 py-4 text-center min-w-[120px]"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <div className="text-2xl mb-1">{b.icon}</div>
                <div className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>{b.label}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{b.desc}</div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs mt-6" style={{ color: 'var(--text-3)' }}>
            Alfanumrik™ is a trademark of <strong>Cusiosense Learning India Private Limited</strong>
          </p>
        </div>
      </section>

      {/* ═══ TESTIMONIALS ═══ */}
      <section className="py-16 sm:py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <SectionTitle
            badge="WHAT USERS SAY"
            title="Trusted by Students, Parents & Teachers"
            subtitle="Real feedback from the Alfanumrik community across India."
          />

          <StaggerContainer className="grid sm:grid-cols-3 gap-5">
            {TESTIMONIALS.map(t => (
              <StaggerItem key={t.name}>
              <div
                key={t.name}
                className="rounded-2xl p-5"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
              >
                <p className="text-sm mb-4 leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                    style={{ background: 'rgba(232,88,28,0.08)' }}
                  >
                    {t.avatar}
                  </div>
                  <div>
                    <div className="text-sm font-bold">{t.name}</div>
                    <div className="text-xs" style={{ color: 'var(--text-3)' }}>{t.role}</div>
                  </div>
                </div>
              </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section className="py-16 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <SectionTitle
            badge="FAQ"
            title="Frequently Asked Questions"
            subtitle="Everything you need to know about getting started with Alfanumrik."
          />

          <FadeIn>
          <div className="space-y-3">
            {FAQS.map(faq => (
              <details
                key={faq.q}
                className="group rounded-2xl"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <summary
                  className="flex items-center justify-between cursor-pointer px-5 py-4 text-sm font-semibold list-none"
                  style={{ color: 'var(--text-1)' }}
                >
                  {faq.q}
                  <span
                    className="text-lg transition-transform duration-200 group-open:rotate-45 shrink-0 ml-3"
                    style={{ color: 'var(--text-3)' }}
                  >
                    +
                  </span>
                </summary>
                <div className="px-5 pb-4 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="relative overflow-hidden py-16 sm:py-24">
        <div className="mesh-bg" style={{ position: 'absolute', inset: 0, opacity: 0.4 }} />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <div className="text-5xl mb-4 animate-float">🦊</div>
          <h2
            className="text-2xl sm:text-4xl font-extrabold mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Ready to <span className="gradient-text">Learn Smarter</span>?
          </h2>
          <p className="text-sm sm:text-base mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            Join thousands of Indian students who are learning faster, understanding deeper,
            and scoring higher with Alfanumrik.
          </p>
          <CTAButtons className="justify-center" />
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer
        className="py-10 border-t"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid sm:grid-cols-4 gap-8 mb-8">
            {/* Brand */}
            <div className="sm:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">🦊</span>
                <span className="text-base font-extrabold gradient-text" style={{ fontFamily: 'var(--font-display)' }}>
                  Alfanumrik
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Adaptive Learning OS<br />
                Cusiosense Learning India Pvt. Ltd.
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
                Product
              </h4>
              <div className="space-y-2">
                {[
                  { href: '/login', label: 'Student Login' },
                  { href: '/login?role=parent', label: 'Parent Portal' },
                  { href: '/login?role=teacher', label: 'Teacher Dashboard' },
                  { href: '/simulations', label: 'Interactive Labs' },
                ].map(link => (
                  <Link key={link.href} href={link.href} className="block text-sm hover:underline" style={{ color: 'var(--text-2)' }}>
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
                Legal
              </h4>
              <div className="space-y-2">
                {[
                  { href: '/privacy', label: 'Privacy Policy' },
                  { href: '/terms', label: 'Terms of Service' },
                  { href: '/help', label: 'Help Center' },
                ].map(link => (
                  <Link key={link.href} href={link.href} className="block text-sm hover:underline" style={{ color: 'var(--text-2)' }}>
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* Contact */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
                Contact
              </h4>
              <div className="space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
                <p>support@alfanumrik.com</p>
                <p>Cusiosense Learning India Pvt. Ltd.</p>
                <p>India 🇮🇳</p>
              </div>
            </div>
          </div>

          {/* Bottom */}
          <div
            className="pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-3"
            style={{ borderColor: 'var(--border)' }}
          >
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              © {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd. All rights reserved.
            </p>
            <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
              <span>🛡️ Safe & Secure</span>
              <span>🇮🇳 Made in India</span>
              <span>🔒 No Ads</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
