'use client';

import Link from 'next/link';
import { LangProvider, LangToggle, useLang } from '@/components/landing/LangToggle';

// SEO metadata is in layout.tsx (Server Component) for SSR indexing

/* ─── Data ─── */

const BENEFITS = [
  { icon: '📈', title: 'Better Learning Outcomes', titleHi: 'बेहतर सीखने के परिणाम', desc: 'AI adapts to each student\'s level, ensuring every learner progresses at their optimal pace.', descHi: 'AI हर छात्र के स्तर के अनुसार ढलता है, जिससे हर विद्यार्थी अपनी सर्वोत्तम गति से आगे बढ़ता है।' },
  { icon: '📊', title: 'Real-Time Student Analytics', titleHi: 'रियल-टाइम छात्र एनालिटिक्स', desc: 'Track mastery, engagement, and performance across every class and section from one dashboard.', descHi: 'एक ही डैशबोर्ड से हर कक्षा और सेक्शन में दक्षता, जुड़ाव और प्रदर्शन ट्रैक करें।' },
  { icon: '⏱️', title: 'Reduced Teacher Workload', titleHi: 'शिक्षकों का कम कार्यभार', desc: 'Automated grading, report generation, and assignment creation save teachers hours every week.', descHi: 'ऑटोमेटेड ग्रेडिंग, रिपोर्ट बनाना और असाइनमेंट बनाना शिक्षकों के हर हफ़्ते घंटों बचाता है।' },
  { icon: '🎯', title: 'Board Exam Readiness Tracking', titleHi: 'बोर्ड परीक्षा तैयारी ट्रैकिंग', desc: 'Track student preparedness for CBSE board examinations with subject-wise mastery data and gap analysis.', descHi: 'विषयवार दक्षता डेटा और गैप एनालिसिस के साथ CBSE बोर्ड परीक्षा के लिए छात्रों की तैयारी ट्रैक करें।' },
];

const STEPS = [
  { step: '1', title: 'Onboard Your School', titleHi: 'अपने स्कूल को जोड़ें', desc: 'We set up your institution with classes, teachers, and subjects in under a day.', descHi: 'हम एक दिन से भी कम समय में आपके संस्थान को कक्षाओं, शिक्षकों और विषयों के साथ सेट अप करते हैं।' },
  { step: '2', title: 'Teachers Create Classes', titleHi: 'शिक्षक कक्षाएँ बनाएँ', desc: 'Teachers add students, assign subjects, and configure their virtual classrooms.', descHi: 'शिक्षक छात्रों को जोड़ते हैं, विषय असाइन करते हैं, और अपनी वर्चुअल कक्षाएँ कॉन्फ़िगर करते हैं।' },
  { step: '3', title: 'Students Learn Adaptively', titleHi: 'छात्र अनुकूली तरीके से सीखें', desc: 'Every student gets a personalized AI tutor that adapts to their learning pace and style.', descHi: 'हर छात्र को एक व्यक्तिगत AI ट्यूटर मिलता है जो उनकी सीखने की गति और शैली के अनुसार ढलता है।' },
  { step: '4', title: 'Track Progress Institution-Wide', titleHi: 'पूरे संस्थान की प्रगति ट्रैक करें', desc: 'Admins see school-wide analytics, class comparisons, and individual student drill-downs.', descHi: 'एडमिन स्कूल-व्यापी एनालिटिक्स, कक्षा तुलना, और व्यक्तिगत छात्र विवरण देखते हैं।' },
];

