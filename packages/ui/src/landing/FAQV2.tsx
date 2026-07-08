'use client';

import { useWelcomeV2 } from './WelcomeV2Context';
import { track } from '@alfanumrik/lib/posthog/client';
import s from './welcome-v2.module.css';

/**
 * Phase 3 — FAQ section with FAQPage JSON-LD for Google rich results.
 *
 * Architecture choices:
 * - Native <details>/<summary> for accordion behaviour: zero JS state, keyboard
 *   accessible by default (Enter/Space toggles), works without hydration. Stays
 *   well under the P10 bundle budget (no extra JS, ~3 kB CSS).
 * - JSON-LD is intentionally English-only. Google's docs (and our SEO hygiene
 *   from Phase 1) recommend not mixing languages in a single FAQPage entity —
 *   the visible accordion still toggles by isHi for users.
 * - Markdown bold (**word**) is allowed in answer copy for emphasis but is
 *   stripped from the JSON-LD payload (Google does not parse markdown).
 */

const FAQS = [
  {
    qEn: 'Is Alfanumrik aligned with the CBSE syllabus my child follows in school?',
    qHi: 'क्या अल्फ़ान्यूमरिक मेरे बच्चे की स्कूल वाली CBSE पाठ्यक्रम के अनुरूप है?',
    aEn: 'Yes. Every question, explanation, and Foxy response is grounded in the NCERT textbook for the child\'s grade. We map every topic to its chapter and to Bloom\'s taxonomy, so the practice your child does at home matches what the teacher covers in class.',
    aHi: 'हाँ। हर प्रश्न, हर व्याख्या और फ़ॉक्सी का हर उत्तर बच्चे की कक्षा की NCERT पुस्तक पर आधारित है। हम हर विषय को उसके पाठ और ब्लूम स्तर से जोड़ते हैं — ताकि घर पर किया अभ्यास कक्षा में पढ़ाए गए से मेल खाए।',
  },
  {
    qEn: 'How is this different from BYJU\'S, Vedantu, Khan Academy, or coaching apps?',
    qHi: 'यह BYJU\'S, Vedantu, Khan Academy या कोचिंग ऐप्स से कैसे अलग है?',
    aEn: 'Three differences. (i) Sessions are short — ten minutes by design, not two hours of recorded lectures. (ii) Foxy answers in your child\'s language and never invents a fact outside the syllabus. (iii) The parent letter every Sunday tells you the truth about what was learnt and what slipped — no decorative streaks, no leaderboards screaming, no upsells.',
    aHi: 'तीन फ़र्क़। (i) सत्र छोटे हैं — दस मिनट, दो घंटे की रिकॉर्डेड क्लास नहीं। (ii) फ़ॉक्सी आपके बच्चे की भाषा में जवाब देता है और पाठ्यक्रम के बाहर कुछ नहीं गढ़ता। (iii) हर रविवार का अभिभावक पत्र सच बताता है — न शोर मचाते लीडरबोर्ड, न अतिरिक्त बिक्री।',
  },
  {
    qEn: 'What plans are available? Are there hidden fees?',
    qHi: 'कौन-कौन सी योजनाएँ हैं? क्या कोई छुपे हुए शुल्क हैं?',
    aEn: 'Four plans. Explorer is free forever — 5 Foxy chats and 5 quizzes a day across 2 subjects, no card required. Starter is ₹299/month — 30 chats, 20 quizzes, 4 subjects, STEM Lab. Pro is ₹699/month — 100 chats, unlimited quizzes, all subjects, STEM Lab, parent and teacher dashboards. Unlimited is ₹1,499/month — everything in Pro with no daily caps. All paid plans come with a **7-day money-back guarantee**. No hidden fees, no franchise costs, no premium-content tier. Cancel anytime, one tap, no questions asked.',
    aHi: 'चार योजनाएँ। Explorer हमेशा मुफ्त है — प्रतिदिन 5 Foxy चैट और 5 क्विज़ (2 विषय), कोई कार्ड नहीं चाहिए। Starter ₹299/माह — 30 चैट, 20 क्विज़, 4 विषय, STEM लैब। Pro ₹699/माह — 100 चैट, असीमित क्विज़, सभी विषय, STEM लैब, अभिभावक और शिक्षक डैशबोर्ड। Unlimited ₹1,499/माह — Pro की सब सुविधाएँ, कोई दैनिक सीमा नहीं। सभी सशुल्क योजनाओं पर **7-दिन की मनी-बैक गारंटी**। कोई छुपे शुल्क नहीं, कोई अतिरिक्त बिक्री नहीं।',
  },
  {
    qEn: 'Does Foxy work in Hindi? My child is more comfortable in Hindi than English.',
    qHi: 'क्या फ़ॉक्सी हिन्दी में काम करता है? मेरा बच्चा अंग्रेज़ी से ज़्यादा हिन्दी में सहज है।',
    aEn: 'Yes — fully bilingual. Foxy answers questions in Hindi or English at the child\'s choice, and the entire interface (questions, explanations, parent letters, dashboards) switches with one tap. We treat Hindi as a first-class language, not as an afterthought translation.',
    aHi: 'हाँ — पूर्ण द्विभाषी। फ़ॉक्सी बच्चे की पसंद के अनुसार हिन्दी या अंग्रेज़ी में जवाब देता है, और पूरा इंटरफ़ेस (प्रश्न, व्याख्याएँ, अभिभावक पत्र, डैशबोर्ड) एक टैप में बदल जाता है। हिन्दी हमारे लिए प्रथम-श्रेणी की भाषा है, बाद की सोच नहीं।',
  },
  {
    qEn: 'Is there a free trial? Do I need a credit card to start?',
    qHi: 'क्या मुफ़्त ट्रायल है? शुरू करने के लिए क्या क्रेडिट कार्ड चाहिए?',
    aEn: 'Yes — the Explorer plan is permanently free, no card needed. Your child gets 5 Foxy chats and 5 quizzes every day across 2 subjects. If you upgrade to a paid plan and are not satisfied within the first 7 days, we refund you in full — no questions asked. We only ask for payment when you decide the product is worth it.',
    aHi: 'हाँ — Explorer प्लान हमेशा के लिए मुफ्त है, कार्ड नहीं चाहिए। आपके बच्चे को प्रतिदिन 2 विषयों में 5 Foxy चैट और 5 क्विज़ मिलते हैं। अगर आप सशुल्क प्लान लेने के बाद पहले 7 दिनों में संतुष्ट नहीं हैं, तो हम पूरा पैसा वापस करते हैं — बिना कोई प्रश्न पूछे।',
  },
  {
    qEn: 'My child already attends 3 tuition classes. How does Alfanumrik fit in?',
    qHi: 'मेरा बच्चा पहले से 3 ट्यूशन जाता है। अल्फ़ान्यूमरिक कैसे फ़िट होगा?',
    aEn: 'Alfanumrik is the **revision and mastery layer** that sits underneath whatever else your child is doing. Ten minutes after dinner is enough — Foxy targets exactly the topics that slipped that week. Many parents find that after 60 days, their child needs less tuition because they actually understood the chapter the first time.',
    aHi: 'अल्फ़ान्यूमरिक **दोहराव और महारत की परत** है — जो आपके बच्चे की बाक़ी पढ़ाई के नीचे काम करती है। रात के खाने के बाद दस मिनट काफ़ी हैं — फ़ॉक्सी ठीक उन्हीं विषयों को निशाना बनाता है जो उस सप्ताह छूट गए। कई अभिभावक 60 दिनों के बाद कहते हैं कि उन्हें कम ट्यूशन की ज़रूरत पड़ रही है।',
  },
  {
    qEn: 'How do you keep my child\'s data safe? What about DPDPA?',
    qHi: 'मेरे बच्चे का डेटा कैसे सुरक्षित है? DPDPA का क्या?',
    aEn: 'Data is stored in India, end-to-end encrypted, and aligned with the Digital Personal Data Protection Act (DPDPA). We collect the minimum needed to teach (grade, subjects, performance) — never location, never browsing history, never third-party tracking. We never sell student data, ever. Read our full privacy policy at /privacy.',
    aHi: 'डेटा भारत में रखा जाता है, एंड-टू-एंड एन्क्रिप्टेड है, और डिजिटल पर्सनल डेटा प्रोटेक्शन एक्ट (DPDPA) के अनुरूप है। हम पढ़ाने के लिए न्यूनतम जानकारी लेते हैं (कक्षा, विषय, प्रदर्शन) — कभी स्थान नहीं, कभी ब्राउज़िंग इतिहास नहीं, कभी तृतीय-पक्ष ट्रैकिंग नहीं। हम विद्यार्थी डेटा कभी नहीं बेचते। पूरी गोपनीयता नीति: /privacy।',
  },
  {
    qEn: 'What devices does Alfanumrik work on? Is there a mobile app?',
    qHi: 'अल्फ़ान्यूमरिक किन उपकरणों पर चलता है? क्या मोबाइल ऐप है?',
    aEn: 'Web (any modern browser on phone, tablet, or laptop) and a native Android app via the Play Store. The web experience is fully offline-capable — sessions you started on patchy 4G will resume cleanly. iOS app coming later in 2026.',
    aHi: 'वेब (फ़ोन, टैबलेट या लैपटॉप पर कोई भी आधुनिक ब्राउज़र) और Play Store पर एंड्रॉइड ऐप। वेब अनुभव पूरी तरह ऑफ़लाइन-सक्षम है — कमज़ोर 4G पर शुरू किए सत्र बाद में जारी रहते हैं। iOS ऐप 2026 के अंत में।',
  },
  {
    qEn: 'Can teachers and schools use Alfanumrik for entire classrooms?',
    qHi: 'क्या शिक्षक और विद्यालय पूरी कक्षा के लिए अल्फ़ान्यूमरिक का उपयोग कर सकते हैं?',
    aEn: 'Yes. Teachers get a section-level dashboard with Bloom\'s-level diagnostics; schools get bulk seats from 30 to 3,000 with principal-level visibility, NEP-aligned reporting, onboarding, and bilingual support. Visit /for-teachers and /for-schools to learn more.',
    aHi: 'हाँ। शिक्षकों को सेक्शन-स्तर का डैशबोर्ड मिलता है ब्लूम-स्तर के विश्लेषण के साथ; विद्यालयों को 30 से 3,000 तक सीटें मिलती हैं प्रधानाचार्य-स्तर की दृश्यता, NEP-संरेखित रिपोर्ट, ऑनबोर्डिंग और द्विभाषी सहायता के साथ। देखें /for-teachers और /for-schools।',
  },
  {
    qEn: 'What happens if I want to cancel? What is your refund policy?',
    qHi: 'अगर मैं रद्द करना चाहूँ तो क्या होगा? आपकी धनवापसी नीति क्या है?',
    aEn: 'One tap, no questions, no retention agent calling you. For new subscribers, we offer a 7-day full refund — no questions asked. After the guarantee window, cancellation takes effect at the end of the current billing month and you keep access until then. Your child\'s mastery data is retained for 90 days in case you return; after that, it is permanently deleted on request. Read our full refund policy at /refunds.',
    aHi: 'एक टैप, कोई प्रश्न नहीं। नए ग्राहकों के लिए 7-दिन की पूर्ण धनवापसी है। गारंटी अवधि के बाद रद्दीकरण मौजूदा बिलिंग माह के अंत में लागू होता है और तब तक पहुँच बनी रहती है। आपके बच्चे का डेटा 90 दिनों तक रखा जाता है। पूरी नीति: /refunds।',
  },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.qEn,
    acceptedAnswer: {
      '@type': 'Answer',
      // Strip markdown bold; Google's structured-data parser does not interpret it.
      text: f.aEn.replace(/\*\*/g, ''),
    },
  })),
};

