'use client';

import { useWelcomeV2 } from '@alfanumrik/ui/landing/WelcomeV2Context';
import { useReveal } from '@alfanumrik/ui/landing/useReveal';
import MarketingShell from '@alfanumrik/ui/landing/v3/marketing/MarketingShell';
import PageHeroV3 from '@alfanumrik/ui/landing/v3/marketing/PageHeroV3';
import FeatureGridV3, {
  type FeatureGridItem,
} from '@alfanumrik/ui/landing/v3/marketing/FeatureGridV3';
import CtaBandV3 from '@alfanumrik/ui/landing/v3/marketing/CtaBandV3';
import {
  IconFlask,
  IconGraduationCap,
  IconLock,
  IconMapPin,
} from '@alfanumrik/ui/landing/v3/marketing/MarketingIcons';
import s from '@alfanumrik/ui/landing/v3/welcome-v3.module.css';
import m from '@alfanumrik/ui/landing/v3/marketing/marketing-v3.module.css';

/**
 * /about — landing-v3 makeover 2026-07-16. Client body (the server
 * page.tsx keeps the page-level SEO metadata export). Copy lifted from
 * the pre-V3 page; the page was previously English-only, so the Hindi
 * side of every string is NEW in this rebuild (P7).
 * Breadcrumb trail Home → About preserved verbatim (pinned by
 * e2e/landing-seo.spec.ts — 2 items, last crumb without URL).
 */

/* ─── Values (copy lifted; Hindi new) ─── */

const VALUES: FeatureGridItem[] = [
  {
    icon: <IconGraduationCap />,
    titleEn: 'Student-First',
    titleHi: 'छात्र-प्रथम',
    bodyEn:
      'Every product decision starts with one question: does this help the student learn better?',
    bodyHi:
      'हर प्रोडक्ट निर्णय एक ही प्रश्न से शुरू होता है: क्या इससे छात्र को बेहतर सीखने में मदद मिलती है?',
  },
  {
    icon: <IconLock />,
    titleEn: 'Privacy by Design',
    titleHi: 'डिज़ाइन से गोपनीयता',
    bodyEn:
      'Data minimization, encryption, and DPDPA compliance are built into our architecture from day one.',
    bodyHi:
      'डेटा न्यूनीकरण, एन्क्रिप्शन, और DPDPA अनुपालन पहले दिन से हमारे आर्किटेक्चर में शामिल हैं।',
  },
  {
    icon: <IconFlask />,
    titleEn: 'Research-Backed',
    titleHi: 'शोध-आधारित',
    bodyEn:
      "Our algorithms are grounded in learning science — Bayesian Knowledge Tracing, Bloom's Taxonomy, and spaced repetition.",
    bodyHi:
      "हमारे एल्गोरिदम लर्निंग साइंस पर आधारित हैं — Bayesian Knowledge Tracing, Bloom's Taxonomy, और स्पेस्ड रिपीटिशन।",
  },
  {
    icon: <IconMapPin />,
    titleEn: 'Made in India',
    titleHi: 'भारत में निर्मित',
    bodyEn:
      'Designed for Indian classrooms, Indian curricula, and Indian languages. Proudly built from India, for India.',
    bodyHi:
      'भारतीय कक्षाओं, भारतीय पाठ्यक्रमों और भारतीय भाषाओं के लिए बनाया गया। गर्व से भारत में, भारत के लिए।',
  },
];

/* ─── Story sections (vision + founder note) ─── */

