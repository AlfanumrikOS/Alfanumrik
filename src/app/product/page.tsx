'use client';

import Link from 'next/link';
import { LangProvider, LangToggle, useLang } from '@/components/landing/LangToggle';

// SEO metadata is in layout.tsx (Server Component) for SSR indexing

/* ─── Data ─── */

const FOR_STUDENTS = [
  { icon: '🦊', title: 'AI Tutor — Foxy', titleHi: 'AI ट्यूटर — Foxy', desc: 'Chat with your personal AI tutor in Hindi or English. Get step-by-step explanations tailored to your level.', descHi: 'हिंदी या अंग्रेज़ी में अपने व्यक्तिगत AI ट्यूटर से बात करें। अपने स्तर के अनुसार स्टेप-बाय-स्टेप समझ पाएँ।' },
  { icon: '🎯', title: 'Adaptive Quizzes', titleHi: 'अनुकूली क्विज़', desc: 'Questions adjust difficulty in real-time based on your mastery. Always in your zone of proximal development.', descHi: 'प्रश्न आपकी दक्षता के आधार पर रियल-टाइम में कठिनाई समायोजित करते हैं। हमेशा आपके निकटतम विकास क्षेत्र में।' },
  { icon: '🔁', title: 'Spaced Repetition', titleHi: 'स्पेस्ड रिपीटिशन', desc: 'SM-2 algorithm schedules reviews at the optimal time to move knowledge from short-term to long-term memory.', descHi: 'SM-2 एल्गोरिदम ज्ञान को अल्पकालिक से दीर्घकालिक स्मृति में ले जाने के लिए सही समय पर रिव्यू शेड्यूल करता है।' },
  { icon: '🔬', title: 'Interactive Simulations', titleHi: 'इंटरैक्टिव सिमुलेशन', desc: 'Explore physics, chemistry, and math through hands-on virtual experiments and visualizations.', descHi: 'भौतिकी, रसायन विज्ञान और गणित को वर्चुअल प्रयोगों और विज़ुअलाइज़ेशन के ज़रिए सीखें।' },
  { icon: '🎮', title: 'Gamified Learning', titleHi: 'गेमिफाइड लर्निंग', desc: 'Earn XP, maintain streaks, climb leaderboards, and unlock achievements as you learn.', descHi: 'सीखते हुए XP कमाएँ, स्ट्रीक बनाए रखें, लीडरबोर्ड पर चढ़ें, और उपलब्धियाँ अनलॉक करें।' },
];

const FOR_TEACHERS = [
  { icon: '🏫', title: 'Class Management', titleHi: 'कक्षा प्रबंधन', desc: 'Create and manage multiple classes. Add students, set subjects, and organize your virtual classroom.', descHi: 'कई कक्षाएँ बनाएँ और प्रबंधित करें। छात्रों को जोड़ें, विषय सेट करें, और अपनी वर्चुअल कक्षा व्यवस्थित करें।' },
  { icon: '📝', title: 'Assignment Creation', titleHi: 'असाइनमेंट बनाना', desc: 'Generate quizzes and worksheets aligned to CBSE curriculum with one click.', descHi: 'एक क्लिक से CBSE पाठ्यक्रम से जुड़े क्विज़ और वर्कशीट बनाएँ।' },
  { icon: '📊', title: 'Student Analytics', titleHi: 'छात्र एनालिटिक्स', desc: 'Track individual and class-wide mastery levels, identify gaps, and see learning patterns.', descHi: 'व्यक्तिगत और कक्षा-व्यापी दक्षता स्तर ट्रैक करें, कमियाँ पहचानें, और सीखने के पैटर्न देखें।' },
  { icon: '📄', title: 'Worksheet Generator', titleHi: 'वर्कशीट जनरेटर', desc: 'AI-generated worksheets based on topic, difficulty, and Bloom\'s taxonomy level.', descHi: 'विषय, कठिनाई, और Bloom\'s टैक्सोनॉमी स्तर पर आधारित AI-जनित वर्कशीट।' },
  { icon: '📈', title: 'Progress Tracking', titleHi: 'प्रगति ट्रैकिंग', desc: 'Real-time dashboards showing quiz completion, mastery growth, and study time per student.', descHi: 'रियल-टाइम डैशबोर्ड जो क्विज़ पूरा होना, दक्षता वृद्धि, और प्रति छात्र पढ़ाई का समय दिखाते हैं।' },
];

