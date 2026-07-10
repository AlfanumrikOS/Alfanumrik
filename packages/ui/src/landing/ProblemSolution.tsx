'use client';

import { useLang } from './LangToggle';
import { IconBrainFade, IconScatteredDots, IconEyeStrike, IconBrainConnected, IconBullseye, IconEyeDashboard } from './CustomIcons';
import { FadeIn, StaggerContainer, StaggerItem, HoverScale } from './Animations';

const PROBLEMS = [
  { Icon: IconBrainFade, title: 'Concepts don\'t stick', titleHi: 'कॉन्सेप्ट याद नहीं रहते', desc: 'They read the chapter, attend the class — and still can\'t answer the exam question.', descHi: 'चैप्टर पढ़ते हैं, क्लास जाते हैं — फिर भी परीक्षा में जवाब नहीं दे पाते।' },
  { Icon: IconScatteredDots, title: 'Practice is random', titleHi: 'प्रैक्टिस बेतरतीब है', desc: '50 easy questions don\'t fix the 5 hard ones they keep getting wrong.', descHi: '50 आसान सवाल हल करने से वो 5 कठिन सवाल ठीक नहीं होते जो बार-बार गलत होते हैं।' },
  { Icon: IconEyeStrike, title: 'You can\'t see the real picture', titleHi: 'आपको असली तस्वीर नहीं दिखती', desc: 'By the time the report card arrives, months of gaps have already piled up.', descHi: 'जब तक रिपोर्ट कार्ड आता है, महीनों की कमियाँ जमा हो चुकी होती हैं।' },
];

const SOLUTIONS = [
  { Icon: IconBrainConnected, title: 'Concepts explained until they click', titleHi: 'कॉन्सेप्ट तब तक समझाए जाते हैं जब तक समझ न आ जाए', desc: 'Foxy AI tutor breaks every topic step-by-step. In Hindi or English. Adapts to what your child already knows.', descHi: 'Foxy AI ट्यूटर हर टॉपिक स्टेप-बाय-स्टेप समझाता है। हिन्दी या अंग्रेज़ी में। बच्चे की मौजूदा समझ के अनुसार ढलता है।' },
  { Icon: IconBullseye, title: 'Practice targets weak spots only', titleHi: 'प्रैक्टिस सिर्फ कमज़ोर जगहों पर', desc: 'Smart quizzes adapt to your child\'s level. Board-exam patterns. Bloom\'s taxonomy built in. No wasted repetition.', descHi: 'स्मार्ट क्विज़ बच्चे के स्तर के अनुसार बदलते हैं। बोर्ड परीक्षा पैटर्न। Bloom\'s टैक्सोनॉमी शामिल। बेकार दोहराव नहीं।' },
  { Icon: IconEyeDashboard, title: 'You see progress every day', titleHi: 'आप हर दिन प्रगति देखते हैं', desc: 'Your parent dashboard shows what they studied, what\'s strong, what needs work — updated after every session.', descHi: 'आपका पैरेंट डैशबोर्ड दिखाता है क्या पढ़ा, क्या मज़बूत है, किस पर काम चाहिए — हर सेशन के बाद अपडेट।' },
];

export function ProblemSolution() {
  const { isHi, t } = useLang();
  return (
    <section className="py-12 sm:py-16" style={{ background: 'var(--surface-1)' }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <FadeIn className="text-center mb-8 max-w-2xl mx-auto">
          <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>{t('THE REAL PROBLEM', 'असली समस्या')}</span>
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Most students study hard. The system they follow doesn\'t work.', 'ज़्यादातर बच्चे मेहनत करते हैं। जो सिस्टम वो फॉलो करते हैं, वो काम नहीं करता।')}
          </h2>
        </FadeIn>
        <StaggerContainer className="grid sm:grid-cols-3 gap-4 mb-8">
          {PROBLEMS.map((p) => (
            <StaggerItem key={p.title}>
              <div className="rounded-2xl p-5 flex gap-4 items-start" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <p.Icon />
                <div>
                  <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? p.titleHi : p.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{isHi ? p.descHi : p.desc}</p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
        <FadeIn className="flex flex-col items-center gap-2 my-8">
          <div className="w-full max-w-xs h-px" style={{ background: 'linear-gradient(90deg, transparent, #E8581C, #7C3AED, transparent)' }} />
          <div className="flex items-center justify-center w-8 h-8 rounded-full" style={{ background: 'linear-gradient(135deg, rgba(232,88,28,0.1), rgba(124,58,237,0.1))', border: '1px solid rgba(232,88,28,0.2)' }}>
            <span className="text-xs" style={{ color: 'var(--orange)', lineHeight: 1 }}>↓</span>
          </div>
          <span className="text-xs font-bold" style={{ color: 'var(--orange)' }}>{t('Here\'s what changes', 'यहाँ बदलाव आता है')}</span>
        </FadeIn>
        <StaggerContainer className="grid sm:grid-cols-3 gap-4">
          {SOLUTIONS.map((s) => (
            <StaggerItem key={s.title}>
              <HoverScale>
                <div className="rounded-2xl p-5 flex gap-4 items-start" style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: '3px solid #16A34A' }}>
                  <s.Icon />
                  <div>
                    <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? s.titleHi : s.title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{isHi ? s.descHi : s.desc}</p>
                  </div>
                </div>
              </HoverScale>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}