function StorySections() {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(60);

  return (
    <div ref={revealRef as React.RefObject<HTMLDivElement>}>
      {/* Vision */}
      <section
        id="vision"
        className={`${s.section} ${m.tintCream}`}
        aria-labelledby="about-vision-title"
      >
        <div className={s.wrap}>
          <div className={`${s.sectionHead} ${s.revealUp}`} data-reveal>
            <span className={s.eyebrow}>{t('Our vision', 'हमारा विज़न')}</span>
            <h2 id="about-vision-title">
              {t(
                'An India where every child has a patient tutor',
                'एक ऐसा भारत जहाँ हर बच्चे के पास एक धैर्यवान शिक्षक हो',
              )}
            </h2>
            <p>
              {t(
                'In their language. At their pace. Without a single shouting leaderboard. The vision is small enough to fit on one card and large enough to reshape a generation of CBSE classrooms.',
                'उनकी भाषा में। उनकी गति से। बिना किसी शोर मचाते लीडरबोर्ड के। यह विज़न एक कार्ड पर समाने जितना छोटा है और CBSE कक्षाओं की एक पूरी पीढ़ी को नया आकार देने जितना बड़ा।',
              )}
            </p>
          </div>
          <div className={`${m.proseCard} ${s.revealUp}`} data-reveal>
            <p>
              {isHi ? (
                <>
                  भारत में 25 करोड़ स्कूल जाने वाले बच्चे हैं, हज़ारों बोर्ड और बोलियाँ हैं, और एक
                  साझा पीड़ा है: <strong>अच्छा पढ़ाना बड़े पैमाने पर नहीं पहुँच पाता</strong>। जो
                  शिक्षक एक बच्चे को क्लोरोप्लास्ट का चित्र धैर्य से समझाता है, वह चालीस बच्चों के
                  लिए ऐसा नहीं कर सकता। जिस अभिभावक को उत्तर आता है, उसके पास हमेशा समय नहीं
                  होता। ट्यूशन का शिक्षक कमी को पहचाने बिना अध्याय दोहराता है।
                </>
              ) : (
                <>
                  India has 250 million school-going children, ten thousand boards and dialects,
                  and one common ache: <strong>good teaching does not scale</strong>. The teacher
                  who explains the chloroplast diagram patiently to one child cannot do it for
                  forty. The parent who knows the answer does not always have the time. The
                  tuition-class teacher repeats the chapter without diagnosing the gap.
                </>
              )}
            </p>
            <p>
              {isHi ? (
                <>
                  Alfanumrik तीसरा शिक्षक है — छोटा, धैर्यवान, रात 8:40 बजे भी उपलब्ध, हिंदी और
                  अंग्रेज़ी दोनों में सहज, कभी न थकने वाला, आपके बच्चे के NCERT अध्याय से ठीक-ठीक
                  जुड़ा हुआ। स्कूल के शिक्षक या प्यार करने वाले अभिभावक का विकल्प नहीं — एक{' '}
                  <em>तीसरा</em> शिक्षक, जो हर भारतीय घर में मौजूद उस खाली जगह को भरता है।
                </>
              ) : (
                <>
                  Alfanumrik is the third teacher — small, patient, available at 8:40pm, fluent in
                  Hindi and English, never tired, never sighing, mapped exactly to your
                  child&apos;s NCERT chapter. Not a replacement for the school teacher or the
                  loving parent. A <em>third</em> teacher, who fills the gap that exists in every
                  Indian home.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* Founder note */}
      <section
        id="founder-note"
        className={s.section}
        aria-labelledby="about-founder-title"
      >
        <div className={s.wrap}>
          <div className={`${s.sectionHead} ${s.revealUp}`} data-reveal>
            <span className={s.eyebrow}>{t('Founder note', 'संस्थापक की ओर से')}</span>
            <h2 id="about-founder-title">{t('Why we built this', 'हमने यह क्यों बनाया')}</h2>
            <p>{t('A short letter from our founder.', 'हमारे संस्थापक का एक छोटा पत्र।')}</p>
          </div>
          <div className={`${m.proseCard} ${s.revealUp}`} data-reveal>
            <p>
              {isHi ? (
                <>
                  हमने Alfanumrik इसलिए बनाया क्योंकि हमारी अपनी बेटी के रिपोर्ट कार्ड पर बार-बार{' '}
                  <strong>&quot;औसत&quot;</strong> लिखा आता था — एक ऐसा शब्द जो सब कुछ छिपाता है
                  और कुछ नहीं समझाता। हम ठीक-ठीक जानना चाहते थे कि उसे क्या आता है और क्या नहीं।
                  हम ऐसे रविवार चाहते थे जब मैं उसके साथ बैठकर उस सप्ताह छूट गई तीन चीज़ें दोहरा
                  सकूँ। हम रात के खाने के बाद दस धैर्य भरे मिनट चाहते थे, सजी-धजी स्क्रीनों के दो
                  और घंटे नहीं।
                </>
              ) : (
                <>
                  We built Alfanumrik because our own daughter&apos;s report card kept saying{' '}
                  <strong>&quot;average&quot;</strong> — a word that hides everything and explains
                  nothing. We wanted to know exactly what she knew and exactly what she did not.
                  We wanted Sundays where I could sit with her and revisit the three things that
                  had slipped that week. We wanted ten patient minutes after dinner, not two more
                  hours of decorated screens.
                </>
              )}
            </p>
            <p>
              {t(
                'We could not find a product that did this for an Indian child. So we built one. Foxy is small, bilingual, NCERT-grounded, and genuinely tries to teach rather than entertain. The Sunday letter to parents is the artefact I wished someone had written for us.',
                'हमें कोई ऐसा प्रोडक्ट नहीं मिला जो एक भारतीय बच्चे के लिए यह करता हो। इसलिए हमने खुद बनाया। फ़ॉक्सी छोटा है, द्विभाषी है, NCERT से जुड़ा है, और मनोरंजन के बजाय सच में सिखाने की कोशिश करता है। अभिभावकों के लिए रविवार का पत्र वही चीज़ है जो काश किसी ने हमारे लिए लिखी होती।',
              )}
            </p>
            <p>
              {t(
                'If the product helps even one child walk into an exam knowing what they know, the company has earned its keep.',
                'अगर यह प्रोडक्ट एक भी बच्चे को यह जानते हुए परीक्षा में जाने में मदद करे कि उसे क्या आता है, तो कम्पनी ने अपनी कीमत अदा कर दी।',
              )}
            </p>
            <p className={m.proseSign}>
              — Pradeep Sharma
              <br />
              <small>{t('Founder · Alfanumrik · Bengaluru', 'संस्थापक · Alfanumrik · बेंगलुरु')}</small>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ─── Mission stats ─── */

function MissionSection() {
  const { t } = useWelcomeV2();
  const revealRef = useReveal(50);

  const stats = [
    { value: '16', labelEn: 'Subjects Covered', labelHi: 'विषय शामिल' },
    { value: '6-12', labelEn: 'Grades Supported', labelHi: 'कक्षाएँ समर्थित' },
    {
      value: t('Hindi + English', 'हिंदी + अंग्रेज़ी'),
      labelEn: 'Bilingual Tutoring',
      labelHi: 'द्विभाषी ट्यूटरिंग',
    },
    { value: 'CBSE', labelEn: 'Board Aligned', labelHi: 'बोर्ड-संरेखित' },
  ];

  return (
    <section
      className={`${s.section} ${m.tintCream}`}
      aria-labelledby="about-mission-title"
    >
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={`${s.sectionHead} ${s.revealUp}`} data-reveal>
          <span className={s.eyebrow}>{t('Our mission', 'हमारा मिशन')}</span>
          <h2 id="about-mission-title">
            {t('Democratize Quality Education', 'गुणवत्तापूर्ण शिक्षा सबके लिए')}
          </h2>
          <p>
            {t(
              'Every student in India deserves a personal tutor that understands how they learn, speaks their language, and adapts to their pace. AI makes this possible at scale.',
              'भारत के हर छात्र को एक ऐसा व्यक्तिगत शिक्षक मिलना चाहिए जो समझे कि वे कैसे सीखते हैं, उनकी भाषा बोले, और उनकी गति के अनुसार ढले। AI इसे बड़े पैमाने पर संभव बनाता है।',
            )}
          </p>
        </div>
        <div className={m.statGrid}>
          {stats.map((stat) => (
            <div key={stat.labelEn} className={`${m.statCard} ${s.revealUp}`} data-reveal>
              <div className={m.statValue}>{stat.value}</div>
              <div className={m.statLabel}>{t(stat.labelEn, stat.labelHi)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Company + trust badges ─── */

function CompanySection() {
  const { t } = useWelcomeV2();
  const revealRef = useReveal(50);

  const badges = [
    { en: 'DPDPA compliant', hi: 'DPDPA-अनुरूप' },
    { en: 'ISO 27001', hi: 'ISO 27001' },
    { en: 'Hosted in India', hi: 'भारत में होस्ट' },
    { en: 'Ad-free', hi: 'विज्ञापन-मुक्त' },
    { en: 'DPIIT Recognised', hi: 'DPIIT-मान्यता प्राप्त' },
  ];

  return (
    <section className={s.section} aria-labelledby="about-company-title">
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={`${s.sectionHead} ${s.revealUp}`} data-reveal>
          <span className={s.eyebrow}>{t('Company', 'कम्पनी')}</span>
          <h2 id="about-company-title">Cusiosense Learning India Pvt. Ltd.</h2>
          <p>
            {t(
              'Registered in India. Recognised by the Department for Promotion of Industry and Internal Trade (DPIIT).',
              'भारत में पंजीकृत। Department for Promotion of Industry and Internal Trade (DPIIT) द्वारा मान्यता प्राप्त।',
            )}
          </p>
        </div>
        <div className={`${m.badgeRow} ${s.revealUp}`} data-reveal>
          {badges.map((badge) => (
            <span key={badge.en} className={m.badge}>
              {t(badge.en, badge.hi)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Page body ─── */

export default function AboutContent() {
  return (
    <MarketingShell
      testId="about-root"
      breadcrumbs={[{ label: 'Home', href: '/welcome' }, { label: 'About' }]}
    >
      <PageHeroV3
        headingId="about-hero-title"
        location="about_hero"
        eyebrowEn="About us"
        eyebrowHi="हमारे बारे में"
        titleEn="Building India's Smartest Learning OS"
        titleHi="भारत का सबसे स्मार्ट लर्निंग OS बना रहे हैं"
        ledeEn={
          <>
            Alfanumrik is an adaptive learning platform built by{' '}
            <strong>Cusiosense Learning India Private Limited</strong> — a DPIIT recognised
            startup on a mission to democratize quality education across India through AI.
          </>
        }
        ledeHi={
          <>
            Alfanumrik एक अनुकूली लर्निंग प्लेटफ़ॉर्म है, जिसे{' '}
            <strong>Cusiosense Learning India Private Limited</strong> ने बनाया है — एक
            DPIIT-मान्यता प्राप्त स्टार्टअप, जिसका मिशन AI के ज़रिए पूरे भारत में गुणवत्तापूर्ण
            शिक्षा को सबके लिए सुलभ बनाना है।
          </>
        }
      />

      <StorySections />

      <MissionSection />

      <FeatureGridV3
        headingId="about-values-title"
        columns={2}
        eyebrowEn="Our values"
        eyebrowHi="हमारे मूल्य"
        titleEn="What We Stand For"
        titleHi="हम किन मूल्यों के लिए खड़े हैं"
        ledeEn="These principles guide every line of code we write and every feature we ship."
        ledeHi="ये सिद्धांत हमारे लिखे कोड की हर पंक्ति और हर फ़ीचर का मार्गदर्शन करते हैं।"
        items={VALUES}
      />

      <CompanySection />

      <CtaBandV3
        headingId="about-cta-title"
        location="about_cta_band"
        titleEn="Meet the third teacher."
        titleHi="तीसरे शिक्षक से मिलिए।"
        bodyEn="Start on the free plan in two minutes — Foxy is ready when your child is."
        bodyHi="दो मिनट में मुफ़्त प्लान पर शुरू करें — जब आपका बच्चा तैयार हो, फ़ॉक्सी तैयार है।"
        primary={{ href: '/login', en: 'Start free', hi: 'मुफ्त शुरू करें' }}
      />
    </MarketingShell>
  );
}
