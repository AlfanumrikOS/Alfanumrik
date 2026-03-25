import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Research & Methodology — Alfanumrik',
  description:
    'Alfanumrik\'s adaptive learning engine is grounded in learning science — Bayesian Knowledge Tracing, Bloom\'s Taxonomy, IRT, and spaced repetition. Learn about our research methodology.',
  openGraph: {
    title: 'Research & Methodology — Alfanumrik',
    description:
      'Explore the learning science, AI safety, and assessment methodology behind Alfanumrik\'s adaptive platform.',
    url: 'https://alfanumrik.com/research',
    siteName: 'Alfanumrik',
    type: 'website',
    locale: 'en_IN',
  },
  alternates: { canonical: 'https://alfanumrik.com/research' },
};

/* ─── Data ─── */

const LEARNING_SCIENCE = [
  {
    icon: '📐',
    title: 'Bayesian Knowledge Tracing',
    desc: 'We model each student\'s mastery as a probability distribution, updated in real-time as they answer questions. This lets us estimate not just what they know, but how confident we are in that estimate.',
  },
  {
    icon: '🎯',
    title: 'Bloom\'s Taxonomy Progression',
    desc: 'Questions are tagged across six cognitive levels — Remember, Understand, Apply, Analyze, Evaluate, Create. Students progress upward only when lower levels are mastered.',
  },
  {
    icon: '🧠',
    title: 'Zone of Proximal Development',
    desc: 'Adaptive difficulty keeps students in the sweet spot — challenging enough to grow, but not so hard they disengage. Based on Vygotsky\'s foundational learning theory.',
  },
  {
    icon: '🔁',
    title: 'Spaced Repetition (SM-2)',
    desc: 'The SuperMemo SM-2 algorithm schedules review sessions at increasing intervals, optimizing the transfer from short-term to long-term memory.',
  },
];

const AI_SAFETY = [
  {
    icon: '🛡️',
    title: 'Content Moderation',
    desc: 'All AI-generated responses pass through multi-layer content filters ensuring age-appropriate, safe, and educational content only.',
  },
  {
    icon: '👶',
    title: 'Age-Appropriate Responses',
    desc: 'Foxy adjusts language complexity, examples, and tone based on the student\'s grade level and age.',
  },
  {
    icon: '📚',
    title: 'Curriculum Alignment (NCERT/CBSE)',
    desc: 'AI responses are grounded in NCERT textbooks and CBSE curriculum. Foxy never teaches content outside the approved syllabus.',
  },
  {
    icon: '⚠️',
    title: 'Hallucination Prevention',
    desc: 'Retrieval-augmented generation (RAG) with curriculum-specific embeddings ensures factual accuracy. Confidence scoring flags uncertain responses for review.',
  },
];

const ASSESSMENT = [
  {
    icon: '📊',
    title: 'Item Response Theory (IRT)',
    desc: 'Each question is calibrated using IRT parameters — difficulty, discrimination, and guessing. This enables precise measurement of student ability independent of the specific questions asked.',
  },
  {
    icon: '🧩',
    title: 'Cognitive Load Theory',
    desc: 'Quiz sessions are designed to manage intrinsic, extraneous, and germane cognitive load. Question sequencing and hint systems prevent overload.',
  },
  {
    icon: '🔍',
    title: 'Error Classification',
    desc: 'Wrong answers are categorized as careless errors, conceptual misunderstandings, or misinterpretations. Each type triggers different remediation strategies.',
  },
];

const DATA_PRIVACY = [
  {
    icon: '🇮🇳',
    title: 'DPDPA Compliance',
    desc: 'Full compliance with the Digital Personal Data Protection Act, 2023. Lawful basis for processing, data principal rights, and grievance redressal mechanisms.',
  },
  {
    icon: '📦',
    title: 'Data Minimization',
    desc: 'We collect only what\'s necessary for the learning experience. No unnecessary personal data collection, no behavioral tracking for advertising.',
  },
  {
    icon: '🚫',
    title: 'No Advertising',
    desc: 'Alfanumrik will never show ads to students. Student data is never used for advertising purposes or sold to third parties.',
  },
  {
    icon: '👨‍👩‍👧',
    title: 'Parental Consent for Minors',
    desc: 'Students under 13 require verified parental consent before account creation, in compliance with DPDPA child data protection provisions.',
  },
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      {items.map(item => (
        <div key={item.title} style={card}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>{item.icon}</div>
          <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 6 }}>{item.title}</h3>
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

export default function ResearchPage() {
  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      <Navbar />

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '64px 16px 48px', maxWidth: 800, margin: '0 auto' }}>
        <span style={badgeStyle}>METHODOLOGY</span>
        <h1 style={h1Style}>Research-Backed Adaptive Learning</h1>
        <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 600, margin: '0 auto' }}>
          Every algorithm, every question sequence, and every AI interaction in Alfanumrik is grounded
          in peer-reviewed learning science and responsible AI principles.
        </p>
      </section>

      {/* Learning Science */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="LEARNING SCIENCE"
            title="How We Model Learning"
            subtitle="Our adaptive engine draws on decades of cognitive science and educational psychology research."
          />
          <ItemGrid items={LEARNING_SCIENCE} />
        </div>
      </section>

      {/* AI Safety */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="AI SAFETY"
            title="Responsible AI for Education"
            subtitle="AI in education demands the highest standards of safety, accuracy, and age-appropriateness."
          />
          <ItemGrid items={AI_SAFETY} />
        </div>
      </section>

      {/* Assessment */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="ASSESSMENT METHODOLOGY"
            title="Measuring Understanding, Not Just Answers"
            subtitle="Our assessment framework goes beyond right and wrong to understand how students think."
          />
          <ItemGrid items={ASSESSMENT} />
        </div>
      </section>

      {/* Data & Privacy */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="DATA & PRIVACY"
            title="Ethical Data Practices"
            subtitle="Student data is a sacred trust. Our data practices reflect that responsibility."
          />
          <ItemGrid items={DATA_PRIVACY} />
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
