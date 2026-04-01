'use client';

import Link from 'next/link';
import { LangProvider, LangToggle, useLang } from '@/components/landing/LangToggle';

function WelcomeJsonLd({ faqs }: { faqs: { q: string; qHi?: string; a: string; aHi?: string }[] }) {
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

// SEO metadata is in layout.tsx (Server Component) for SSR indexing

const NAV_LINKS = [
  { href: '/product', label: 'Product', labelHi: 'उत्पाद' },
  { href: '/pricing', label: 'Pricing', labelHi: 'मूल्य' },
  { href: '/for-schools', label: 'For Schools', labelHi: 'स्कूलों के लिए' },
  { href: '/demo', label: 'Book Demo', labelHi: 'डेमो बुक करें' },
];

const PROBLEMS = [
  { icon: '😵', title: 'Concepts don\'t stick', titleHi: 'कॉन्सेप्ट याद नहीं रहते', desc: 'Students read the chapter, attend the class — and still can\'t answer the exam question. Understanding is shallow because revision never happens at the right time.', descHi: 'बच्चे चैप्टर पढ़ते हैं, क्लास अटेंड करते हैं — फिर भी एग्ज़ाम में जवाब नहीं दे पाते। समझ कमज़ोर रहती है क्योंकि रिवीज़न सही समय पर नहीं होता।' },
  { icon: '🎯', title: 'Practice is random', titleHi: 'प्रैक्टिस बेतरतीब है', desc: 'Solving 50 easy questions doesn\'t fix the 5 hard ones you keep getting wrong. Most practice is quantity without direction.', descHi: '50 आसान सवाल हल करने से वो 5 कठिन सवाल ठीक नहीं होते जो बार-बार गलत होते हैं। ज़्यादातर प्रैक्टिस मात्रा है, दिशा नहीं।' },
  { icon: '😰', title: 'Exam stress builds silently', titleHi: 'परीक्षा का तनाव चुपचाप बढ़ता है', desc: 'By the time boards approach, months of unresolved gaps pile up. Students cram, parents worry, teachers repeat — and confidence drops.', descHi: 'जब तक बोर्ड नज़दीक आते हैं, महीनों की अनसुलझी कमियाँ जमा हो जाती हैं। बच्चे रटते हैं, माता-पिता चिंतित होते हैं — और आत्मविश्वास गिरता है।' },
  { icon: '👨‍👩‍👧', title: 'Parents can\'t see the real picture', titleHi: 'माता-पिता को असली तस्वीर नहीं दिखती', desc: 'Report cards arrive too late. Parents don\'t know which chapter is weak until the marks come. There\'s no visibility into daily learning.', descHi: 'रिपोर्ट कार्ड बहुत देर से आते हैं। माता-पिता को पता नहीं चलता कि कौन सा चैप्टर कमज़ोर है जब तक नंबर नहीं आते। रोज़ की पढ़ाई में कोई visibility नहीं।' },
];

const STEPS = [
  { num: '01', icon: '📖', title: 'Learn', titleHi: 'सीखो', desc: 'Clear, structured concept explanations for every CBSE chapter. In Hindi and English.', descHi: 'हर CBSE चैप्टर की स्पष्ट, संरचित कॉन्सेप्ट व्याख्या। हिन्दी और अंग्रेज़ी में।' },
  { num: '02', icon: '✏️', title: 'Practice', titleHi: 'अभ्यास', desc: 'Questions that match your actual level — not too easy, not too hard. Board-exam patterns built in.', descHi: 'सवाल जो आपके स्तर के अनुसार हों — न बहुत आसान, न बहुत कठिन। बोर्ड परीक्षा पैटर्न शामिल।' },
  { num: '03', icon: '🔄', title: 'Revise', titleHi: 'रिवीज़', desc: 'The system brings back what you\'re forgetting — before you forget it. Spaced revision, not last-minute cramming.', descHi: 'सिस्टम वो वापस लाता है जो भूल रहे हो — भूलने से पहले। स्पेस्ड रिवीज़न, लास्ट-मिनट रटाई नहीं।' },
  { num: '04', icon: '📋', title: 'Test', titleHi: 'परीक्षा', desc: 'Structured exams calibrated to your grade, subject, and difficulty. Timed, scored, and analyzed.', descHi: 'आपकी कक्षा, विषय और कठिनाई के अनुसार संरचित परीक्षा। समयबद्ध, अंकित और विश्लेषित।' },
  { num: '05', icon: '📈', title: 'Track', titleHi: 'ट्रैक', desc: 'See exactly what\'s mastered, what\'s weak, and what to do next. Parents and teachers see it too.', descHi: 'देखो क्या महारत हासिल है, क्या कमज़ोर है, और आगे क्या करना है। माता-पिता और शिक्षक भी देख सकते हैं।' },
];

const AUDIENCE = {
  students: {
    icon: '🎓', color: '#E8581C', title: 'For Students', titleHi: 'छात्रों के लिए',
    points: [
      { title: 'Stop re-reading, start understanding', titleHi: 'बार-बार पढ़ना बंद करो, समझना शुरू करो', desc: 'Every concept explained step-by-step until it clicks. Ask doubts anytime in Hindi or English.', descHi: 'हर कॉन्सेप्ट स्टेप-बाय-स्टेप समझाया जाता है जब तक समझ न आ जाए। कभी भी हिन्दी या अंग्रेज़ी में सवाल पूछो।' },
      { title: 'Practice that actually prepares you', titleHi: 'प्रैक्टिस जो सच में तैयार करे', desc: 'Questions adapt to your level. You work on what you need — not what you already know.', descHi: 'सवाल आपके स्तर के अनुसार बदलते हैं। आप वही करते हो जो ज़रूरी है — वो नहीं जो पहले से आता है।' },
      { title: 'Walk into exams with confidence', titleHi: 'परीक्षा में आत्मविश्वास से जाओ', desc: 'Regular practice and smart revision means fewer surprises. Your preparation is measurable, not guesswork.', descHi: 'नियमित प्रैक्टिस और स्मार्ट रिवीज़न का मतलब कम सरप्राइज़। आपकी तैयारी मापने योग्य है, अंदाज़ा नहीं।' },
    ],
  },
  parents: {
    icon: '👨‍👩‍👧', color: '#16A34A', title: 'For Parents', titleHi: 'माता-पिता के लिए',
    points: [
      { title: 'See what your child actually knows', titleHi: 'देखें कि आपका बच्चा वास्तव में क्या जानता है', desc: 'Weekly progress reports show which subjects are strong and which topics need attention — not just marks.', descHi: 'साप्ताहिक प्रोग्रेस रिपोर्ट दिखाती है कि कौन से विषय मज़बूत हैं और किन टॉपिक्स पर ध्यान देना है — सिर्फ नंबर नहीं।' },
      { title: 'Less nagging, more clarity', titleHi: 'कम टोकाटाकी, ज़्यादा स्पष्टता', desc: 'When you can see your child is studying consistently and improving, the daily arguments about screen time disappear.', descHi: 'जब आप देख सकते हैं कि बच्चा नियमित पढ़ रहा है और सुधार कर रहा है, तो स्क्रीन टाइम को लेकर रोज़ की बहस खत्म हो जाती है।' },
      { title: 'Confidence that learning is happening', titleHi: 'भरोसा कि पढ़ाई हो रही है', desc: 'You don\'t need to be a subject expert. The system tracks mastery so you know exactly where things stand.', descHi: 'आपको विषय विशेषज्ञ होने की ज़रूरत नहीं। सिस्टम mastery ट्रैक करता है ताकि आपको पता रहे कि स्थिति क्या है।' },
    ],
  },
  teachers: {
    icon: '👩‍🏫', color: '#2563EB', title: 'For Teachers', titleHi: 'शिक्षकों के लिए',
    points: [
      { title: 'Stop repeating the same explanations', titleHi: 'एक ही बात बार-बार समझाना बंद करें', desc: 'Students who need revision get it automatically. Your class time goes to deeper teaching, not rework.', descHi: 'जिन छात्रों को रिवीज़न चाहिए उन्हें अपने आप मिलता है। आपका क्लास टाइम गहरी पढ़ाई में लगता है, दोहराव में नहीं।' },
      { title: 'See every student\'s gaps instantly', titleHi: 'हर छात्र की कमज़ोरी तुरंत देखें', desc: 'Know who\'s struggling with which topic before the unit test — not after. Intervene early.', descHi: 'यूनिट टेस्ट से पहले जानें कि कौन किस टॉपिक में कमज़ोर है — बाद में नहीं। जल्दी हस्तक्षेप करें।' },
      { title: 'Reports that write themselves', titleHi: 'रिपोर्ट्स जो खुद बन जाती हैं', desc: 'Class performance, individual progress, weakness mapping — generated automatically. Save hours every week.', descHi: 'क्लास परफॉर्मेंस, व्यक्तिगत प्रोग्रेस, कमज़ोरी मैपिंग — सब अपने आप बनता है। हर हफ्ते घंटों की बचत।' },
    ],
  },
  schools: {
    icon: '🏫', color: '#7C3AED', title: 'For Schools', titleHi: 'स्कूलों के लिए',
    points: [
      { title: 'Standardize learning quality across sections', titleHi: 'सभी सेक्शन में शिक्षा की गुणवत्ता एक जैसी करें', desc: 'Every student gets the same structured system regardless of which section or teacher they\'re assigned.', descHi: 'हर छात्र को एक जैसा संरचित सिस्टम मिलता है, चाहे कोई भी सेक्शन या शिक्षक हो।' },
      { title: 'Measurable performance improvement', titleHi: 'मापने योग्य प्रदर्शन सुधार', desc: 'Track school-wide progress by subject, grade, and teacher. Identify patterns and act before results day.', descHi: 'विषय, कक्षा और शिक्षक के अनुसार पूरे स्कूल की प्रगति ट्रैक करें। पैटर्न पहचानें और रिज़ल्ट से पहले कार्रवाई करें।' },
      { title: 'Board exam readiness at a glance', titleHi: 'बोर्ड परीक्षा की तैयारी एक नज़र में', desc: 'See which cohorts are on track and which need intervention — across the entire school.', descHi: 'देखें कौन से बैच सही राह पर हैं और किन्हें मदद चाहिए — पूरे स्कूल में।' },
    ],
  },
};

const RESULTS = [
  { icon: '🧠', metric: 'Concept clarity, not memorization', metricHi: 'रटाई नहीं, कॉन्सेप्ट क्लैरिटी', desc: 'Every topic is taught step-by-step with NCERT-grounded explanations. Foxy adapts to what the student already knows — skipping basics for strong topics and going deeper on weak ones.', descHi: 'हर टॉपिक NCERT-आधारित व्याख्या के साथ स्टेप-बाय-स्टेप पढ़ाया जाता है। Foxy छात्र की मौजूदा समझ के अनुसार ढलता है — मज़बूत टॉपिक की बेसिक्स छोड़कर कमज़ोर टॉपिक पर गहराई से जाता है।' },
  { icon: '📊', metric: 'Progress you can actually see', metricHi: 'प्रगति जो सच में दिखे', desc: 'Every quiz, every Foxy session, every revision generates real data. Students, parents, and teachers see subject-wise mastery, Bloom\'s progression, and weekly improvement — not just marks.', descHi: 'हर क्विज़, हर Foxy सेशन, हर रिवीज़न से असली डेटा बनता है। छात्र, माता-पिता और शिक्षक विषय-वार mastery, Bloom\'s प्रगति और साप्ताहिक सुधार देखते हैं — सिर्फ नंबर नहीं।' },
  { icon: '📝', metric: 'Practice aligned to board exams', metricHi: 'बोर्ड परीक्षा के अनुरूप अभ्यास', desc: 'Questions follow CBSE board patterns and cover all Bloom\'s taxonomy levels — from remembering definitions to applying concepts to analyzing problems. Timed, scored, and analyzed after every attempt.', descHi: 'सवाल CBSE बोर्ड पैटर्न का पालन करते हैं और Bloom\'s के सभी स्तरों को कवर करते हैं — परिभाषाएँ याद करने से लेकर कॉन्सेप्ट लागू करने और समस्याओं का विश्लेषण करने तक। हर प्रयास के बाद समयबद्ध, अंकित और विश्लेषित।' },
  { icon: '💪', metric: 'Revision that prevents forgetting', metricHi: 'रिवीज़न जो भूलने से रोके', desc: 'The spaced repetition engine brings back concepts at the right time — before the student forgets them. No last-minute cramming. Knowledge moves from short-term to long-term memory.', descHi: 'स्पेस्ड रिपिटिशन इंजन कॉन्सेप्ट सही समय पर वापस लाता है — छात्र के भूलने से पहले। कोई लास्ट-मिनट रटाई नहीं। ज्ञान शॉर्ट-टर्म से लॉन्ग-टर्म मेमोरी में जाता है।' },
];

const FAQS = [
  { q: 'What is Alfanumrik?', qHi: 'Alfanumrik क्या है?', a: 'Alfanumrik is a structured learning platform for CBSE students in Grades 6–12. It helps students understand concepts clearly, practice with board-pattern questions, and track real progress — in Hindi and English.', aHi: 'Alfanumrik CBSE कक्षा 6–12 के छात्रों के लिए एक संरचित शिक्षा प्लेटफ़ॉर्म है। यह छात्रों को कॉन्सेप्ट स्पष्ट रूप से समझने, बोर्ड पैटर्न के सवालों से प्रैक्टिस करने, और असली प्रगति ट्रैक करने में मदद करता है — हिन्दी और अंग्रेज़ी में।' },
  { q: 'How is this different from watching videos online?', qHi: 'यह ऑनलाइन वीडियो देखने से कैसे अलग है?', a: 'Videos are passive and one-size-fits-all. Alfanumrik adapts to what each student actually knows, finds their weak spots, gives targeted practice, and tracks which topics are truly mastered — not just watched.', aHi: 'वीडियो passive हैं और सबके लिए एक जैसे। Alfanumrik हर छात्र की असली समझ के अनुसार ढलता है, कमज़ोर जगहें खोजता है, लक्षित प्रैक्टिस देता है, और ट्रैक करता है कि कौन से टॉपिक सच में समझ आ गए हैं — सिर्फ देखे नहीं गए।' },
  { q: 'Is it safe for my child?', qHi: 'क्या यह मेरे बच्चे के लिए सुरक्षित है?', a: 'Yes. We follow DPDPA compliance, encrypt all data, never show ads, and never sell personal information. Students under 13 require parental consent.', aHi: 'हाँ। हम DPDPA अनुपालन करते हैं, सारा डेटा एन्क्रिप्ट करते हैं, कभी विज्ञापन नहीं दिखाते, और कभी व्यक्तिगत जानकारी नहीं बेचते। 13 साल से कम उम्र के छात्रों के लिए माता-पिता की सहमति ज़रूरी है।' },
  { q: 'How do parents track progress?', qHi: 'माता-पिता प्रगति कैसे ट्रैक करते हैं?', a: 'Parents connect using a simple link code from their child\'s profile. You see clear weekly reports — what they studied, quiz scores, strengths, and areas that need attention.', aHi: 'माता-पिता बच्चे की प्रोफ़ाइल से एक सिंपल लिंक कोड से जुड़ते हैं। आपको स्पष्ट साप्ताहिक रिपोर्ट दिखती है — क्या पढ़ा, क्विज़ स्कोर, ताकत, और जिन क्षेत्रों पर ध्यान देना है।' },
  { q: 'Is Alfanumrik free?', qHi: 'क्या Alfanumrik मुफ्त है?', a: 'The free plan includes 5 study sessions and 5 quizzes per day. Starter, Pro, and Unlimited plans unlock more practice, subjects, and features.', aHi: 'फ्री प्लान में रोज़ 5 स्टडी सेशन और 5 क्विज़ शामिल हैं। Starter, Pro, और Unlimited प्लान से ज़्यादा प्रैक्टिस, विषय, और फ़ीचर्स मिलते हैं।' },
  { q: 'Which boards and grades are supported?', qHi: 'कौन से बोर्ड और कक्षाएँ उपलब्ध हैं?', a: 'Currently CBSE Grades 6–12 with 16 subjects including Mathematics, Science, Physics, Chemistry, Biology, English, Hindi, and more.', aHi: 'फिलहाल CBSE कक्षा 6–12 में 16 विषय उपलब्ध हैं जिनमें गणित, विज्ञान, भौतिकी, रसायन विज्ञान, जीव विज्ञान, अंग्रेज़ी, हिन्दी, और बहुत कुछ शामिल है।' },
];

function CTAButtons({ center = false }: { center?: boolean }) {
  const { t } = useLang();
  return (
    <div className={`flex flex-col sm:flex-row items-center gap-3 ${center ? 'justify-center' : ''}`}>
      <Link href="/login" className="text-sm px-7 py-3.5 rounded-xl font-bold text-white w-full sm:w-auto text-center"
        style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}>
        {t('Start Learning Free', 'मुफ्त सीखना शुरू करें')}
      </Link>
      <Link href="/login?role=parent" className="text-sm px-6 py-3.5 rounded-xl font-semibold w-full sm:w-auto text-center"
        style={{ color: '#16A34A', border: '1.5px solid #16A34A40' }}>
        {t('For Parents', 'माता-पिता के लिए')}
      </Link>
      <Link href="/login?role=teacher" className="text-sm px-6 py-3.5 rounded-xl font-semibold w-full sm:w-auto text-center"
        style={{ color: '#2563EB', border: '1.5px solid #2563EB40' }}>
        {t('For Teachers', 'शिक्षकों के लिए')}
      </Link>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <LangProvider>
      <WelcomeContent />
    </LangProvider>
  );
}

