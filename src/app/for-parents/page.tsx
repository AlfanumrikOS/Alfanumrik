'use client';

import Link from 'next/link';
import { LangProvider, LangToggle, useLang } from '@/components/landing/LangToggle';

// SEO metadata is in layout.tsx (Server Component) for SSR indexing

/* ─── Data ─── */

const WHAT_YOU_GET = [
  { icon: '📊', title: 'Weekly Progress Reports', titleHi: 'साप्ताहिक प्रगति रिपोर्ट', desc: 'Receive clear, visual reports every week showing what your child studied, how they performed, and where they improved.', descHi: 'हर हफ़्ते स्पष्ट, विज़ुअल रिपोर्ट प्राप्त करें जो दिखाती हैं कि आपके बच्चे ने क्या पढ़ा, कैसा प्रदर्शन किया, और कहाँ सुधार हुआ।' },
  { icon: '📚', title: 'Subject-Wise Mastery Tracking', titleHi: 'विषयवार दक्षता ट्रैकिंग', desc: 'See exactly how strong your child is in each subject and topic — from remembering facts to applying concepts.', descHi: 'देखें कि आपका बच्चा हर विषय और टॉपिक में कितना मज़बूत है — तथ्य याद रखने से लेकर अवधारणाएँ लागू करने तक।' },
  { icon: '⏱️', title: 'Study Time Monitoring', titleHi: 'पढ़ाई के समय की निगरानी', desc: 'Track how much time your child spends learning each day and week. No guesswork, just real data.', descHi: 'ट्रैक करें कि आपका बच्चा हर दिन और हफ़्ते कितना समय पढ़ाई में बिताता है। अनुमान नहीं, असली डेटा।' },
  { icon: '🎯', title: 'Exam Readiness Scores', titleHi: 'परीक्षा तैयारी स्कोर', desc: 'Know whether your child is on track for board exams with readiness scores across all subjects.', descHi: 'जानें कि आपका बच्चा बोर्ड परीक्षा के लिए तैयार है या नहीं, सभी विषयों में तैयारी स्कोर के साथ।' },
  { icon: '🔔', title: 'Alert When Streaks Are at Risk', titleHi: 'स्ट्रीक खतरे में होने पर अलर्ट', desc: 'Get notified when your child\'s learning streak is about to break, so you can encourage them to stay consistent.', descHi: 'जब आपके बच्चे की लर्निंग स्ट्रीक टूटने वाली हो तो सूचना पाएँ, ताकि आप उन्हें नियमित रहने के लिए प्रोत्साहित कर सकें।' },
];

const CONNECT_STEPS = [
  { step: '1', title: 'Get Link Code', titleHi: 'लिंक कोड प्राप्त करें', desc: 'Your child generates a unique link code from their Alfanumrik profile.', descHi: 'आपका बच्चा अपनी Alfanumrik प्रोफ़ाइल से एक यूनीक लिंक कोड बनाता है।' },
  { step: '2', title: 'Enter in Parent Portal', titleHi: 'पैरेंट पोर्टल में दर्ज करें', desc: 'Sign up as a parent and enter the link code to connect to your child\'s account.', descHi: 'पैरेंट के रूप में साइन अप करें और अपने बच्चे के अकाउंट से जुड़ने के लिए लिंक कोड दर्ज करें।' },
  { step: '3', title: 'See Live Progress', titleHi: 'लाइव प्रगति देखें', desc: 'Instantly access your child\'s learning dashboard with real-time data and weekly reports.', descHi: 'रियल-टाइम डेटा और साप्ताहिक रिपोर्ट के साथ अपने बच्चे का लर्निंग डैशबोर्ड तुरंत देखें।' },
];

