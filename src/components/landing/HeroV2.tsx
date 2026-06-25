'use client';

import Link from 'next/link';
import { useWelcomeV2, type Role } from './WelcomeV2Context';
import { track } from '@/lib/posthog/client';
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
      en: 'The learning companion · for the family, the class, the phone',
      hi: 'सीखने का साथी · परिवार, कक्षा और फ़ोन के लिए',
    },
    headlineEn: <>Tonight&#39;s homework<br /><em>can be different.</em></>,
    headlineHi: <>आज का गृहकार्य<br /><em>अलग हो सकता है।</em></>,
    devaEn: 'आज का गृहकार्य, अलग।',
    devaHi: 'आज का गृहकार्य, अलग।',
    lede1: {
      en: "Foxy learns how your child thinks — not how a textbook says they should. It walks beside them through photosynthesis, quadratics, and Aryabhata's place-value system at the pace they can actually hold. NCERT-grounded. Bilingual. Patient.",
      hi: "फ़ॉक्सी सीखता है कि आपका बच्चा कैसे सोचता है — न कि पाठ्यपुस्तक कैसे कहती है। प्रकाश-संश्लेषण, द्विघात समीकरण और आर्यभट्ट की संख्या प्रणाली में उनके साथ चलता है, उनकी अपनी रफ़्तार पर।",
    },
    lede2: {
      en: (
        <>
          A Sunday letter arrives every week — no jargon, just the truth about what your child learned and where they slipped. No leaderboard.
          No noise. One small thing you can do about it tonight.
        </>
      ),
      hi: (
        <>
          हर रविवार एक पत्र — बिना जटिल शब्दों के, बस सच। बच्चे ने क्या सीखा, कहाँ चूके, और आज रात एक छोटा काम।
          कोई लीडरबोर्ड नहीं। कोई शोर नहीं।
        </>
      ),
    },
    ctaLabel: {
      en: 'Start free tonight',
      hi: 'आज रात मुफ्त शुरू करें',
    },
    ctaHref: '/login',
  },
  student: {
    eyebrow: {
      en: 'A patient tutor · in your pocket · never sighs',
      hi: 'धैर्यवान शिक्षक · जेब में · कभी नहीं झिड़कता',
    },
    headlineEn: <>The chapter<br /><em>finally clicks.</em></>,
    headlineHi: <>अध्याय<br /><em>आख़िरकार समझ आया।</em></>,
    devaEn: 'अध्याय, आख़िरकार।',
    devaHi: 'अध्याय, आख़िरकार।',
    lede1: {
      en: "Ask Foxy anything from your NCERT. Get back a question that helps you find the answer yourself — not a copied paragraph from a website. Foxy never sighs. Never makes you feel small. Never checks the time.",
      hi: "NCERT से कुछ भी पूछो। फ़ॉक्सी एक सवाल देता है जो तुम्हें ख़ुद जवाब तक पहुँचाता है। वेबसाइट से कॉपी किया पैराग्राफ़ नहीं। फ़ॉक्सी कभी झिड़कता नहीं।",
    },
    lede2: {
      en: <>Ten minutes a day. A mastery map that shows exactly which topic to revise tonight. A streak that means learning — not just the app opened.</>,
      hi: <>रोज़ दस मिनट। एक माहारत-नक़्शा जो बताता है कि आज रात कौन-सा टॉपिक दोहराना है। एक स्ट्रीक जिसका मतलब सीखना है।</>,
    },
    ctaLabel: { en: 'Ask Foxy now', hi: 'अभी फ़ॉक्सी से पूछें' },
    ctaHref: '/login',
  },
  teacher: {
    eyebrow: {
      en: 'For the teacher who wants Monday to mean something',
      hi: 'उस शिक्षक के लिए जो चाहता है कि सोमवार मायने रखे',
    },
    headlineEn: <>Monday morning,<br /><em>already briefed.</em></>,
    headlineHi: <>सोमवार सुबह,<br /><em>पहले से तैयार।</em></>,
    devaEn: 'सोमवार सुबह, तैयार।',
    devaHi: 'सोमवार सुबह, तैयार।',
    lede1: {
      en: "See, before the bell rings, which child read the chapter and which child only opened it. Bloom's-level dashboards by section. The whole class mapped to the syllabus — refreshed every Sunday night.",
      hi: 'घंटी बजने से पहले देखिये — किसने पाठ पढ़ा, किसने सिर्फ़ खोला। हर सेक्शन का ब्लूम-स्तर डैशबोर्ड। पूरी कक्षा का सिलेबस-मैप, हर रविवार रात अपडेट।',
    },
    lede2: {
      en: <>Worksheets in 90 seconds, shared via WhatsApp, diagnostics back per question. NEP-aligned reports your principal will actually read.</>,
      hi: <>नब्बे सेकंड में वर्कशीट, WhatsApp पर भेजिए, हर सवाल का परिणाम। NEP-संरेखित रिपोर्ट जो प्रधानाचार्य भी पढ़ें।</>,
    },
    ctaLabel: { en: 'See teacher portal', hi: 'शिक्षक पोर्टल देखें' },
    ctaHref: '/for-teachers',
  },
  school: {
    eyebrow: {
      en: 'For principals tired of dashboards that show nothing useful',
      hi: 'उन प्रधानाचार्यों के लिए जो बेकार डैशबोर्ड से थक चुके हैं',
    },
    headlineEn: <>Every classroom<br /><em>in one view.</em></>,
    headlineHi: <>हर कक्षा<br /><em>एक नज़र में।</em></>,
    devaEn: 'हर कक्षा, एक नज़र में।',
    devaHi: 'हर कक्षा, एक नज़र में।',
    lede1: {
      en: "30 to 3,000 seats. Teacher dashboards by section, principal view across the school, NEP-aligned reporting that maps to the board's rubric. Training and onboarding included.",
      hi: 'तीस से तीन हज़ार सीटें। सेक्शन-वार शिक्षक डैशबोर्ड, पूरे विद्यालय का प्रधानाचार्य व्यू, NEP-संरेखित रिपोर्ट। प्रशिक्षण शामिल।',
    },
    lede2: {
      en: <>Bilingual support. India-hosted, DPDPA-compliant, ISO 27001 certified. A real human at the other end of the WhatsApp — not a ticket queue.</>,
      hi: <>द्विभाषी सहायता। भारत में होस्ट, DPDPA-संरेखित, ISO 27001 प्रमाणित। WhatsApp पर एक असली इंसान।</>,
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
                id="hero-cta"
                href={copy.ctaHref}
                className={`${s.btn} ${s.btnPrimary} ${s.btnArrow}`}
                onClick={() =>
                  track('landing_cta_click', {
                    location: 'hero',
                    destination: copy.ctaHref,
                    active_role: role,
                    language: isHi ? 'hi' : 'en',
                  })
                }
              >
                {t(copy.ctaLabel.en, copy.ctaLabel.hi)}
              </Link>
              <Link href="#how" className={`${s.btn} ${s.btnGhost}`}>
                {t('How it works', 'कैसे काम करता है')}
              </Link>
              <div className={s.heroSocial}>
                <span className="avatarRow" aria-hidden="true">
                  {['A', 'R', 'P', 'M'].map(i => (
                    <span key={i} className="avatar">{i}</span>
                  ))}
                </span>
                <span>
                  {t('Joined by 12,000+ learners', '12,000+ विद्यार्थियों के साथ जुड़ें')}
                </span>
              </div>
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
                      {t('+8 from last week · ', 'पिछले सप्ताह से +8 · ')}Bloom&#39;s: Apply
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