const FOR_PARENTS = [
  { icon: '📊', title: 'Child Progress Reports', titleHi: 'बच्चे की प्रगति रिपोर्ट', desc: 'See detailed breakdowns of your child\'s learning — subjects, topics, mastery levels, and more.', descHi: 'अपने बच्चे की पढ़ाई का विस्तृत विवरण देखें — विषय, टॉपिक, दक्षता स्तर, और बहुत कुछ।' },
  { icon: '📋', title: 'Weekly Summaries', titleHi: 'साप्ताहिक सारांश', desc: 'Receive clear, easy-to-understand weekly summaries of study time, quiz performance, and growth.', descHi: 'पढ़ाई के समय, क्विज़ प्रदर्शन, और विकास का स्पष्ट, आसान साप्ताहिक सारांश प्राप्त करें।' },
  { icon: '🔔', title: 'Alert System', titleHi: 'अलर्ट सिस्टम', desc: 'Get notified when streaks are at risk, when milestones are reached, or when attention is needed.', descHi: 'जब स्ट्रीक खतरे में हो, माइलस्टोन पूरा हो, या ध्यान देने की ज़रूरत हो तब सूचना पाएँ।' },
  { icon: '📝', title: 'Exam Tracking', titleHi: 'परीक्षा ट्रैकिंग', desc: 'Monitor board exam readiness with subject-wise progress and recommended focus areas.', descHi: 'विषयवार प्रगति और सुझाए गए फोकस क्षेत्रों के साथ बोर्ड परीक्षा की तैयारी की निगरानी करें।' },
];

const FOR_SCHOOLS = [
  { icon: '🏢', title: 'Institutional Dashboard', titleHi: 'संस्थागत डैशबोर्ड', desc: 'School-wide analytics covering all classes, teachers, and students in one unified view.', descHi: 'एक एकीकृत दृश्य में सभी कक्षाओं, शिक्षकों और छात्रों को कवर करने वाले स्कूल-व्यापी एनालिटिक्स।' },
  { icon: '📚', title: 'Multi-Class Management', titleHi: 'मल्टी-क्लास प्रबंधन', desc: 'Manage multiple sections, grades, and subjects across your entire school from a single admin panel.', descHi: 'एक ही एडमिन पैनल से अपने पूरे स्कूल में कई सेक्शन, ग्रेड और विषयों का प्रबंधन करें।' },
  { icon: '🎯', title: 'Board Exam Readiness', titleHi: 'बोर्ड परीक्षा की तैयारी', desc: 'Track student preparedness for CBSE board examinations with subject-wise mastery data.', descHi: 'विषयवार दक्षता डेटा के साथ CBSE बोर्ड परीक्षा के लिए छात्रों की तैयारी ट्रैक करें।' },
];

/* ─── Sub-Components ─── */

function SectionTitle({ badge, badgeHi, title, titleHi, subtitle, subtitleHi }: { badge: string; badgeHi: string; title: string; titleHi: string; subtitle: string; subtitleHi: string }) {
  const { t } = useLang();
  return (
    <div style={{ textAlign: 'center', marginBottom: 32, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
      <span style={badgeEl}>{t(badge, badgeHi)}</span>
      <h2 style={h2Style}>{t(title, titleHi)}</h2>
      <p style={subtitleStyle}>{t(subtitle, subtitleHi)}</p>
    </div>
  );
}

function FeatureGrid({ items }: { items: { icon: string; title: string; titleHi: string; desc: string; descHi: string }[] }) {
  const { t } = useLang();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
      {items.map(f => (
        <div key={f.title} style={card}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
          <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 6 }}>{t(f.title, f.titleHi)}</h3>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>{t(f.desc, f.descHi)}</p>
        </div>
      ))}
    </div>
  );
}

function Navbar() {
  const { t } = useLang();
  return (
    <nav style={navStyle}>
      <div style={navInner}>
        <Link href="/welcome" style={logoLink}>
          <span style={{ fontSize: 24 }}>🦊</span>
          <span style={logoText}>Alfanumrik</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LangToggle />
          <Link href="/welcome" style={navLink}>{t('Home', 'होम')}</Link>
        </div>
      </div>
    </nav>
  );
}