const SAFETY = [
  { icon: '🚫', title: 'No Ads', titleHi: 'कोई विज्ञापन नहीं', desc: 'Alfanumrik is completely ad-free. Your child learns without distractions or manipulative marketing.', descHi: 'Alfanumrik पूरी तरह विज्ञापन-मुक्त है। आपका बच्चा बिना किसी भटकाव के सीखता है।' },
  { icon: '🔒', title: 'No Data Selling', titleHi: 'डेटा बेचना नहीं', desc: 'We never sell student or parent data to anyone. Period. Your data stays yours.', descHi: 'हम कभी भी छात्र या अभिभावक का डेटा किसी को नहीं बेचते। आपका डेटा आपका है।' },
  { icon: '📜', title: 'DPDPA Compliant', titleHi: 'DPDPA अनुपालन', desc: 'We comply with India\'s Digital Personal Data Protection Act. Privacy is built into our platform from day one.', descHi: 'हम भारत के Digital Personal Data Protection Act का पालन करते हैं। प्राइवेसी हमारे प्लेटफ़ॉर्म में पहले दिन से शामिल है।' },
  { icon: '👶', title: 'Parental Consent for Under-13', titleHi: '13 वर्ष से कम के लिए अभिभावक सहमति', desc: 'Students under 13 require verified parental consent before their account is activated.', descHi: '13 वर्ष से कम उम्र के छात्रों को अकाउंट एक्टिवेट करने से पहले सत्यापित अभिभावक सहमति की आवश्यकता होती है।' },
];

/* ─── Page ─── */

export default function ForParentsPage() {
  return (
    <LangProvider>
      <ForParentsContent />
    </LangProvider>
  );
}

function ForParentsContent() {
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
            {t('FOR PARENTS', 'अभिभावकों के लिए')}
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight mb-5" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Know Exactly How Your', 'जानें कि आपका')}<br />
            <span style={{ color: 'var(--orange)' }}>{t('Child is Learning', 'बच्चा कैसे सीख रहा है')}</span>
          </h1>
          <p className="text-base sm:text-lg max-w-2xl mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            {t(
              'Alfanumrik keeps you informed with real-time progress data, weekly reports, and exam readiness scores — so you always know where your child stands.',
              'Alfanumrik आपको रियल-टाइम प्रगति डेटा, साप्ताहिक रिपोर्ट, और परीक्षा तैयारी स्कोर के साथ अपडेट रखता है — ताकि आप हमेशा जानें कि आपका बच्चा कहाँ है।'
            )}
          </p>
          <Link
            href="/login?role=parent"
            className="inline-block text-sm font-bold px-8 py-3.5 rounded-xl text-white"
            style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
          >
            {t('Join as Parent', 'अभिभावक के रूप में जुड़ें')}
          </Link>
        </div>
      </section>

      {/* WHAT YOU GET */}
      <section className="py-14 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            {t('What You Get', 'आपको क्या मिलता है')}
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {WHAT_YOU_GET.map(item => (
              <div
                key={item.title}
                className="rounded-2xl p-6"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <span className="text-2xl mb-3 block">{item.icon}</span>
                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{t(item.title, item.titleHi)}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{t(item.desc, item.descHi)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW TO CONNECT */}
      <section className="py-14 sm:py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            {t('How to Connect', 'कैसे जुड़ें')}
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
                <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--text-1)' }}>{t(s.title, s.titleHi)}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{t(s.desc, s.descHi)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SAFETY & PRIVACY */}
      <section className="py-14 sm:py-20" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-10" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Safety & Privacy', 'सुरक्षा और गोपनीयता')}
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {SAFETY.map(item => (
              <div
                key={item.title}
                className="rounded-2xl p-6"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <span className="text-2xl mb-3 block">{item.icon}</span>
                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{t(item.title, item.titleHi)}</h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{t(item.desc, item.descHi)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-16 sm:py-24 text-center">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Stay Connected to Your Child\'s Learning', 'अपने बच्चे की पढ़ाई से जुड़े रहें')}
          </h2>
          <p className="text-sm sm:text-base max-w-lg mx-auto mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            {t(
              'Join thousands of parents who use Alfanumrik to support their children\'s education.',
              'हज़ारों अभिभावकों से जुड़ें जो अपने बच्चों की शिक्षा के लिए Alfanumrik का उपयोग करते हैं।'
            )}
          </p>
          <Link
            href="/login?role=parent"
            className="inline-block text-sm font-bold px-8 py-3.5 rounded-xl text-white"
            style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
          >
            {t('Join as Parent', 'अभिभावक के रूप में जुड़ें')}
          </Link>
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