export default function FAQV2() {
  const { isHi, t, role } = useWelcomeV2();

  return (
    <section className={s.faq} id="faq" aria-labelledby="faq-title">
      <div className={s.wrap}>
        <div className={s.faqHead}>
          <span className={s.label}>{t('Section · the questions', 'खंड · प्रश्न')}</span>
          <h2 id="faq-title">
            {t('Things parents ', 'अभिभावक जो ')}
            <em>{t('actually ask', 'सच में पूछते हैं')}</em>
            {isHi ? '।' : '.'}
          </h2>
          <p className={s.faqIntro}>
            {t(
              'Ten questions we get every week, answered honestly. If yours is not here, write to hello@alfanumrik.com.',
              'दस सवाल जो हर हफ़्ते आते हैं — ईमानदार जवाब। यदि आपका सवाल यहाँ नहीं है, hello@alfanumrik.com पर लिखें।',
            )}
          </p>
        </div>
        <div className={s.faqList}>
          {FAQS.map((faq, i) => (
            <details
              key={i}
              className={s.faqItem}
              onToggle={(e) => {
                // Phase 5 measurement: fire only on open, not on close.
                if ((e.target as HTMLDetailsElement).open) {
                  track('landing_faq_opened', {
                    faq_index: i + 1,
                    question_en: faq.qEn,
                    active_role: role,
                  });
                }
              }}
            >
              <summary>
                <span className={s.faqQNum}>{String(i + 1).padStart(2, '0')}</span>
                <span className={s.faqQText}>{isHi ? faq.qHi : faq.qEn}</span>
                <span className={s.faqQChev} aria-hidden="true">
                  +
                </span>
              </summary>
              <div className={s.faqA}>
                {isHi ? faq.aHi : faq.aEn}
                {/*
                  AlfaBot deep-link: dispatches a window-level CustomEvent that
                  the AlfaBotProvider listens for. When the widget is OFF (flag
                  disabled / mount not present), the event has no listeners and
                  the click is a silent no-op — exactly what we want.
                */}
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window === 'undefined') return;
                    const question = isHi ? faq.qHi : faq.qEn;
                    window.dispatchEvent(
                      new CustomEvent('alfabot:prefill', { detail: { text: question } }),
                    );
                  }}
                  style={{
                    display: 'inline-block',
                    marginTop: 12,
                    padding: '6px 0',
                    background: 'transparent',
                    border: 'none',
                    color: '#0F5C5F',
                    fontSize: 13,
                    textDecoration: 'underline',
                    textUnderlineOffset: 3,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {isHi ? 'और गहराई से जानना है? AlfaBot से पूछें →' : 'Want to dig deeper? Ask AlfaBot →'}
                </button>
              </div>
            </details>
          ))}
        </div>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </section>
  );
}
