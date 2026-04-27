'use client';

import Link from 'next/link';
import { useWelcomeV2, type Role } from './WelcomeV2Context';
import s from './welcome-v2.module.css';

interface RoleCopy {
  eyebrow: { en: string; hi: string };
  headlineEn: React.ReactNode;
  headlineHi: React.ReactNode;
  devaEn: string;
  devaHi: string;
  lede1: { en: string; hi: string };
  lede2: { en: React.ReactNode; hi: React.ReactNode };
  ctaLabel: { en: string; hi: string };
  ctaHref: string;
}

const ROLE_COPY: Record<Role, RoleCopy> = {
  parent: {
    eyebrow: {
      en: 'The learning workbook · for the home, the class, the phone',
      hi: 'सीखने की किताब · घर, कक्षा और फ़ोन के लिए',
    },
    headlineEn: <>Every exam,<br /><em>prepared.</em></>,
    headlineHi: <>हर परीक्षा,<br /><em>तैयार।</em></>,
    devaEn: 'हर परीक्षा, तैयारी से।',
    devaHi: 'हर परीक्षा, तैयारी से।',
    lede1: {
      en: "Alfanumrik is a CBSE-aligned learning OS for grades six through twelve. Foxy, our patient little tutor, walks beside your child through photosynthesis, quadratics and the Mughal succession — at the pace they can actually hold.",
      hi: "अल्फ़ान्यूमरिक छठी से बारहवीं तक के सीबीएसई विद्यार्थियों के लिए एक संरचित सीखने का सिस्टम है। फ़ॉक्सी — हमारा धैर्यवान छोटा शिक्षक — आपके बच्चे के साथ उसी रफ़्तार से चलता है, जो वह सच में सम्भाल सके।",
    },
    lede2: {
      en: (
        <>
          No infinite scrolls. No leaderboards screaming. Just a clean workbook,
          a kind voice in <span className="deva" lang="hi">हिन्दी</span> or English,
          and a parent dashboard that finally tells you the truth — what they
          know, where they slipped, what to do tonight.
        </>
      ),
      hi: (
        <>
          न अंतहीन स्क्रॉल, न शोर मचाते लीडरबोर्ड। बस एक साफ़ किताब,
          <span className="deva" lang="hi"> हिन्दी </span> या अंग्रेज़ी में
          एक नर्म आवाज़, और एक अभिभावक डैशबोर्ड जो आख़िरकार सच बताता है —
          बच्चा क्या जानता है, कहाँ चूका, और आज रात क्या करें।
        </>
      ),
    },
    ctaLabel: {
      en: "See your child's first session free",
      hi: 'पहला सत्र मुफ्त में देखिये',
    },
    ctaHref: '/login',
  },
  student: {
    eyebrow: {
      en: 'A patient tutor · in your pocket · in your language',
      hi: 'धैर्यवान शिक्षक · आपके फ़ोन में · आपकी भाषा में',
    },
    headlineEn: <>The chapter,<br /><em>finally clear.</em></>,
    headlineHi: <>अब समझ में,<br /><em>आ गया।</em></>,
    devaEn: 'अब समझ में, आ गया।',
    devaHi: 'अब समझ में, आ गया।',
    lede1: {
      en: 'Foxy answers in Hindi or English, never sighs, never makes you feel small. Ask anything from your NCERT — photosynthesis to quadratics — and get back a question that helps you find the answer yourself.',
      hi: 'फ़ॉक्सी हिन्दी या अंग्रेज़ी में जवाब देता है, कभी आह नहीं भरता, कभी छोटा महसूस नहीं कराता। NCERT से कुछ भी पूछिए — और जवाब के बजाय वह आपको ख़ुद उत्तर तक पहुँचाने वाला सवाल देता है।',
    },
    lede2: {
      en: <>Ten-minute sessions, a streak that actually means learning, and a mastery map that shows you exactly which topic to revise tonight. No leaderboards. No noise. Just you and the book.</>,
      hi: <>दस-मिनट के सत्र, एक स्ट्रीक जिसका सच में मतलब है सीखना, और एक माहारत-नक़्शा जो ठीक-ठीक बताता है कि आज रात कौन-सा विषय दोहराना है।</>,
    },
    ctaLabel: { en: 'Try a free Foxy session', hi: 'फ़ॉक्सी का एक मुफ्त सत्र' },
    ctaHref: '/login',
  },
  teacher: {
    eyebrow: {
      en: 'For the teacher who wants Monday to mean something',
      hi: 'उस शिक्षक के लिए जो चाहता है कि सोमवार मायने रखे',
    },
    headlineEn: <>Walk in,<br /><em>already prepared.</em></>,
    headlineHi: <>कक्षा में,<br /><em>पहले से तैयार।</em></>,
    devaEn: 'सोमवार को, तैयार।',
    devaHi: 'सोमवार को, तैयार।',
    lede1: {
      en: "See, before the bell, which child read the chapter and which child only opened it. Bloom's-level dashboards by section. The whole class, mapped to the syllabus, refreshed every Sunday night.",
      hi: 'घंटी बजने से पहले देखिये कि किस बच्चे ने पाठ पढ़ा और किसने सिर्फ़ खोला। हर सेक्शन का ब्लूम-स्तर डैशबोर्ड। पूरी कक्षा का नक़्शा, हर रविवार रात अपडेट।',
    },
    lede2: {
      en: <>Set worksheets in 90 seconds, share via WhatsApp, get back per-question diagnostics. NEP-aligned reporting your principal will actually read.</>,
      hi: <>नब्बे सेकंड में वर्कशीट बनाइये, WhatsApp पर भेजिए, हर प्रश्न का परिणाम वापस पाइए। NEP-संरेखित रिपोर्ट जो प्रधानाचार्य भी पढ़ें।</>,
    },
    ctaLabel: { en: 'See the teacher portal', hi: 'शिक्षक पोर्टल देखें' },
    ctaHref: '/login?role=teacher',
  },
  school: {
    eyebrow: {
      en: 'For principals tired of decks and demos',
      hi: 'उन प्रधानाचार्यों के लिए जो डेक और डेमो से थक चुके हैं',
    },
    headlineEn: <>Every section,<br /><em>visible.</em></>,
    headlineHi: <>हर अनुभाग,<br /><em>स्पष्ट।</em></>,
    devaEn: 'हर अनुभाग, स्पष्ट।',
    devaHi: 'हर अनुभाग, स्पष्ट।',
    lede1: {
      en: "Bulk seats from 30 to 3,000. Teacher dashboards by section, principal view across the school, NEP-aligned reporting that maps to the board's rubric.",
      hi: 'तीस से तीन हज़ार सीटें। हर सेक्शन का शिक्षक डैशबोर्ड, पूरे विद्यालय का प्रधानाचार्य व्यू, NEP-संरेखित रिपोर्ट।',
    },
    lede2: {
      en: <>Onboarding and training included. Bilingual support. India-hosted data, DPDPA-compliant, with a real human at the other end of the WhatsApp.</>,
      hi: <>शुरुआती सहायता और प्रशिक्षण शामिल। द्विभाषी सहायता। डेटा भारत में, DPDPA-संरेखित, और WhatsApp के दूसरी ओर एक असली इंसान।</>,
    },
    ctaLabel: { en: 'Book a school demo', hi: 'विद्यालय डेमो बुक करें' },
    ctaHref: '/for-schools',
  },
};