const INCLUDED = [
  { icon: '🦊', title: 'AI Tutor for Every Student', titleHi: 'हर छात्र के लिए AI ट्यूटर', desc: 'Foxy teaches 16 subjects in Hindi and English with step-by-step explanations.', descHi: 'Foxy 16 विषय हिंदी और अंग्रेज़ी में स्टेप-बाय-स्टेप समझाता है।' },
  { icon: '👩‍🏫', title: 'Teacher Dashboards', titleHi: 'शिक्षक डैशबोर्ड', desc: 'Class management, assignment creation, mastery tracking, and automated reports.', descHi: 'कक्षा प्रबंधन, असाइनमेंट बनाना, दक्षता ट्रैकिंग, और ऑटोमेटेड रिपोर्ट।' },
  { icon: '👨‍👩‍👧', title: 'Parent Portal', titleHi: 'पैरेंट पोर्टल', desc: 'Weekly progress reports keep parents informed and engaged in their child\'s learning.', descHi: 'साप्ताहिक प्रगति रिपोर्ट अभिभावकों को उनके बच्चे की पढ़ाई से जोड़े रखती है।' },
  { icon: '📋', title: 'Analytics & Reporting', titleHi: 'एनालिटिक्स और रिपोर्टिंग', desc: 'Institution-level analytics, board readiness scores, and exportable reports.', descHi: 'संस्थान-स्तरीय एनालिटिक्स, बोर्ड तैयारी स्कोर, और एक्सपोर्ट करने योग्य रिपोर्ट।' },
];

/* ─── Page ─── */

export default function ForSchoolsPage() {
  return (
    <LangProvider>
      <ForSchoolsContent />
    </LangProvider>
  );
}

function ForSchoolsContent() {
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
            {t('FOR SCHOOLS', 'स्कूलों के लिए')}
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight mb-5" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Transform Your School with', 'अपने स्कूल को बदलें')}<br />
            <span style={{ color: 'var(--orange)' }}>{t('AI-Powered Learning', 'AI-संचालित शिक्षा से')}</span>
          </h1>
          <p className="text-base sm:text-lg max-w-2xl mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            {t(
              'Give every student a personal AI tutor. Give every teacher real-time analytics. Give your school a competitive edge in board exam outcomes.',
              'हर छात्र को एक व्यक्तिगत AI ट्यूटर दें। हर शिक्षक को रियल-टाइम एनालिटिक्स दें। अपने स्कूल को बोर्ड परीक्षा परिणामों में प्रतिस्पर्धात्मक बढ़त दें।'
            )}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/demo"
              className="text-sm font-bold px-8 py-3.5 rounded-xl text-white w-full sm:w-auto text-center"
              style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
            >
              {t('Book a Demo', 'डेमो बुक करें')}
            </Link>
            <Link
              href="/contact"
              className="text-sm font-semibold px-6 py-3.5 rounded-xl w-full sm:w-auto text-center"
              style={{ color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
            >
              {t('Contact Sales', 'सेल्स से संपर्क करें')}
            </Link>
          </div>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="py-14 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Why Schools Choose Alfanumrik', 'स्कूल Alfanumrik क्यों चुनते हैं')}
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {BENEFITS.map(b => (
              <div
                key={b.title}
                className="rounded-2xl p-6"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <span className="text-2xl mb-3 block">{b.icon}</span>
                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{t(b.title, b.titleHi)}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{t(b.desc, b.descHi)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-14 sm:py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            {t('How It Works', 'यह कैसे काम करता है')}
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
                <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--text-1)' }}>{t(s.title, s.titleHi)}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{t(s.desc, s.descHi)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHAT'S INCLUDED */}
      <section className="py-14 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            {t("What's Included", 'क्या शामिल है')}
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {INCLUDED.map(i => (
              <div
                key={i.title}
                className="rounded-2xl p-6"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <span className="text-2xl mb-3 block">{i.icon}</span>
                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{t(i.title, i.titleHi)}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{t(i.desc, i.descHi)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-16 sm:py-24 text-center">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Ready to Transform Your School?', 'अपने स्कूल को बदलने के लिए तैयार हैं?')}
          </h2>
          <p className="text-sm sm:text-base max-w-lg mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            {t(
              'Join forward-thinking schools using AI to deliver better learning outcomes.',
              'AI का उपयोग करके बेहतर सीखने के परिणाम देने वाले प्रगतिशील स्कूलों से जुड़ें।'
            )}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/demo"
              className="text-sm font-bold px-8 py-3.5 rounded-xl text-white w-full sm:w-auto text-center"
              style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
            >
              {t('Book a Demo', 'डेमो बुक करें')}
            </Link>
            <Link
              href="/contact"
              className="text-sm font-semibold px-6 py-3.5 rounded-xl w-full sm:w-auto text-center"
              style={{ color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
            >
              {t('Contact Sales', 'सेल्स से संपर्क करें')}
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
