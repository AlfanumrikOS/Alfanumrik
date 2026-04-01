'use client';

import Link from 'next/link';
import { LangProvider, LangToggle, useLang } from '@/components/landing/LangToggle';

// SEO metadata is in layout.tsx (Server Component) for SSR indexing

/* ─── Data ─── */

const PAIN_POINTS = [
  { before: 'Grading takes hours', beforeHi: 'ग्रेडिंग में घंटों लगते हैं', after: 'Automated assessment', afterHi: 'ऑटोमेटेड मूल्यांकन', icon: '✅', desc: 'AI grades quizzes instantly and generates detailed performance reports for every student.', descHi: 'AI तुरंत क्विज़ की ग्रेडिंग करता है और हर छात्र के लिए विस्तृत प्रदर्शन रिपोर्ट बनाता है।' },
  { before: 'Can\'t track every student', beforeHi: 'हर छात्र को ट्रैक नहीं कर सकते', after: 'Real-time mastery data', afterHi: 'रियल-टाइम दक्षता डेटा', icon: '📊', desc: 'See exactly where each student stands on every topic with live mastery dashboards.', descHi: 'लाइव दक्षता डैशबोर्ड से हर विषय पर हर छात्र की स्थिति देखें।' },
  { before: 'Generic assignments', beforeHi: 'सामान्य असाइनमेंट', after: 'Adaptive difficulty', afterHi: 'अनुकूली कठिनाई', icon: '🎯', desc: 'Assignments automatically adjust difficulty to each student\'s level — challenging but never frustrating.', descHi: 'असाइनमेंट स्वचालित रूप से हर छात्र के स्तर के अनुसार कठिनाई समायोजित करते हैं — चुनौतीपूर्ण लेकिन कभी निराशाजनक नहीं।' },
  { before: 'No parent engagement', beforeHi: 'अभिभावक की भागीदारी नहीं', after: 'Automated parent reports', afterHi: 'ऑटोमेटेड अभिभावक रिपोर्ट', icon: '📧', desc: 'Parents receive weekly progress updates without you lifting a finger.', descHi: 'अभिभावकों को बिना आपकी मेहनत के साप्ताहिक प्रगति अपडेट मिलते हैं।' },
];

const FEATURES = [
  { icon: '🏫', title: 'Class Management', titleHi: 'कक्षा प्रबंधन', desc: 'Create classes, add students, and organize sections. Students join with a simple class code.', descHi: 'कक्षाएँ बनाएँ, छात्रों को जोड़ें, और सेक्शन व्यवस्थित करें। छात्र एक साधारण क्लास कोड से जुड़ते हैं।' },
  { icon: '📝', title: 'Worksheet Generator', titleHi: 'वर्कशीट जनरेटर', desc: 'Generate CBSE-aligned worksheets in seconds. Choose topics, difficulty, and question types.', descHi: 'सेकंडों में CBSE-अनुरूप वर्कशीट बनाएँ। विषय, कठिनाई और प्रश्न प्रकार चुनें।' },
  { icon: '📈', title: 'Student Analytics', titleHi: 'छात्र एनालिटिक्स', desc: 'Individual and class-wide analytics. Identify struggling students before they fall behind.', descHi: 'व्यक्तिगत और कक्षा-व्यापी एनालिटिक्स। पिछड़ने से पहले संघर्ष कर रहे छात्रों की पहचान करें।' },
  { icon: '📋', title: 'Assignment Creation', titleHi: 'असाइनमेंट बनाना', desc: 'Create practice sets, homework, and tests. Set due dates and track completion rates.', descHi: 'अभ्यास सेट, होमवर्क और टेस्ट बनाएँ। ड्यू डेट सेट करें और पूरा होने की दर ट्रैक करें।' },
  { icon: '🔍', title: 'Progress Tracking', titleHi: 'प्रगति ट्रैकिंग', desc: 'Monitor mastery progression, study time, quiz scores, and learning velocity for every student.', descHi: 'हर छात्र की दक्षता प्रगति, पढ़ाई का समय, क्विज़ स्कोर, और सीखने की गति की निगरानी करें।' },
];

/* ─── Page ─── */

export default function ForTeachersPage() {
  return (
    <LangProvider>
      <ForTeachersContent />
    </LangProvider>
  );
}

