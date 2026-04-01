import type { Metadata } from 'next';
import Link from 'next/link';

function WelcomeJsonLd({ faqs }: { faqs: { q: string; a: string }[] }) {
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.a,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
    />
  );
}

export const metadata: Metadata = {
  title: 'Alfanumrik — Adaptive Learning Platform for CBSE Students India',
  description:
    'Alfanumrik is a structured learning system for CBSE students in Grades 6–12. Improve concept clarity, retention, and exam performance with personalized practice and progress tracking.',
  keywords:
    'adaptive learning platform India, personalized learning for students, CBSE learning platform, improve student performance, online learning system for schools, exam preparation platform India, concept-based learning, structured learning system, student progress tracking, practice and revision system',
  openGraph: {
    title: 'Alfanumrik — Structured Learning That Actually Works',
    description:
      'A personalized learning platform for CBSE students. Clear concepts, smart practice, real progress. Grades 6–12 in Hindi & English.',
    url: 'https://alfanumrik.com/welcome',
    locale: 'en_IN',
    type: 'website',
    siteName: 'Alfanumrik',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alfanumrik — Improve Student Performance in CBSE',
    description: 'Structured learning, smart practice, real progress tracking. CBSE Grades 6–12.',
  },
  alternates: { canonical: 'https://alfanumrik.com/welcome' },
};