function WelcomeContent() {
  const { isHi, t } = useLang();
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
              <Link key={l.href} href={l.href} className="hidden sm:inline-block text-xs font-semibold px-3 py-2 rounded-lg" style={{ color: l.href === '/demo' ? 'var(--orange)' : 'var(--text-2)' }}>{isHi ? l.labelHi : l.label}</Link>
            ))}
            <LangToggle />
            <Link href="/login" className="hidden sm:inline-block text-sm font-semibold px-4 py-2 rounded-lg" style={{ color: 'var(--text-2)' }}>{t('Log In', 'लॉग इन')}</Link>
            <Link href="/login" className="text-sm font-bold px-5 py-2.5 rounded-xl text-white" style={{ background: 'var(--orange)' }}>{t('Sign Up Free', 'मुफ्त साइन अप')}</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mesh-bg" style={{ position: 'absolute', inset: 0, opacity: 0.5 }} />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-8 pb-10 sm:pt-14 sm:pb-18 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-bold px-4 py-1.5 rounded-full mb-4"
            style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)', border: '1px solid rgba(232,88,28,0.15)' }}>
            <span>🇮🇳</span> {t('Adaptive Learning Platform for CBSE Grades 6–12', 'CBSE कक्षा 6–12 के लिए अडैप्टिव लर्निंग प्लेटफ़ॉर्म')}
          </div>

          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold leading-tight mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Your child doesn\'t need more content.', 'आपके बच्चे को और कंटेंट नहीं चाहिए।')}<br />
            <span className="gradient-text">{t('They need a better system.', 'उन्हें एक बेहतर सिस्टम चाहिए।')}</span>
          </h1>

          <p className="text-sm sm:text-lg max-w-2xl mx-auto mb-6" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            {t(
              'Alfanumrik is a structured learning system that fixes how students study — building real concept clarity, consistent revision habits, and measurable exam readiness for CBSE students in Hindi & English.',
              'Alfanumrik एक संरचित शिक्षा प्रणाली है जो बच्चों की पढ़ाई का तरीका सुधारती है — असली कॉन्सेप्ट क्लैरिटी, नियमित रिवीज़न की आदत, और CBSE छात्रों के लिए मापने योग्य परीक्षा तैयारी — हिन्दी और अंग्रेज़ी में।'
            )}
          </p>

          <CTAButtons center />

          <div className="grid grid-cols-4 gap-3 sm:gap-8 max-w-md sm:max-w-none mx-auto mt-10">
            {[
              { value: '16', label: 'Subjects', labelHi: 'विषय' },
              { value: '6–12', label: 'Grades', labelHi: 'कक्षाएँ' },
              { value: 'हिन्दी+En', label: 'Bilingual', labelHi: 'द्विभाषी' },
              { value: 'DPIIT', label: 'Recognized', labelHi: 'मान्यता प्राप्त' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className="text-sm sm:text-xl font-extrabold" style={{ color: 'var(--orange)' }}>{s.value}</div>
                <div className="text-[10px] sm:text-xs font-medium" style={{ color: 'var(--text-3)' }}>{isHi ? s.labelHi : s.label}</div>
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
              {t('Trusted by Indian Families · Recognized by India', 'भारतीय परिवारों का भरोसा · भारत द्वारा मान्यता प्राप्त')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {[
                { label: 'DPIIT Recognized', labelHi: 'DPIIT मान्यता प्राप्त', icon: '🇮🇳' },
                { label: 'DPDPA Compliant', labelHi: 'DPDPA अनुपालित', icon: '🛡️' },
                { label: 'Data Encrypted', labelHi: 'डेटा एन्क्रिप्टेड', icon: '🔒' },
                { label: 'NCERT Aligned', labelHi: 'NCERT के अनुरूप', icon: '📚' },
                { label: 'No Ads. Ever.', labelHi: 'कभी विज्ञापन नहीं।', icon: '🚫' },
              ].map(cert => (
                <span key={cert.label} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                  <span>{cert.icon}</span> {isHi ? cert.labelHi : cert.label}
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
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>{t('THE REAL PROBLEM', 'असली समस्या')}</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              {t('Most students study hard. The system they follow is broken.', 'ज़्यादातर बच्चे मेहनत करते हैं। जो सिस्टम वो फॉलो करते हैं, वो टूटा हुआ है।')}
            </h2>
            <p className="text-sm sm:text-base" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
              {t(
                'The issue isn\'t effort. It\'s that most students have no structured way to identify learning gaps, fix them early, and retain what they\'ve studied. Here\'s what that looks like:',
                'समस्या मेहनत की नहीं है। बात ये है कि ज़्यादातर बच्चों के पास सीखने की कमियों को पहचानने, जल्दी ठीक करने, और जो पढ़ा है उसे याद रखने का कोई संरचित तरीका नहीं है।'
              )}
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {PROBLEMS.map(p => (
              <div key={p.title} className="rounded-2xl p-5 flex gap-4 items-start" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="text-3xl shrink-0">{p.icon}</div>
                <div>
                  <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? p.titleHi : p.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{isHi ? p.descHi : p.desc}</p>
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
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>{t('THE SOLUTION', 'समाधान')}</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              {t('A learning system that finds gaps, fixes them, and proves it worked', 'एक शिक्षा प्रणाली जो कमियाँ खोजती है, उन्हें दूर करती है, और साबित करती है कि काम हुआ')}
            </h2>
            <p className="text-sm sm:text-base" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
              {t(
                'Alfanumrik replaces random studying with a structured cycle: understand the concept, practice at the right level, revise before you forget, test under real conditions, and track every step. No guesswork. No content overload. Just a system that improves student performance measurably.',
                'Alfanumrik बेतरतीब पढ़ाई को एक संरचित चक्र से बदलता है: कॉन्सेप्ट समझो, सही स्तर पर प्रैक्टिस करो, भूलने से पहले रिवीज़ करो, असली परिस्थितियों में टेस्ट दो, और हर कदम ट्रैक करो। कोई अंदाज़ा नहीं। कंटेंट की भरमार नहीं। बस एक सिस्टम जो बच्चों का प्रदर्शन मापने योग्य तरीके से सुधारता है।'
              )}
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { icon: '🧠', title: 'Concept clarity first', titleHi: 'पहले कॉन्सेप्ट क्लैरिटी', desc: 'Every chapter starts with structured explanations — not random videos. Students build understanding before they practice.', descHi: 'हर चैप्टर संरचित व्याख्या से शुरू होता है — रैंडम वीडियो से नहीं। बच्चे प्रैक्टिस से पहले समझ बनाते हैं।', color: '#7C3AED' },
              { icon: '🎯', title: 'Practice that targets weak spots', titleHi: 'कमज़ोर जगहों पर केंद्रित प्रैक्टिस', desc: 'The system identifies what each student doesn\'t know and focuses practice there. No wasted repetition on already-mastered topics.', descHi: 'सिस्टम पहचानता है कि हर छात्र को क्या नहीं आता और वहीं प्रैक्टिस कराता है। पहले से आने वाले टॉपिक पर बेकार दोहराव नहीं।', color: '#E8581C' },
              { icon: '📈', title: 'Progress everyone can see', titleHi: 'प्रगति जो सबको दिखे', desc: 'Students, parents, and teachers all see real-time mastery data. Weekly reports replace monthly surprises.', descHi: 'छात्र, माता-पिता और शिक्षक — सभी रियल-टाइम mastery डेटा देख सकते हैं। साप्ताहिक रिपोर्ट मासिक सरप्राइज़ की जगह लेती है।', color: '#0891B2' },
            ].map(item => (
              <div key={item.title} className="rounded-2xl p-6" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4" style={{ background: `${item.color}12` }}>{item.icon}</div>
                <h3 className="text-sm font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? item.titleHi : item.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{isHi ? item.descHi : item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-12 sm:py-16" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8 max-w-2xl mx-auto">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>{t('HOW IT WORKS', 'कैसे काम करता है')}</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              {t('Five steps. One system. Real improvement.', 'पाँच कदम। एक सिस्टम। असली सुधार।')}
            </h2>
            <p className="text-sm sm:text-base" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
              {t('How to improve student performance in CBSE? Replace random studying with a structured cycle that builds retention and exam readiness.', 'CBSE में बच्चों का प्रदर्शन कैसे सुधारें? बेतरतीब पढ़ाई को एक संरचित चक्र से बदलें जो याददाश्त और परीक्षा तैयारी बनाए।')}
            </p>
          </div>
          <div className="grid sm:grid-cols-5 gap-3">
            {STEPS.map(s => (
              <div key={s.num} className="rounded-2xl p-4 text-center" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--orange)' }}>{s.num}</div>
                <div className="text-2xl mb-2">{s.icon}</div>
                <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? s.titleHi : s.title}</h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>{isHi ? s.descHi : s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* See It In Action — Interactive Product Showcase */}
      <section className="py-12 sm:py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8 max-w-2xl mx-auto">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>{t('SEE IT IN ACTION', 'देखें कैसे काम करता है')}</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              {t('See Alfanumrik in Action', 'Alfanumrik को काम करते देखें')}
            </h2>
            <p className="text-sm sm:text-base" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
              {t('This is what learning looks like inside the platform. Real features, real interface — not stock photos.', 'प्लेटफ़ॉर्म के अंदर पढ़ाई ऐसी दिखती है। असली फ़ीचर्स, असली इंटरफ़ेस — स्टॉक फ़ोटो नहीं।')}
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
            {t('Built for how Indian students ', 'भारतीय छात्र जैसे ')}<span className="gradient-text">{t('actually study', 'असल में पढ़ते हैं')}</span>{t('', ', वैसे ही बनाया गया')}
          </h2>
          <p className="text-sm sm:text-base mb-10 max-w-2xl mx-auto" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            {t(
              'Every feature is designed around CBSE exam patterns, NCERT chapters, and the way Indian students, parents, and teachers work together.',
              'हर फ़ीचर CBSE परीक्षा पैटर्न, NCERT चैप्टर्स, और भारतीय छात्रों, माता-पिता और शिक्षकों के साथ मिलकर काम करने के तरीके को ध्यान में रखकर बनाया गया है।'
            )}
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: '🦊', title: 'Foxy AI Tutor', titleHi: 'Foxy AI ट्यूटर', desc: 'Ask any doubt in Hindi or English. Get step-by-step explanations grounded in NCERT — not random internet answers.', descHi: 'कोई भी सवाल हिन्दी या अंग्रेज़ी में पूछो। NCERT पर आधारित स्टेप-बाय-स्टेप जवाब पाओ — रैंडम इंटरनेट जवाब नहीं।', color: '#E8581C' },
              { icon: '🔬', title: '19 Interactive Simulations', titleHi: '19 इंटरैक्टिव सिमुलेशन', desc: 'Physics, Chemistry, Math — explore concepts hands-on. From Newton\'s Laws to Chemical Balancing to Integration.', descHi: 'भौतिकी, रसायन, गणित — कॉन्सेप्ट हाथों-हाथ समझो। न्यूटन के नियमों से लेकर रासायनिक संतुलन और इंटीग्रेशन तक।', color: '#7C3AED' },
              { icon: '⚡', title: 'Bloom-Aware Quizzes', titleHi: 'Bloom\'s-आधारित क्विज़', desc: 'Questions adapt to your level. Master "remember" before "apply". Board-exam patterns built into every quiz.', descHi: 'सवाल आपके स्तर के अनुसार बदलते हैं। पहले "याद करो" फिर "लागू करो"। हर क्विज़ में बोर्ड परीक्षा पैटर्न शामिल।', color: '#2563EB' },
              { icon: '📊', title: 'Parent Dashboard', titleHi: 'पैरेंट डैशबोर्ड', desc: 'See your child\'s progress in plain language. "Doing well" or "needs help" — not confusing graphs.', descHi: 'अपने बच्चे की प्रगति सरल भाषा में देखें। "अच्छा कर रहा है" या "मदद चाहिए" — भ्रमित करने वाले ग्राफ नहीं।', color: '#16A34A' },
              { icon: '👩‍🏫', title: 'Teacher Command Center', titleHi: 'टीचर कमांड सेंटर', desc: 'See which students need help. Get AI-powered intervention suggestions. Save hours every week.', descHi: 'देखें किन छात्रों को मदद चाहिए। AI-संचालित हस्तक्षेप सुझाव पाएँ। हर हफ्ते घंटों की बचत।', color: '#D97706' },
              { icon: '📋', title: 'Super Admin Control', titleHi: 'सुपर एडमिन कंट्रोल', desc: 'Platform health, learner outcomes, revenue, content gaps — everything an operator needs on one screen.', descHi: 'प्लेटफ़ॉर्म स्वास्थ्य, शिक्षा परिणाम, राजस्व, कंटेंट की कमी — सब कुछ एक स्क्रीन पर।', color: '#0891B2' },
            ].map(f => (
              <div key={f.title} className="text-left rounded-2xl p-5" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                <div className="text-2xl mb-2">{f.icon}</div>
                <h3 className="text-sm font-bold mb-1" style={{ color: f.color }}>{isHi ? f.titleHi : f.title}</h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>{isHi ? f.descHi : f.desc}</p>
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
                <h2 className="text-xl sm:text-2xl font-extrabold" style={{ fontFamily: 'var(--font-display)', color: a.color }}>{isHi ? a.titleHi : a.title}</h2>
              </div>
              <div className="grid sm:grid-cols-3 gap-4 mt-6">
                {a.points.map(p => (
                  <div key={p.title} className="rounded-2xl p-5" style={{ background: idx % 2 === 0 ? 'var(--surface-1)' : 'var(--bg)', border: '1px solid var(--border)' }}>
                    <h3 className="text-sm font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? p.titleHi : p.title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{isHi ? p.descHi : p.desc}</p>
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
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>{t('OUTCOMES', 'परिणाम')}</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              {t('What changes when the system is right', 'जब सिस्टम सही हो तो क्या बदलता है')}
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {RESULTS.map(r => (
              <div key={r.metric} className="rounded-2xl p-5 flex gap-4 items-start" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="text-3xl shrink-0">{r.icon}</div>
                <div>
                  <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? r.metricHi : r.metric}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{isHi ? r.descHi : r.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's Available Today */}
      <section className="py-12 sm:py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8 max-w-2xl mx-auto">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>{t('TRANSPARENCY', 'पारदर्शिता')}</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              {t('What\'s live today', 'आज क्या उपलब्ध है')}
            </h2>
            <p className="text-sm sm:text-base" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
              {t('We believe in honesty. Here\'s exactly what you get when you sign up today.', 'हम ईमानदारी में विश्वास करते हैं। यहाँ बिल्कुल वो है जो आज साइन अप करने पर आपको मिलता है।')}
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-2xl p-6" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">✅</span>
                <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: '#16A34A' }}>{t('Live Now', 'अभी उपलब्ध')}</h3>
              </div>
              <ul className="space-y-2.5">
                {[
                  { en: 'AI Tutor (Foxy) — 16 subjects, Hindi + English', hi: 'AI ट्यूटर (Foxy) — 16 विषय, हिन्दी + अंग्रेज़ी' },
                  { en: 'Adaptive quizzes with Bloom\'s taxonomy', hi: 'Bloom\'s टैक्सोनॉमी के साथ अडैप्टिव क्विज़' },
                  { en: 'Spaced repetition for revision', hi: 'रिवीज़न के लिए स्पेस्ड रिपिटिशन' },
                  { en: 'STEM Centre with 19 interactive simulations', hi: '19 इंटरैक्टिव सिमुलेशन के साथ STEM सेंटर' },
                  { en: 'Progress tracking with mastery data', hi: 'mastery डेटा के साथ प्रगति ट्रैकिंग' },
                  { en: 'Parent dashboard with weekly reports', hi: 'साप्ताहिक रिपोर्ट के साथ पैरेंट डैशबोर्ड' },
                  { en: 'Teacher portal with class management', hi: 'क्लास मैनेजमेंट के साथ टीचर पोर्टल' },
                  { en: 'Study plans and exam preparation', hi: 'स्टडी प्लान और परीक्षा की तैयारी' },
                  { en: 'OCR scan for assignments and papers', hi: 'असाइनमेंट और पेपर के लिए OCR स्कैन' },
                  { en: 'Leaderboard and XP gamification', hi: 'लीडरबोर्ड और XP गेमिफिकेशन' },
                ].map(item => (
                  <li key={item.en} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-2)' }}>
                    <span className="text-green-600 shrink-0 mt-0.5">✓</span>
                    {isHi ? item.hi : item.en}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl p-6" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">🚧</span>
                <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--orange)' }}>{t('Coming Next', 'जल्द आ रहा है')}</h3>
              </div>
              <ul className="space-y-2.5">
                {[
                  { en: 'Olympiad competitions and challenges', hi: 'ओलंपियाड प्रतियोगिताएँ और चैलेंज' },
                  { en: 'WhatsApp notifications for parents', hi: 'माता-पिता के लिए WhatsApp नोटिफिकेशन' },
                  { en: 'School-wide institutional dashboard', hi: 'स्कूल-व्यापी संस्थागत डैशबोर्ड' },
                  { en: 'More regional language support', hi: 'और क्षेत्रीय भाषा समर्थन' },
                  { en: 'Offline mode for low-connectivity areas', hi: 'कम कनेक्टिविटी वाले क्षेत्रों के लिए ऑफलाइन मोड' },
                ].map(item => (
                  <li key={item.en} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-2)' }}>
                    <span className="shrink-0 mt-0.5" style={{ color: 'var(--orange)' }}>→</span>
                    {isHi ? item.hi : item.en}
                  </li>
                ))}
              </ul>
              <p className="text-xs mt-4 pt-3 border-t" style={{ color: 'var(--text-3)', borderColor: 'var(--border)' }}>
                {t('We ship improvements every week. Follow our progress.', 'हम हर हफ्ते सुधार करते हैं। हमारी प्रगति फॉलो करें।')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="py-12 sm:py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>{t('OUR PHILOSOPHY', 'हमारा सिद्धांत')}</span>
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            {t('Systems over shortcuts', 'शॉर्टकट नहीं, सिस्टम')}
          </h2>
          <p className="text-sm sm:text-base mb-6 max-w-2xl mx-auto" style={{ color: 'var(--text-2)', lineHeight: 1.8 }}>
            {t(
              'There are no hacks to real learning. Alfanumrik doesn\'t promise overnight results or magic formulas. It builds a consistent, structured study habit — concept by concept, chapter by chapter — until understanding becomes permanent and exam performance becomes predictable. That\'s how the best platform for concept clarity in students actually works. We just made it available to everyone.',
              'असली सीखने में कोई शॉर्टकट नहीं होता। Alfanumrik रातोंरात नतीजों या जादुई फ़ॉर्मूले का वादा नहीं करता। यह एक नियमित, संरचित पढ़ाई की आदत बनाता है — कॉन्सेप्ट दर कॉन्सेप्ट, चैप्टर दर चैप्टर — जब तक समझ स्थायी न हो जाए और परीक्षा का प्रदर्शन अनुमानित न हो जाए। छात्रों में कॉन्सेप्ट क्लैरिटी का सबसे अच्छा प्लेटफ़ॉर्म ऐसे ही काम करता है। हमने बस इसे सबके लिए उपलब्ध कर दिया।'
            )}
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-6">
            {[
              { icon: '🛡️', label: 'Data Protected', labelHi: 'डेटा सुरक्षित' },
              { icon: '🇮🇳', label: 'Made in India', labelHi: 'भारत में बना' },
              { icon: '🔒', label: 'No Ads Ever', labelHi: 'कभी विज्ञापन नहीं' },
              { icon: '📱', label: 'Hindi & English', labelHi: 'हिन्दी और अंग्रेज़ी' },
            ].map(b => (
              <div key={b.label} className="rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center gap-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                <span>{b.icon}</span> {isHi ? b.labelHi : b.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 sm:py-16" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>{t('FAQ', 'अक्सर पूछे जाने वाले सवाल')}</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold" style={{ fontFamily: 'var(--font-display)' }}>{t('Frequently Asked Questions', 'अक्सर पूछे जाने वाले सवाल')}</h2>
          </div>
          <div className="space-y-3">
            {FAQS.map(faq => (
              <details key={faq.q} className="group rounded-2xl" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <summary className="flex items-center justify-between cursor-pointer px-4 py-3.5 sm:px-5 sm:py-4 text-sm font-semibold list-none" style={{ color: 'var(--text-1)' }}>
                  {isHi ? faq.qHi : faq.q}
                  <span className="text-lg transition-transform duration-200 group-open:rotate-45 shrink-0 ml-3" style={{ color: 'var(--text-3)' }}>+</span>
                </summary>
                <div className="px-4 pb-3.5 sm:px-5 sm:pb-4 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{isHi ? faq.aHi : faq.a}</div>
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
            {t('Every week without a system', 'बिना सिस्टम के हर हफ्ता')}<br />{t('is a week of ', 'एक हफ्ता है ')}<span className="gradient-text">{t('lost progress', 'खोई हुई प्रगति')}</span>{t('.', ' का।')}
          </h2>
          <p className="text-sm sm:text-base mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            {t(
              'Start free. See the difference in how your child studies within the first week. No credit card. No commitment. Just a better way to learn.',
              'मुफ्त शुरू करें। पहले हफ्ते में ही फर्क देखें कि आपका बच्चा कैसे पढ़ता है। कोई क्रेडिट कार्ड नहीं। कोई बंधन नहीं। बस सीखने का एक बेहतर तरीका।'
            )}
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
                {t('Adaptive Learning Platform', 'अडैप्टिव लर्निंग प्लेटफ़ॉर्म')}<br />Cusiosense Learning India Pvt. Ltd.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>{t('Product', 'उत्पाद')}</h4>
              <div className="space-y-2">
                {[{ href: '/product', label: 'Overview', labelHi: 'अवलोकन' }, { href: '/for-schools', label: 'For Schools', labelHi: 'स्कूलों के लिए' }, { href: '/pricing', label: 'Pricing', labelHi: 'मूल्य' }, { href: '/demo', label: 'Book Demo', labelHi: 'डेमो बुक करें' }].map(l => (
                  <Link key={l.href} href={l.href} className="block text-sm hover:underline" style={{ color: 'var(--text-2)' }}>{isHi ? l.labelHi : l.label}</Link>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>{t('Legal', 'कानूनी')}</h4>
              <div className="space-y-2">
                {[{ href: '/privacy', label: 'Privacy Policy', labelHi: 'गोपनीयता नीति' }, { href: '/terms', label: 'Terms', labelHi: 'शर्तें' }, { href: '/security', label: 'Security', labelHi: 'सुरक्षा' }, { href: '/help', label: 'Help Center', labelHi: 'सहायता केंद्र' }].map(l => (
                  <Link key={l.href} href={l.href} className="block text-sm hover:underline" style={{ color: 'var(--text-2)' }}>{isHi ? l.labelHi : l.label}</Link>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>{t('Contact', 'संपर्क')}</h4>
              <div className="space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
                <p>support@alfanumrik.com</p>
                <Link href="/about" className="block hover:underline">{t('About Us', 'हमारे बारे में')}</Link>
                <p>{t('India', 'भारत')} 🇮🇳</p>
              </div>
            </div>
          </div>
          <div className="pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>© {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd. {t('All rights reserved.', 'सर्वाधिकार सुरक्षित।')}</p>
            <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
              <span>🛡️ {t('DPDPA Compliant · Data Encrypted · No Ads', 'DPDPA अनुपालित · डेटा एन्क्रिप्टेड · कोई विज्ञापन नहीं')}</span>
              <span>🇮🇳 {t('DPIIT Recognized Startup', 'DPIIT मान्यता प्राप्त स्टार्टअप')}</span>
              <span>Alfanumrik™ · Cusiosense Learning India Pvt. Ltd.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