function ForTeachersContent() {
  const { t } = useLang();

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text-1)', minHeight: '100vh' }}>
      {/* NAV */}
      <nav
        className="sticky top-0 z-50 border-b"
        style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}
      >
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/welcome" className="flex items-center gap-2">
            <span className="text-2xl">🦊</span>
            <span className="text-lg font-extrabold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>Alfanumrik</span>
          </Link>
          <div className="flex items-center gap-3">
            <LangToggle />
            <Link href="/login" className="text-sm font-semibold px-4 py-2 rounded-lg" style={{ color: 'var(--text-2)' }}>
              {t('Log In', 'लॉग इन')}
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="py-16 sm:py-24 text-center">
        <div className="max-w-5xl mx-auto px-4">
          <span
            className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-4"
            style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}
          >
            {t('FOR TEACHERS', 'शिक्षकों के लिए')}
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight mb-5" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Teach Smarter,', 'स्मार्ट तरीके से पढ़ाएँ,')}<br />
            <span style={{ color: 'var(--orange)' }}>{t('Not Harder', 'ज़्यादा मेहनत नहीं')}</span>
          </h1>
          <p className="text-base sm:text-lg max-w-2xl mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            {t(
              'Alfanumrik gives you AI-powered tools to automate grading, track every student\'s progress, and create adaptive assignments — so you can focus on what matters most: teaching.',
              'Alfanumrik आपको AI-संचालित टूल देता है जो ग्रेडिंग ऑटोमेट करते हैं, हर छात्र की प्रगति ट्रैक करते हैं, और अनुकूली असाइनमेंट बनाते हैं — ताकि आप सबसे ज़रूरी काम पर ध्यान दे सकें: पढ़ाना।'
            )}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login?role=teacher"
              className="text-sm font-bold px-8 py-3.5 rounded-xl text-white w-full sm:w-auto text-center"
              style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
            >
              {t('Start Free', 'मुफ़्त शुरू करें')}
            </Link>
            <Link
              href="/demo"
              className="text-sm font-semibold px-6 py-3.5 rounded-xl w-full sm:w-auto text-center"
              style={{ color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
            >
              {t('Book a Demo', 'डेमो बुक करें')}
            </Link>
          </div>
        </div>
      </section>

      {/* PAIN POINTS SOLVED */}
      <section className="py-14 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Problems We Solve', 'हम कौन सी समस्याएँ हल करते हैं')}
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
                  <span className="text-sm line-through" style={{ color: 'var(--text-3)' }}>{t(p.before, p.beforeHi)}</span>
                  <span className="text-sm" style={{ color: 'var(--text-3)' }}>&rarr;</span>
                  <span className="text-sm font-bold" style={{ color: 'var(--orange)' }}>{t(p.after, p.afterHi)}</span>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{t(p.desc, p.descHi)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="py-14 sm:py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Everything You Need', 'वह सब कुछ जो आपको चाहिए')}
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(f => (
              <div
                key={f.title}
                className="rounded-2xl p-6"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
              >
                <span className="text-2xl mb-3 block">{f.icon}</span>
                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{t(f.title, f.titleHi)}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{t(f.desc, f.descHi)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-16 sm:py-24 text-center" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Ready to Save Hours Every Week?', 'हर हफ़्ते घंटों बचाने के लिए तैयार हैं?')}
          </h2>
          <p className="text-sm sm:text-base max-w-lg mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            {t(
              'Join thousands of teachers who use Alfanumrik to teach more effectively.',
              'हज़ारों शिक्षकों से जुड़ें जो Alfanumrik का उपयोग करके अधिक प्रभावी तरीके से पढ़ाते हैं।'
            )}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login?role=teacher"
              className="text-sm font-bold px-8 py-3.5 rounded-xl text-white w-full sm:w-auto text-center"
              style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
            >
              {t('Start Free', 'मुफ़्त शुरू करें')}
            </Link>
            <Link
              href="/demo"
              className="text-sm font-semibold px-6 py-3.5 rounded-xl w-full sm:w-auto text-center"
              style={{ color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
            >
              {t('Book a Demo', 'डेमो बुक करें')}
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t py-8" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
          <p>&copy; {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" style={{ color: 'var(--text-3)' }}>{t('Privacy', 'गोपनीयता')}</Link>
            <Link href="/terms" style={{ color: 'var(--text-3)' }}>{t('Terms', 'शर्तें')}</Link>
            <Link href="/contact" style={{ color: 'var(--text-3)' }}>{t('Contact', 'संपर्क')}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