export default function HeroV2() {
  const { isHi, role, t } = useWelcomeV2();
  const copy = ROLE_COPY[role];
  const headline = isHi ? copy.headlineHi : copy.headlineEn;
  const devaText = isHi ? copy.devaHi : copy.devaEn;
  const lede1 = isHi ? copy.lede1.hi : copy.lede1.en;
  const lede2 = isHi ? copy.lede2.hi : copy.lede2.en;

  return (
    <section className={s.hero} aria-labelledby="welcome-v2-hero-title">
      <div className={s.heroNumeral} lang="hi" aria-hidden="true">६</div>
      <div className={s.wrap}>
        <div className={s.heroGrid}>
          <div>
            <div className={s.heroEyebrow}>
              <span className="dot" aria-hidden="true"></span>
              <span>{t(copy.eyebrow.en, copy.eyebrow.hi)}</span>
            </div>

            <h1 id="welcome-v2-hero-title" className={s.heroH}>
              <span>{headline}</span>
              <span className="devaLine" lang="hi">
                {devaText.split(',').map((seg, i, arr) =>
                  i === arr.length - 1 ? (
                    <em key={i}>{seg.trim()}</em>
                  ) : (
                    <span key={i}>{seg.trim()}, </span>
                  ),
                )}
              </span>
            </h1>

            <div className={s.heroLede}>
              <p>{lede1}</p>
              <p>{lede2}</p>
            </div>

            <div className={s.heroCtaRow}>
              <Link
                href={copy.ctaHref}
                className={`${s.btn} ${s.btnPrimary} ${s.btnArrow}`}
              >
                {t(copy.ctaLabel.en, copy.ctaLabel.hi)}
              </Link>
              <Link href="#how" className={`${s.btn} ${s.btnGhost}`}>
                {t('How it works', 'कैसे काम करता है')}
              </Link>
            </div>

            <div className={s.heroFineprint}>
              {t('No card. No spam. Cancel anytime.', 'न कार्ड, न स्पैम, कभी भी रद्द करें।')}{' '}
              <span className="pencil">
                {t(
                  '— a real fox, not a chatbot pretending to be friendly.',
                  '— एक असली लोमड़ी, कोई दिखावटी चैटबॉट नहीं।',
                )}
              </span>
            </div>
          </div>

          <div className={s.phoneFigureWrap}>
            <figure className={s.phoneFigure}>
              <span className={s.captionPill}>
                {t('Live · Class 8 · Biology', 'लाइव · कक्षा 8 · जीव विज्ञान')}
              </span>
              <div className={s.phone}>
                <div className={s.phoneScreen}>
                  <div className="psTop">
                    <span>9:41</span>
                    <span>Mon · CBSE 8</span>
                  </div>
                  <div className="psGreet">
                    {t('Good evening,', 'शुभ संध्या,')}{' '}
                    <em>Ananya</em>.<br />
                    {t('Ready for ten minutes?', 'दस मिनट के लिए तैयार?')}
                  </div>
                  <div className="psCard">
                    <div className="psMono">
                      {t("Tonight's plan · Biology", 'आज की योजना · जीव विज्ञान')}
                    </div>
                    <strong>
                      {t('Photosynthesis — light reaction', 'प्रकाश-संश्लेषण — प्रकाश अभिक्रिया')}
                    </strong>
                    <div>
                      {t(
                        "You stalled here yesterday. Let's revisit the chloroplast diagram first.",
                        'कल आप यहीं रुक गए थे। पहले क्लोरोप्लास्ट का चित्र फिर देखते हैं।',
                      )}
                    </div>
                    <div className="bar"><div className="barFill" /></div>
                  </div>
                  <div className="psCard">
                    <div className="psMono">{t('Mastery · last 7 days', 'महारत · पिछले 7 दिन')}</div>
                    <strong className="psStrongLg">72%</strong>
                    <div className="psMetaLine">
                      {t('+8 from last week · ', 'पिछले सप्ताह से +8 · ')}Bloom's: Apply
                    </div>
                  </div>
                  <div className="psFoxy">
                    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
                      <path d="M6 8 L10 4 L12 10 Z" fill="var(--saffron)" />
                      <path d="M26 8 L22 4 L20 10 Z" fill="var(--saffron)" />
                      <path d="M8 6 L11 4.5 L11.5 7.5 Z" fill="var(--ink)" />
                      <path d="M24 6 L21 4.5 L20.5 7.5 Z" fill="var(--ink)" />
                      <ellipse cx="16" cy="18" rx="11" ry="9" fill="var(--saffron)" />
                      <ellipse cx="16" cy="22" rx="6" ry="5" fill="var(--cream)" />
                      <circle cx="12" cy="17" r="1.6" fill="var(--ink)" />
                      <circle cx="20" cy="17" r="1.6" fill="var(--ink)" />
                      <circle cx="11.5" cy="16.5" r=".5" fill="currentColor" />
                      <circle cx="19.5" cy="16.5" r=".5" fill="currentColor" />
                      <ellipse cx="16" cy="20.5" rx="1.2" ry=".8" fill="var(--ink)" />
                    </svg>
                    <span>
                      Foxy: <em>{t('"shall we draw it together?"', '"क्या हम इसे साथ बनाएँ?"')}</em>
                    </span>
                  </div>
                </div>
              </div>
            </figure>
            <p className={s.pencilNote}>
              {t(
                'a parent told us last week: "she now opens this before TikTok." we are still recovering.',
                'पिछले सप्ताह एक अभिभावक ने कहा: "वह अब TikTok से पहले यह खोलती है।" हम अब भी सम्हल रहे हैं।',
              )}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
