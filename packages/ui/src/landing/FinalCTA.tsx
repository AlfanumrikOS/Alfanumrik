'use client';

import Link from 'next/link';
import { useLang } from './LangToggle';
import { FoxyMark } from './FoxyMark';
import { FadeIn } from './Animations';

const FAQS = [
  { q: 'Is it really free?', qHi: 'क्या यह सच में मुफ्त है?', a: 'Yes. The free plan includes 5 AI tutor sessions and 5 quizzes per day across 2 subjects. No credit card needed. Upgrade to Starter (₹399/mo), Pro (₹699/mo), or Unlimited (₹999/mo) when you want more.', aHi: 'हाँ। फ्री प्लान में रोज़ 2 विषयों में 5 AI ट्यूटर सेशन और 5 क्विज़ शामिल हैं। क्रेडिट कार्ड नहीं चाहिए। Starter (₹399/माह), Pro (₹699/माह), या Unlimited (₹999/माह) में अपग्रेड करें जब ज़रूरत हो।' },
  { q: 'Is it safe for my child?', qHi: 'क्या यह मेरे बच्चे के लिए सुरक्षित है?', a: 'All data is encrypted. We follow India\'s DPDPA data protection rules. We never show ads, never sell data, and AI responses are filtered to stay age-appropriate and within CBSE curriculum.', aHi: 'सारा डेटा एन्क्रिप्टेड है। हम भारत के DPDPA डेटा सुरक्षा नियमों का पालन करते हैं। हम कभी विज्ञापन नहीं दिखाते, कभी डेटा नहीं बेचते, और AI जवाब उम्र के अनुसार और CBSE पाठ्यक्रम के अंदर रहते हैं।' },
  { q: 'Which grades and subjects?', qHi: 'कौन सी कक्षाएँ और विषय?', a: 'CBSE Grades 6–12. 16 subjects including Mathematics, Science, Physics, Chemistry, Biology, English, Hindi, Social Science, and more.', aHi: 'CBSE कक्षा 6–12। 16 विषय जिनमें गणित, विज्ञान, भौतिकी, रसायन विज्ञान, जीव विज्ञान, अंग्रेज़ी, हिन्दी, सामाजिक विज्ञान, और बहुत कुछ शामिल है।' },
];

function FaqJsonLd() {
  const schema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQS.map((faq) => ({ '@type': 'Question', name: faq.q, acceptedAnswer: { '@type': 'Answer', text: faq.a } })) };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

export function FinalCTA() {
  const { isHi, t } = useLang();
  return (
    <>
      <FaqJsonLd />
      <section id="final-cta" className="relative overflow-hidden py-14 sm:py-20">
        <div className="mesh-bg" style={{ position: 'absolute', inset: 0, opacity: 0.4 }} />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <FadeIn className="flex justify-center mb-4">
            <div className="animate-scale-in"><FoxyMark size="lg" /></div>
          </FadeIn>
          <h2 className="text-2xl sm:text-4xl font-extrabold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Every week without a system is a week of ', 'बिना सिस्टम के हर हफ्ता ')}
            <span className="gradient-text">{t('guesswork', 'अंदाज़ों')}</span>
            {t('.', ' का हफ्ता है।')}
          </h2>
          <p className="text-sm sm:text-lg mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            {t('Start free. See the difference in how your child studies within the first week.', 'मुफ्त शुरू करें। पहले हफ्ते में ही फर्क देखें।')}
          </p>
          <Link href="/login" className="inline-block text-base px-10 py-4 rounded-2xl font-bold text-white" style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)', animation: 'pulse-glow 3s ease-in-out infinite' }}>
            {t('Start Learning Free', 'मुफ्त सीखना शुरू करें')}
          </Link>
          <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>{t('No credit card · 5 free sessions daily · Works on any phone', 'क्रेडिट कार्ड नहीं · रोज़ 5 मुफ्त सेशन · किसी भी फ़ोन पर')}</p>
          <p className="mt-3 text-xs" style={{ color: 'var(--text-3)' }}>
            {t('I\'m a ', 'मैं ')} <Link href="/login?role=teacher" className="underline hover:no-underline">{t('teacher', 'शिक्षक हूँ')}</Link>
            {' · '}
            {t('I\'m a ', 'मैं ')} <Link href="/login" className="underline hover:no-underline">{t('student', 'छात्र हूँ')}</Link>
          </p>
          <div className="mt-12 max-w-2xl mx-auto text-left">
            <h3 className="text-sm font-bold mb-3 text-center" style={{ color: 'var(--text-3)' }}>{t('Quick answers', 'त्वरित जवाब')}</h3>
            <div className="space-y-2">
              {FAQS.map((faq) => (
                <details key={faq.q} className="group rounded-2xl" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                  <summary className="flex items-center justify-between cursor-pointer px-4 py-3.5 text-sm font-semibold list-none" style={{ color: 'var(--text-1)' }}>
                    {isHi ? faq.qHi : faq.q}
                    <span className="text-lg transition-transform duration-200 group-open:rotate-45 shrink-0 ml-3" style={{ color: 'var(--text-3)' }}>+</span>
                  </summary>
                  <div className="px-4 pb-3.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{isHi ? faq.aHi : faq.a}</div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}