function Footer() {
  const { t } = useLang();
  return (
    <footer style={footerStyle}>
      <div style={footerInner}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/privacy" style={footerLink}>{t('Privacy Policy', 'गोपनीयता नीति')}</Link>
          <Link href="/terms" style={footerLink}>{t('Terms of Service', 'सेवा की शर्तें')}</Link>
          <Link href="/contact" style={footerLink}>{t('Contact', 'संपर्क')}</Link>
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
    <LangProvider>
      <ProductContent />
    </LangProvider>
  );
}

function ProductContent() {
  const { t } = useLang();

  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      <Navbar />

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '64px 16px 48px', maxWidth: 800, margin: '0 auto' }}>
        <span style={badgeEl}>{t('PRODUCT', 'प्रोडक्ट')}</span>
        <h1 style={h1Style}>{t('The Complete School Intelligence OS', 'संपूर्ण स्कूल इंटेलिजेंस OS')}</h1>
        <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 600, margin: '0 auto' }}>
          {t(
            'One platform that adapts to every stakeholder in the education ecosystem — students, teachers, parents, and school administrators.',
            'एक प्लेटफ़ॉर्म जो शिक्षा पारिस्थितिकी तंत्र के हर हितधारक के अनुसार ढलता है — छात्र, शिक्षक, अभिभावक, और स्कूल प्रशासक।'
          )}
        </p>
      </section>

      {/* For Students */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="FOR STUDENTS"
            badgeHi="छात्रों के लिए"
            title="Your Personal AI Learning Companion"
            titleHi="आपका व्यक्तिगत AI लर्निंग साथी"
            subtitle="Foxy adapts to your pace, speaks your language, and makes learning feel less like work."
            subtitleHi="Foxy आपकी गति के अनुसार ढलता है, आपकी भाषा बोलता है, और पढ़ाई को आसान बनाता है।"
          />
          <FeatureGrid items={FOR_STUDENTS} />
        </div>
      </section>

      {/* For Teachers */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="FOR TEACHERS"
            badgeHi="शिक्षकों के लिए"
            title="Manage, Track, and Support Every Student"
            titleHi="हर छात्र को प्रबंधित करें, ट्रैक करें, और सहायता दें"
            subtitle="Save hours on administration. Focus on what matters — teaching."
            subtitleHi="प्रशासन में घंटों बचाएँ। जो मायने रखता है उस पर ध्यान दें — पढ़ाना।"
          />
          <FeatureGrid items={FOR_TEACHERS} />
        </div>
      </section>

      {/* For Parents */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="FOR PARENTS"
            badgeHi="अभिभावकों के लिए"
            title="Stay Connected to Your Child's Learning"
            titleHi="अपने बच्चे की पढ़ाई से जुड़े रहें"
            subtitle="Clear, actionable reports without needing to understand the technology."
            subtitleHi="टेक्नोलॉजी समझने की ज़रूरत के बिना स्पष्ट, कार्रवाई योग्य रिपोर्ट।"
          />
          <FeatureGrid items={FOR_PARENTS} />
        </div>
      </section>

      {/* For Schools */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <SectionTitle
            badge="FOR SCHOOLS"
            badgeHi="स्कूलों के लिए"
            title="Institutional Intelligence at Scale"
            titleHi="बड़े पैमाने पर संस्थागत इंटेलिजेंस"
            subtitle="School-wide analytics, multi-class management, and board exam readiness tracking."
            subtitleHi="स्कूल-व्यापी एनालिटिक्स, मल्टी-क्लास प्रबंधन, और बोर्ड परीक्षा तैयारी ट्रैकिंग।"
          />
          <FeatureGrid items={FOR_SCHOOLS} />
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '64px 16px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ ...h2Style, fontSize: 28, marginBottom: 16 }}>{t('Ready to Transform Learning?', 'पढ़ाई को बदलने के लिए तैयार हैं?')}</h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-2, #444)', marginBottom: 24 }}>
            {t(
              'See Alfanumrik in action. Schedule a personalized demo for your school or institution.',
              'Alfanumrik को काम करते देखें। अपने स्कूल या संस्थान के लिए एक व्यक्तिगत डेमो शेड्यूल करें।'
            )}
          </p>
          <Link href="/demo" style={ctaButton}>
            {t('Book a Demo', 'डेमो बुक करें')}
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