const NAV_LINKS = [
  { href: '/product', label: 'Product' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/for-schools', label: 'For Schools' },
  { href: '/demo', label: 'Book Demo' },
];

const PROBLEMS = [
  { icon: '😵', title: 'Concepts don\'t stick', desc: 'Students read the chapter, attend the class — and still can\'t answer the exam question. Understanding is shallow because revision never happens at the right time.' },
  { icon: '🎯', title: 'Practice is random', desc: 'Solving 50 easy questions doesn\'t fix the 5 hard ones you keep getting wrong. Most practice is quantity without direction.' },
  { icon: '😰', title: 'Exam stress builds silently', desc: 'By the time boards approach, months of unresolved gaps pile up. Students cram, parents worry, teachers repeat — and confidence drops.' },
  { icon: '👨‍👩‍👧', title: 'Parents can\'t see the real picture', desc: 'Report cards arrive too late. Parents don\'t know which chapter is weak until the marks come. There\'s no visibility into daily learning.' },
];

const STEPS = [
  { num: '01', icon: '📖', title: 'Learn', desc: 'Clear, structured concept explanations for every CBSE chapter. In Hindi and English.' },
  { num: '02', icon: '✏️', title: 'Practice', desc: 'Questions that match your actual level — not too easy, not too hard. Board-exam patterns built in.' },
  { num: '03', icon: '🔄', title: 'Revise', desc: 'The system brings back what you\'re forgetting — before you forget it. Spaced revision, not last-minute cramming.' },
  { num: '04', icon: '📋', title: 'Test', desc: 'Structured exams calibrated to your grade, subject, and difficulty. Timed, scored, and analyzed.' },
  { num: '05', icon: '📈', title: 'Track', desc: 'See exactly what\'s mastered, what\'s weak, and what to do next. Parents and teachers see it too.' },
];

const AUDIENCE = {
  students: {
    icon: '🎓', color: '#E8581C', title: 'For Students',
    points: [
      { title: 'Stop re-reading, start understanding', desc: 'Every concept explained step-by-step until it clicks. Ask doubts anytime in Hindi or English.' },
      { title: 'Practice that actually prepares you', desc: 'Questions adapt to your level. You work on what you need — not what you already know.' },
      { title: 'Walk into exams with confidence', desc: 'Regular practice and smart revision means fewer surprises. Your preparation is measurable, not guesswork.' },
    ],
  },
  parents: {
    icon: '👨‍👩‍👧', color: '#16A34A', title: 'For Parents',
    points: [
      { title: 'See what your child actually knows', desc: 'Weekly progress reports show which subjects are strong and which topics need attention — not just marks.' },
      { title: 'Less nagging, more clarity', desc: 'When you can see your child is studying consistently and improving, the daily arguments about screen time disappear.' },
      { title: 'Confidence that learning is happening', desc: 'You don\'t need to be a subject expert. The system tracks mastery so you know exactly where things stand.' },
    ],
  },
  teachers: {
    icon: '👩‍🏫', color: '#2563EB', title: 'For Teachers',
    points: [
      { title: 'Stop repeating the same explanations', desc: 'Students who need revision get it automatically. Your class time goes to deeper teaching, not rework.' },
      { title: 'See every student\'s gaps instantly', desc: 'Know who\'s struggling with which topic before the unit test — not after. Intervene early.' },
      { title: 'Reports that write themselves', desc: 'Class performance, individual progress, weakness mapping — generated automatically. Save hours every week.' },
    ],
  },
  schools: {
    icon: '🏫', color: '#7C3AED', title: 'For Schools',
    points: [
      { title: 'Standardize learning quality across sections', desc: 'Every student gets the same structured system regardless of which section or teacher they\'re assigned.' },
      { title: 'Measurable performance improvement', desc: 'Track school-wide progress by subject, grade, and teacher. Identify patterns and act before results day.' },
      { title: 'Board exam readiness at a glance', desc: 'See which cohorts are on track and which need intervention — across the entire school.' },
    ],
  },
};

const RESULTS = [
  { icon: '🧠', metric: 'Deeper understanding', desc: 'Students build real concept clarity through structured explanations and targeted practice — not surface-level memorization.' },
  { icon: '📊', metric: 'Measurable progress', desc: 'Every session produces data. Students, parents, and teachers can see exactly what\'s improving and what needs work.' },
  { icon: '📝', metric: 'Better exam scores', desc: 'When practice is focused, revision is timed correctly, and gaps are fixed early — marks improve as a natural result.' },
  { icon: '💪', metric: 'Real confidence', desc: 'Confidence doesn\'t come from motivational quotes. It comes from knowing you\'ve practiced the right things enough times.' },
];

const FAQS = [
  { q: 'What is Alfanumrik?', a: 'Alfanumrik is a structured learning platform for CBSE students in Grades 6–12. It helps students understand concepts clearly, practice with board-pattern questions, and track real progress — in Hindi and English.' },
  { q: 'How is this different from watching videos online?', a: 'Videos are passive and one-size-fits-all. Alfanumrik adapts to what each student actually knows, finds their weak spots, gives targeted practice, and tracks which topics are truly mastered — not just watched.' },
  { q: 'Is it safe for my child?', a: 'Yes. We follow DPDPA compliance, encrypt all data, never show ads, and never sell personal information. Students under 13 require parental consent.' },
  { q: 'How do parents track progress?', a: 'Parents connect using a simple link code from their child\'s profile. You see clear weekly reports — what they studied, quiz scores, strengths, and areas that need attention.' },
  { q: 'Is Alfanumrik free?', a: 'The free plan includes 5 study sessions and 5 quizzes per day. Starter, Pro, and Unlimited plans unlock more practice, subjects, and features.' },
  { q: 'Which boards and grades are supported?', a: 'Currently CBSE Grades 6–12 with 16 subjects including Mathematics, Science, Physics, Chemistry, Biology, English, Hindi, and more.' },
];

function CTAButtons({ center = false }: { center?: boolean }) {
  return (
    <div className={`flex flex-col sm:flex-row items-center gap-3 ${center ? 'justify-center' : ''}`}>
      <Link href="/login" className="text-sm px-7 py-3.5 rounded-xl font-bold text-white w-full sm:w-auto text-center"
        style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}>
        Start Learning Free
      </Link>
      <Link href="/login?role=parent" className="text-sm px-6 py-3.5 rounded-xl font-semibold w-full sm:w-auto text-center"
        style={{ color: '#16A34A', border: '1.5px solid #16A34A40' }}>
        For Parents
      </Link>
      <Link href="/login?role=teacher" className="text-sm px-6 py-3.5 rounded-xl font-semibold w-full sm:w-auto text-center"
        style={{ color: '#2563EB', border: '1.5px solid #2563EB40' }}>
        For Teachers
      </Link>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>
      <WelcomeJsonLd faqs={FAQS} />
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b" style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/welcome" className="flex items-center gap-2">
            <span className="text-2xl">🦊</span>
            <span className="text-lg font-extrabold gradient-text" style={{ fontFamily: 'var(--font-display)' }}>Alfanumrik™</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-3">
            {NAV_LINKS.map(l => (
              <Link key={l.href} href={l.href} className="hidden sm:inline-block text-xs font-semibold px-3 py-2 rounded-lg" style={{ color: l.href === '/demo' ? 'var(--orange)' : 'var(--text-2)' }}>{l.label}</Link>
            ))}
            <Link href="/login" className="hidden sm:inline-block text-sm font-semibold px-4 py-2 rounded-lg" style={{ color: 'var(--text-2)' }}>Log In</Link>
            <Link href="/login" className="text-sm font-bold px-5 py-2.5 rounded-xl text-white" style={{ background: 'var(--orange)' }}>Sign Up Free</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mesh-bg" style={{ position: 'absolute', inset: 0, opacity: 0.5 }} />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-8 pb-10 sm:pt-14 sm:pb-18 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-bold px-4 py-1.5 rounded-full mb-4"
            style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)', border: '1px solid rgba(232,88,28,0.15)' }}>
            <span>🇮🇳</span> Adaptive Learning Platform for CBSE Grades 6–12
          </div>

          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold leading-tight mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            Your child doesn&apos;t need more content.<br />
            <span className="gradient-text">They need a better system.</span>
          </h1>

          <p className="text-sm sm:text-lg max-w-2xl mx-auto mb-6" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            Alfanumrik is a structured learning system that fixes how students study —
            building real concept clarity, consistent revision habits, and measurable exam readiness
            for CBSE students in Hindi &amp; English.
          </p>

          <CTAButtons center />

          <div className="grid grid-cols-4 gap-3 sm:gap-8 max-w-md sm:max-w-none mx-auto mt-10">
            {[
              { value: '16', label: 'Subjects' },
              { value: '6–12', label: 'Grades' },
              { value: 'हिन्दी+En', label: 'Bilingual' },
              { value: 'DPIIT', label: 'Recognized' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className="text-sm sm:text-xl font-extrabold" style={{ color: 'var(--orange)' }}>{s.value}</div>
                <div className="text-[10px] sm:text-xs font-medium" style={{ color: 'var(--text-3)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust & Recognition */}
      <section className="py-6 sm:py-8 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col items-center gap-4">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              Trusted by Indian Families · Recognized by India
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {[
                { label: 'DPIIT Recognized', icon: '🇮🇳' },
                { label: 'DPDPA Compliant', icon: '🛡️' },
                { label: 'Data Encrypted', icon: '🔒' },
                { label: 'NCERT Aligned', icon: '📚' },
                { label: 'No Ads. Ever.', icon: '🚫' },
              ].map(cert => (
                <span key={cert.label} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                  <span>{cert.icon}</span> {cert.label}
                </span>
              ))}
            </div>
            <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
              Alfanumrik™ is a trademark of Cusiosense Learning India Private Limited · CIN: U58200UP2025PTC238093
            </p>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="py-12 sm:py-16" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8 max-w-2xl mx-auto">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>THE REAL PROBLEM</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              Most students study hard. The system they follow is broken.
            </h2>
            <p className="text-sm sm:text-base" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
              The issue isn&apos;t effort. It&apos;s that most students have no structured way to identify learning gaps,
              fix them early, and retain what they&apos;ve studied. Here&apos;s what that looks like:
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {PROBLEMS.map(p => (
              <div key={p.title} className="rounded-2xl p-5 flex gap-4 items-start" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="text-3xl shrink-0">{p.icon}</div>
                <div>
                  <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>{p.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Solution */}
      <section className="py-12 sm:py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8 max-w-2xl mx-auto">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>THE SOLUTION</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              A learning system that finds gaps, fixes them, and proves it worked
            </h2>
            <p className="text-sm sm:text-base" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
              Alfanumrik replaces random studying with a structured cycle:
              understand the concept, practice at the right level, revise before you forget, test under real conditions, and track every step.
              No guesswork. No content overload. Just a system that improves student performance measurably.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { icon: '🧠', title: 'Concept clarity first', desc: 'Every chapter starts with structured explanations — not random videos. Students build understanding before they practice.', color: '#7C3AED' },
              { icon: '🎯', title: 'Practice that targets weak spots', desc: 'The system identifies what each student doesn\'t know and focuses practice there. No wasted repetition on already-mastered topics.', color: '#E8581C' },
              { icon: '📈', title: 'Progress everyone can see', desc: 'Students, parents, and teachers all see real-time mastery data. Weekly reports replace monthly surprises.', color: '#0891B2' },
            ].map(item => (
              <div key={item.title} className="rounded-2xl p-6" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4" style={{ background: `${item.color}12` }}>{item.icon}</div>
                <h3 className="text-sm font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>{item.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-12 sm:py-16" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8 max-w-2xl mx-auto">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>HOW IT WORKS</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              Five steps. One system. Real improvement.
            </h2>
            <p className="text-sm sm:text-base" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
              How to improve student performance in CBSE? Replace random studying with a structured cycle that builds retention and exam readiness.
            </p>
          </div>
          <div className="grid sm:grid-cols-5 gap-3">
            {STEPS.map(s => (
              <div key={s.num} className="rounded-2xl p-4 text-center" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--orange)' }}>{s.num}</div>
                <div className="text-2xl mb-2">{s.icon}</div>
                <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>{s.title}</h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* See It In Action — Interactive Product Showcase */}
      <section className="py-12 sm:py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8 max-w-2xl mx-auto">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>SEE IT IN ACTION</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              See Alfanumrik in Action
            </h2>
            <p className="text-sm sm:text-base" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
              This is what learning looks like inside the platform. Real features, real interface — not stock photos.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            {/* Card 1: Foxy AI Tutor */}
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg)', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
              <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
                <span className="text-lg">🦊</span>
                <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--orange)' }}>Foxy AI Tutor</span>
                <div className="ml-auto flex gap-1">
                  {['Learn', 'Practice', 'Quiz'].map((mode, i) => (
                    <span key={mode} className="text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{
                      background: i === 0 ? 'var(--orange)' : 'var(--surface-2)',
                      color: i === 0 ? '#fff' : 'var(--text-3)',
                    }}>{mode}</span>
                  ))}
                </div>
              </div>
              <div className="p-4 space-y-3">
                {/* Student message */}
                <div className="flex justify-end">
                  <div className="rounded-2xl rounded-br-md px-3.5 py-2.5 max-w-[80%] text-xs leading-relaxed" style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}>
                    Explain photosynthesis step by step
                  </div>
                </div>
                {/* Foxy response */}
                <div className="flex gap-2 items-start">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0" style={{ background: 'rgba(232,88,28,0.1)' }}>🦊</div>
                  <div className="rounded-2xl rounded-bl-md px-3.5 py-2.5 max-w-[85%] text-xs leading-relaxed" style={{ background: 'var(--surface-1)', color: 'var(--text-1)' }}>
                    <p className="mb-2"><span className="font-bold">Photosynthesis</span> is how plants make food using sunlight. Here are the steps:</p>
                    <p className="mb-1"><span className="font-semibold" style={{ color: 'var(--orange)' }}>Step 1:</span> Light is absorbed by chlorophyll in leaves</p>
                    <p className="mb-1"><span className="font-semibold" style={{ color: 'var(--orange)' }}>Step 2:</span> Water molecules are split (photolysis)</p>
                    <p className="mb-2"><span className="font-semibold" style={{ color: 'var(--orange)' }}>Step 3:</span> CO₂ is fixed into glucose</p>
                    <div className="inline-block text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}>
                      6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂
                    </div>
                    <p className="mt-2" style={{ color: 'var(--text-2)' }}>Can you tell me which organelle contains chlorophyll?</p>
                  </div>
                </div>
                {/* Typing indicator */}
                <div className="flex items-center gap-1.5 pl-9">
                  <div className="flex gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-3)', opacity: 0.5 }} />
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-3)', opacity: 0.35 }} />
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-3)', opacity: 0.2 }} />
                  </div>
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Type your answer...</span>
                </div>
              </div>
            </div>

            {/* Card 2: Smart Quiz */}
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg)', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
              <div className="px-4 py-3 flex items-center justify-between border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚡</span>
                  <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: '#2563EB' }}>Smart Quiz</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}>Apply</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>Medium</span>
                </div>
              </div>
              <div className="p-4 space-y-3">
                {/* Progress bar */}
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold" style={{ color: 'var(--text-3)' }}>Question 7 of 10</span>
                  <span className="text-[10px] font-bold" style={{ color: 'var(--orange)' }}>7/10</span>
                </div>
                <div className="w-full h-1.5 rounded-full" style={{ background: 'var(--surface-2)' }}>
                  <div className="h-full rounded-full" style={{ width: '70%', background: 'linear-gradient(90deg, #E8581C, #F5A623)' }} />
                </div>

                {/* Question */}
                <p className="text-xs font-semibold leading-relaxed mt-2" style={{ color: 'var(--text-1)' }}>
                  Which of the following is the correct product of photosynthesis?
                </p>

                {/* Options */}
                <div className="space-y-2 mt-2">
                  {[
                    { label: 'A', text: 'Carbon dioxide and water', state: 'default' },
                    { label: 'B', text: 'Glucose and oxygen', state: 'correct' },
                    { label: 'C', text: 'Starch and nitrogen', state: 'default' },
                    { label: 'D', text: 'Protein and hydrogen', state: 'default' },
                  ].map(opt => (
                    <div key={opt.label} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs" style={{
                      background: opt.state === 'correct' ? 'rgba(22,163,74,0.08)' : 'var(--surface-1)',
                      border: opt.state === 'correct' ? '1.5px solid rgba(22,163,74,0.4)' : '1px solid var(--border)',
                      color: opt.state === 'correct' ? '#16A34A' : 'var(--text-1)',
                      fontWeight: opt.state === 'correct' ? 600 : 400,
                    }}>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{
                        background: opt.state === 'correct' ? '#16A34A' : 'var(--surface-2)',
                        color: opt.state === 'correct' ? '#fff' : 'var(--text-3)',
                      }}>{opt.state === 'correct' ? '✓' : opt.label}</span>
                      {opt.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Card 3: Progress Dashboard */}
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg)', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
              <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
                <span className="text-lg">📈</span>
                <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: '#7C3AED' }}>Progress Dashboard</span>
              </div>
              <div className="p-4 space-y-4">
                {/* XP / Streak / Level row */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(232,88,28,0.06)', border: '1px solid rgba(232,88,28,0.12)' }}>
                    <div className="text-base font-extrabold" style={{ color: 'var(--orange)' }}>1,240</div>
                    <div className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>Total XP</div>
                  </div>
                  <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(232,88,28,0.06)', border: '1px solid rgba(232,88,28,0.12)' }}>
                    <div className="text-base font-extrabold" style={{ color: 'var(--orange)' }}>7</div>
                    <div className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>Day Streak</div>
                  </div>
                  <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.12)' }}>
                    <div className="text-base font-extrabold" style={{ color: '#7C3AED' }}>Lv 3</div>
                    <div className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>Explorer</div>
                  </div>
                </div>

                {/* Subject mastery rings */}
                <div>
                  <div className="text-[10px] font-semibold mb-2" style={{ color: 'var(--text-3)' }}>Subject Mastery</div>
                  <div className="flex items-center gap-4">
                    {[
                      { subject: 'Maths', pct: 78, color: '#E8581C' },
                      { subject: 'Science', pct: 65, color: '#16A34A' },
                      { subject: 'English', pct: 89, color: '#2563EB' },
                    ].map(s => (
                      <div key={s.subject} className="flex flex-col items-center gap-1">
                        <div className="relative w-12 h-12">
                          <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
                            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" style={{ stroke: 'var(--surface-2)' }} />
                            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round"
                              strokeDasharray={`${s.pct} ${100 - s.pct}`}
                              style={{ stroke: s.color }} />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold" style={{ color: s.color }}>{s.pct}%</span>
                        </div>
                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-2)' }}>{s.subject}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bloom heatmap bar */}
                <div>
                  <div className="text-[10px] font-semibold mb-1.5" style={{ color: 'var(--text-3)' }}>Bloom&apos;s Progression</div>
                  <div className="flex gap-0.5 rounded-lg overflow-hidden h-4">
                    {[
                      { level: 'Remember', width: '30%', color: '#16A34A' },
                      { level: 'Understand', width: '25%', color: '#2563EB' },
                      { level: 'Apply', width: '20%', color: '#7C3AED' },
                      { level: 'Analyse', width: '15%', color: '#E8581C' },
                      { level: 'Evaluate', width: '10%', color: '#D97706' },
                    ].map(b => (
                      <div key={b.level} className="h-full flex items-center justify-center text-[8px] font-bold text-white" style={{ width: b.width, background: b.color }}>
                        {b.width !== '10%' ? b.level.slice(0, 3) : ''}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Card 4: Parent View */}
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg)', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
              <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
                <span className="text-lg">👨‍👩‍👧</span>
                <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: '#16A34A' }}>Parent View</span>
              </div>
              <div className="p-4 space-y-3">
                {/* Child info */}
                <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: 'rgba(22,163,74,0.1)', color: '#16A34A' }}>A</div>
                  <div>
                    <div className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>Aarav Sharma</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Class 8 · CBSE</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-[10px] font-semibold" style={{ color: '#16A34A' }}>Active today</div>
                  </div>
                </div>

                {/* Weekly summary */}
                <div className="rounded-xl p-3" style={{ background: 'rgba(22,163,74,0.04)', border: '1px solid rgba(22,163,74,0.12)' }}>
                  <div className="text-[10px] font-semibold mb-2" style={{ color: '#16A34A' }}>This Week</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-sm font-extrabold" style={{ color: 'var(--text-1)' }}>5</div>
                      <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Quizzes</div>
                    </div>
                    <div>
                      <div className="text-sm font-extrabold" style={{ color: 'var(--text-1)' }}>82%</div>
                      <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Avg Score</div>
                    </div>
                    <div>
                      <div className="text-sm font-extrabold" style={{ color: 'var(--text-1)' }}>45m</div>
                      <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Study Time</div>
                    </div>
                  </div>
                </div>

                {/* Strengths / Weaknesses */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl p-2.5" style={{ background: 'rgba(22,163,74,0.04)', border: '1px solid rgba(22,163,74,0.12)' }}>
                    <div className="text-[10px] font-semibold mb-1" style={{ color: '#16A34A' }}>Strong</div>
                    <div className="text-[10px] leading-relaxed" style={{ color: 'var(--text-2)' }}>Algebra, Photosynthesis, Grammar</div>
                  </div>
                  <div className="rounded-xl p-2.5" style={{ background: 'rgba(232,88,28,0.04)', border: '1px solid rgba(232,88,28,0.12)' }}>
                    <div className="text-[10px] font-semibold mb-1" style={{ color: 'var(--orange)' }}>Needs Work</div>
                    <div className="text-[10px] leading-relaxed" style={{ color: 'var(--text-2)' }}>Geometry, Chemical Reactions</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Product Experience */}
      <section className="py-12 sm:py-16" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
            Built for how Indian students <span className="gradient-text">actually study</span>
          </h2>
          <p className="text-sm sm:text-base mb-10 max-w-2xl mx-auto" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            Every feature is designed around CBSE exam patterns, NCERT chapters, and the way Indian students, parents, and teachers work together.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: '🦊', title: 'Foxy AI Tutor', desc: 'Ask any doubt in Hindi or English. Get step-by-step explanations grounded in NCERT — not random internet answers.', color: '#E8581C' },
              { icon: '🔬', title: '19 Interactive Simulations', desc: 'Physics, Chemistry, Math — explore concepts hands-on. From Newton\'s Laws to Chemical Balancing to Integration.', color: '#7C3AED' },
              { icon: '⚡', title: 'Bloom-Aware Quizzes', desc: 'Questions adapt to your level. Master "remember" before "apply". Board-exam patterns built into every quiz.', color: '#2563EB' },
              { icon: '📊', title: 'Parent Dashboard', desc: 'See your child\'s progress in plain language. "Doing well" or "needs help" — not confusing graphs.', color: '#16A34A' },
              { icon: '👩‍🏫', title: 'Teacher Command Center', desc: 'See which students need help. Get AI-powered intervention suggestions. Save hours every week.', color: '#D97706' },
              { icon: '📋', title: 'Super Admin Control', desc: 'Platform health, learner outcomes, revenue, content gaps — everything an operator needs on one screen.', color: '#0891B2' },
            ].map(f => (
              <div key={f.title} className="text-left rounded-2xl p-5" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                <div className="text-2xl mb-2">{f.icon}</div>
                <h3 className="text-sm font-bold mb-1" style={{ color: f.color }}>{f.title}</h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Audience Sections */}
      {(Object.keys(AUDIENCE) as Array<keyof typeof AUDIENCE>).map((key, idx) => {
        const a = AUDIENCE[key];
        return (
          <section key={key} className="py-12 sm:py-16" style={{ background: idx % 2 === 0 ? 'var(--bg)' : 'var(--surface-1)' }}>
            <div className="max-w-5xl mx-auto px-4 sm:px-6">
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className="text-2xl">{a.icon}</span>
                <h2 className="text-xl sm:text-2xl font-extrabold" style={{ fontFamily: 'var(--font-display)', color: a.color }}>{a.title}</h2>
              </div>
              <div className="grid sm:grid-cols-3 gap-4 mt-6">
                {a.points.map(p => (
                  <div key={p.title} className="rounded-2xl p-5" style={{ background: idx % 2 === 0 ? 'var(--surface-1)' : 'var(--bg)', border: '1px solid var(--border)' }}>
                    <h3 className="text-sm font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>{p.title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{p.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })}

      {/* Results */}
      <section className="py-12 sm:py-16" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8 max-w-2xl mx-auto">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>OUTCOMES</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              What changes when the system is right
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {RESULTS.map(r => (
              <div key={r.metric} className="rounded-2xl p-5 flex gap-4 items-start" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="text-3xl shrink-0">{r.icon}</div>
                <div>
                  <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>{r.metric}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{r.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="py-12 sm:py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>OUR PHILOSOPHY</span>
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            Systems over shortcuts
          </h2>
          <p className="text-sm sm:text-base mb-6 max-w-2xl mx-auto" style={{ color: 'var(--text-2)', lineHeight: 1.8 }}>
            There are no hacks to real learning. Alfanumrik doesn&apos;t promise overnight results or magic formulas.
            It builds a consistent, structured study habit — concept by concept, chapter by chapter — until
            understanding becomes permanent and exam performance becomes predictable. That&apos;s how the best platform
            for concept clarity in students actually works. We just made it available to everyone.
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-6">
            {[
              { icon: '🛡️', label: 'Data Protected' },
              { icon: '🇮🇳', label: 'Made in India' },
              { icon: '🔒', label: 'No Ads Ever' },
              { icon: '📱', label: 'Hindi & English' },
            ].map(b => (
              <div key={b.label} className="rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center gap-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                <span>{b.icon}</span> {b.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 sm:py-16" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>FAQ</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold" style={{ fontFamily: 'var(--font-display)' }}>Frequently Asked Questions</h2>
          </div>
          <div className="space-y-3">
            {FAQS.map(faq => (
              <details key={faq.q} className="group rounded-2xl" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <summary className="flex items-center justify-between cursor-pointer px-4 py-3.5 sm:px-5 sm:py-4 text-sm font-semibold list-none" style={{ color: 'var(--text-1)' }}>
                  {faq.q}
                  <span className="text-lg transition-transform duration-200 group-open:rotate-45 shrink-0 ml-3" style={{ color: 'var(--text-3)' }}>+</span>
                </summary>
                <div className="px-4 pb-3.5 sm:px-5 sm:pb-4 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden py-12 sm:py-20">
        <div className="mesh-bg" style={{ position: 'absolute', inset: 0, opacity: 0.4 }} />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <div className="text-5xl mb-4">🦊</div>
          <h2 className="text-2xl sm:text-4xl font-extrabold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            Every week without a system<br />is a week of <span className="gradient-text">lost progress</span>.
          </h2>
          <p className="text-sm sm:text-base mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            Start free. See the difference in how your child studies within the first week.
            No credit card. No commitment. Just a better way to learn.
          </p>
          <CTAButtons center />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 border-t" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">🦊</span>
                <span className="text-base font-extrabold gradient-text" style={{ fontFamily: 'var(--font-display)' }}>Alfanumrik</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Adaptive Learning Platform<br />Cusiosense Learning India Pvt. Ltd.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Product</h4>
              <div className="space-y-2">
                {[{ href: '/product', label: 'Overview' }, { href: '/for-schools', label: 'For Schools' }, { href: '/pricing', label: 'Pricing' }, { href: '/demo', label: 'Book Demo' }].map(l => (
                  <Link key={l.href} href={l.href} className="block text-sm hover:underline" style={{ color: 'var(--text-2)' }}>{l.label}</Link>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Legal</h4>
              <div className="space-y-2">
                {[{ href: '/privacy', label: 'Privacy Policy' }, { href: '/terms', label: 'Terms' }, { href: '/security', label: 'Security' }, { href: '/help', label: 'Help Center' }].map(l => (
                  <Link key={l.href} href={l.href} className="block text-sm hover:underline" style={{ color: 'var(--text-2)' }}>{l.label}</Link>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Contact</h4>
              <div className="space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
                <p>support@alfanumrik.com</p>
                <Link href="/about" className="block hover:underline">About Us</Link>
                <p>India 🇮🇳</p>
              </div>
            </div>
          </div>
          <div className="pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>© {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd. All rights reserved.</p>
            <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
              <span>🛡️ DPDPA Compliant · Data Encrypted · No Ads</span>
              <span>🇮🇳 DPIIT Recognized Startup</span>
              <span>Alfanumrik™ · Cusiosense Learning India Pvt. Ltd.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
