'use client';

import Link from 'next/link';
import { useLang, LangToggle } from './LangToggle';
import { FoxyMark } from './FoxyMark';
import { FadeIn } from './Animations';

function Nav() {
  const { t } = useLang();
  return (
    <nav className="sticky top-0 z-50 border-b" style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/welcome" className="flex items-center gap-2">
          <FoxyMark size="sm" />
          <span className="text-lg font-extrabold gradient-text" style={{ fontFamily: 'var(--font-display)' }}>Alfanumrik™</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <LangToggle />
          <Link href="/login" className="hidden sm:inline-block text-sm font-semibold px-4 py-2 rounded-lg" style={{ color: 'var(--text-2)' }}>{t('Log In', 'लॉग इन')}</Link>
          <Link href="/login" className="text-sm font-bold px-5 py-2.5 rounded-xl text-white" style={{ background: 'var(--orange)' }}>{t('Sign Up Free', 'मुफ्त साइन अप')}</Link>
        </div>
      </div>
    </nav>
  );
}

function PhoneMockup() {
  return (
    <div className="relative mx-auto animate-float" style={{ width: 280, maxWidth: '100%' }}>
      <div className="rounded-3xl overflow-hidden" style={{ border: '2px solid var(--border)', boxShadow: '0 8px 40px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)', background: 'var(--bg)' }}>
        <div className="flex items-center justify-center py-1.5" style={{ background: 'var(--surface-1)' }}>
          <div className="rounded-full" style={{ width: 48, height: 4, background: 'var(--border)' }} />
        </div>
        <div className="px-3 py-2 flex items-center gap-2 border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
          <FoxyMark size="sm" />
          <span className="text-xs font-bold" style={{ color: '#E8581C', fontFamily: 'var(--font-display)' }}>Foxy AI Tutor</span>
          <div className="ml-auto flex gap-1">
            {['Learn', 'Practice', 'Quiz'].map((mode, i) => (
              <span key={mode} className="text-[9px] font-semibold px-2 py-0.5 rounded-full" style={{ background: i === 0 ? '#E8581C' : 'var(--surface-2)', color: i === 0 ? '#fff' : 'var(--text-3)' }}>{mode}</span>
            ))}
          </div>
        </div>
        <div className="p-3 space-y-2.5" style={{ minHeight: 200 }}>
          <div className="flex justify-end">
            <div className="rounded-2xl rounded-br-md px-3 py-2 max-w-[80%] text-[11px] leading-relaxed" style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}>
              Photosynthesis samjhao step by step
            </div>
          </div>
          <div className="flex gap-2 items-start">
            <FoxyMark size="sm" />
            <div className="rounded-2xl rounded-bl-md px-3 py-2 max-w-[85%] text-[11px] leading-relaxed" style={{ background: 'var(--surface-1)', color: 'var(--text-1)' }}>
              <p className="mb-1.5"><span className="font-bold">Photosynthesis</span> mein plants sunlight se food banate hain:</p>
              <p className="mb-1"><span className="font-semibold" style={{ color: '#E8581C' }}>Step 1:</span> Chlorophyll absorbs light</p>
              <p className="mb-1"><span className="font-semibold" style={{ color: '#E8581C' }}>Step 2:</span> Water splits (photolysis)</p>
              <p className="mb-1.5"><span className="font-semibold" style={{ color: '#E8581C' }}>Step 3:</span> CO₂ → glucose</p>
              <div className="inline-block text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}>6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂</div>
              <p className="mt-1.5" style={{ color: 'var(--text-2)' }}>Bata sakte ho chlorophyll kahan hota hai?</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 pl-9">
            <div className="flex gap-0.5">
              {[0.5, 0.35, 0.2].map((op, i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-3)', opacity: op }} />
              ))}
            </div>
            <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>Type your answer...</span>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-3 -right-4" style={{ transform: 'rotate(12deg)' }}>
        <FoxyMark size="md" />
      </div>
    </div>
  );
}

function StatsStrip() {
  const { isHi } = useLang();
  const stats = [
    { value: '16', label: 'Subjects', labelHi: 'विषय' },
    { value: '6–12', label: 'Grades', labelHi: 'कक्षाएँ' },
    { value: 'हिन्दी+En', label: 'Bilingual', labelHi: 'द्विभाषी' },
    { value: 'DPIIT', label: 'Recognized', labelHi: 'मान्यता प्राप्त' },
  ];
  return (
    <div className="grid grid-cols-4 gap-3 sm:gap-8 max-w-md sm:max-w-none mx-auto mt-10">
      {stats.map((s, i) => (
        <FadeIn key={s.label} delay={i * 0.1}>
          <div className="text-center">
            <div className="text-sm sm:text-xl font-extrabold" style={{ color: 'var(--orange)' }}>{s.value}</div>
            <div className="text-[10px] sm:text-xs font-medium" style={{ color: 'var(--text-3)' }}>{isHi ? s.labelHi : s.label}</div>
          </div>
        </FadeIn>
      ))}
    </div>
  );
}

export function Hero() {
  const { t } = useLang();
  return (
    <>
      <Nav />
      <section className="relative overflow-hidden">
        <div className="mesh-bg" style={{ position: 'absolute', inset: 0, opacity: 0.5 }} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-10 sm:pt-14 sm:pb-18">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 text-xs font-bold px-4 py-1.5 rounded-full mb-4" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)', border: '1px solid rgba(232,88,28,0.15)' }}>
                <span>🇮🇳</span> {t('CBSE Grades 6–12 · Hindi & English', 'CBSE कक्षा 6–12 · हिन्दी और अंग्रेज़ी')}
              </div>
              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold leading-tight mb-4" style={{ fontFamily: 'var(--font-display)' }}>
                {t('What if your child walked into ', 'क्या होगा अगर आपका बच्चा ')}
                <span className="gradient-text">{t('every exam', 'हर परीक्षा')}</span>
                {t(' knowing they\'re prepared?', ' में तैयार होकर जाए?')}
              </h1>
              <p className="text-sm sm:text-lg max-w-xl mb-6" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
                {t('Alfanumrik is a structured learning system that replaces guesswork with real concept clarity — so you stop worrying and start seeing progress.', 'Alfanumrik एक संरचित शिक्षा प्रणाली है जो अंदाज़ों की जगह असली कॉन्सेप्ट क्लैरिटी लाती है — ताकि आप चिंता करना बंद करें और प्रगति देखना शुरू करें।')}
              </p>
              <div id="hero-cta" className="flex flex-col sm:flex-row items-center lg:items-start gap-3">
                <Link href="/login" className="text-base px-8 py-4 rounded-xl font-bold text-white w-full sm:w-auto text-center" style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}>
                  {t('Start Learning Free', 'मुफ्त सीखना शुरू करें')}
                </Link>
              </div>
              <p className="text-xs mt-2 text-center lg:text-left" style={{ color: 'var(--text-3)' }}>
                {t('No credit card · 5 free sessions daily · Cancel anytime', 'क्रेडिट कार्ड नहीं · रोज़ 5 मुफ्त सेशन · कभी भी रद्द करें')}
              </p>
              <p className="mt-2 text-center lg:text-left">
                <Link href="/login?role=teacher" className="text-xs hover:underline" style={{ color: 'var(--text-3)' }}>
                  {t('Are you a teacher?', 'क्या आप शिक्षक हैं?')}
                </Link>
              </p>
            </div>
            <div className="flex justify-center lg:justify-end">
              <PhoneMockup />
            </div>
          </div>
          <StatsStrip />
        </div>
      </section>
    </>
  );
}