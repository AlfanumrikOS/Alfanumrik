'use client';

import Link from 'next/link';
import { useWelcomeV2 } from '@alfanumrik/ui/landing/WelcomeV2Context';
import MarketingShell from '@alfanumrik/ui/landing/v3/marketing/MarketingShell';
import PageHeroV3 from '@alfanumrik/ui/landing/v3/marketing/PageHeroV3';
import FeatureGridV3, {
  type FeatureGridItem,
} from '@alfanumrik/ui/landing/v3/marketing/FeatureGridV3';
import StepStripV3 from '@alfanumrik/ui/landing/v3/marketing/StepStripV3';
import QuoteBandV3 from '@alfanumrik/ui/landing/v3/marketing/QuoteBandV3';
import CtaBandV3 from '@alfanumrik/ui/landing/v3/marketing/CtaBandV3';
import {
  IconBell,
  IconChart,
  IconCircleSlash,
  IconClock,
  IconFileText,
  IconLayers,
  IconLock,
  IconShieldCheck,
  IconTarget,
} from '@alfanumrik/ui/landing/v3/marketing/MarketingIcons';
import s from '@alfanumrik/ui/landing/v3/welcome-v3.module.css';

// SEO metadata is in layout.tsx (Server Component) for SSR indexing.
// Landing-v3 makeover 2026-07-16: body rebuilt on the shared V3 system
// (MarketingShell + PageHeroV3 + FeatureGridV3 + QuoteBandV3 + CtaBandV3).
// Breadcrumb trail Home → Solutions (no URL) → For Parents preserved
// verbatim — pinned by e2e/landing-seo.spec.ts.

/* ─── Data (bilingual copy lifted from the pre-V3 page; emoji tiles
       replaced with lucide-style stroke icons per the V3 contract) ─── */

const WHAT_YOU_GET: FeatureGridItem[] = [
  {
    icon: <IconChart />,
    titleEn: 'Weekly Progress Reports',
    titleHi: 'साप्ताहिक प्रगति रिपोर्ट',
    bodyEn:
      'Receive clear, visual reports every week showing what your child studied, how they performed, and where they improved.',
    bodyHi:
      'हर हफ़्ते स्पष्ट, विज़ुअल रिपोर्ट प्राप्त करें जो दिखाती हैं कि आपके बच्चे ने क्या पढ़ा, कैसा प्रदर्शन किया, और कहाँ सुधार हुआ।',
  },
  {
    icon: <IconLayers />,
    titleEn: 'Subject-Wise Mastery Tracking',
    titleHi: 'विषयवार दक्षता ट्रैकिंग',
    bodyEn:
      'See exactly how strong your child is in each subject and topic — from remembering facts to applying concepts.',
    bodyHi:
      'देखें कि आपका बच्चा हर विषय और टॉपिक में कितना मज़बूत है — तथ्य याद रखने से लेकर अवधारणाएँ लागू करने तक।',
  },
  {
    icon: <IconClock />,
    titleEn: 'Study Time Monitoring',
    titleHi: 'पढ़ाई के समय की निगरानी',
    bodyEn:
      'Track how much time your child spends learning each day and week. No guesswork, just real data.',
    bodyHi:
      'ट्रैक करें कि आपका बच्चा हर दिन और हफ़्ते कितना समय पढ़ाई में बिताता है। अनुमान नहीं, असली डेटा।',
  },
  {
    icon: <IconTarget />,
    titleEn: 'Exam Readiness Scores',
    titleHi: 'परीक्षा तैयारी स्कोर',
    bodyEn:
      'Know whether your child is on track for board exams with readiness scores across all subjects.',
    bodyHi:
      'जानें कि आपका बच्चा बोर्ड परीक्षा के लिए तैयार है या नहीं, सभी विषयों में तैयारी स्कोर के साथ।',
  },
  {
    icon: <IconBell />,
    titleEn: 'Alert When Streaks Are at Risk',
    titleHi: 'स्ट्रीक खतरे में होने पर अलर्ट',
    bodyEn:
      "Get notified when your child's learning streak is about to break, so you can encourage them to stay consistent.",
    bodyHi:
      'जब आपके बच्चे की लर्निंग स्ट्रीक टूटने वाली हो तो सूचना पाएँ, ताकि आप उन्हें नियमित रहने के लिए प्रोत्साहित कर सकें।',
  },
];

const CONNECT_STEPS = [
  {
    titleEn: 'Get Link Code',
    titleHi: 'लिंक कोड प्राप्त करें',
    bodyEn: 'Your child generates a unique link code from their Alfanumrik profile.',
    bodyHi: 'आपका बच्चा अपनी Alfanumrik प्रोफ़ाइल से एक यूनीक लिंक कोड बनाता है।',
  },
  {
    titleEn: 'Enter in Parent Portal',
    titleHi: 'पैरेंट पोर्टल में दर्ज करें',
    bodyEn:
      "Sign up as a parent and enter the link code to connect to your child's account.",
    bodyHi:
      'पैरेंट के रूप में साइन अप करें और अपने बच्चे के अकाउंट से जुड़ने के लिए लिंक कोड दर्ज करें।',
  },
  {
    titleEn: 'See Live Progress',
    titleHi: 'लाइव प्रगति देखें',
    bodyEn:
      "Instantly access your child's learning dashboard with real-time data and weekly reports.",
    bodyHi:
      'रियल-टाइम डेटा और साप्ताहिक रिपोर्ट के साथ अपने बच्चे का लर्निंग डैशबोर्ड तुरंत देखें।',
  },
];

const SAFETY: FeatureGridItem[] = [
  {
    icon: <IconCircleSlash />,
    titleEn: 'No Ads',
    titleHi: 'कोई विज्ञापन नहीं',
    bodyEn:
      'Alfanumrik is completely ad-free. Your child learns without distractions or manipulative marketing.',
    bodyHi: 'Alfanumrik पूरी तरह विज्ञापन-मुक्त है। आपका बच्चा बिना किसी भटकाव के सीखता है।',
  },
  {
    icon: <IconLock />,
    titleEn: 'No Data Selling',
    titleHi: 'डेटा बेचना नहीं',
    bodyEn: 'We never sell student or parent data to anyone. Period. Your data stays yours.',
    bodyHi: 'हम कभी भी छात्र या अभिभावक का डेटा किसी को नहीं बेचते। आपका डेटा आपका है।',
  },
  {
    icon: <IconFileText />,
    titleEn: 'DPDPA Compliant',
    titleHi: 'DPDPA अनुपालन',
    bodyEn:
      "We comply with India's Digital Personal Data Protection Act. Privacy is built into our platform from day one.",
    bodyHi:
      'हम भारत के Digital Personal Data Protection Act का पालन करते हैं। प्राइवेसी हमारे प्लेटफ़ॉर्म में पहले दिन से शामिल है।',
  },
  {
    icon: <IconShieldCheck />,
    titleEn: 'Parental Consent for Under-13',
    titleHi: '13 वर्ष से कम के लिए अभिभावक सहमति',
    bodyEn:
      'Students under 13 require verified parental consent before their account is activated.',
    bodyHi:
      '13 वर्ष से कम उम्र के छात्रों को अकाउंट एक्टिवेट करने से पहले सत्यापित अभिभावक सहमति की आवश्यकता होती है।',
  },
];

/* ─── Sunday-letter proof mention (links to the sample letter on /welcome) ─── */

function SundayProofNote() {
  const { t } = useWelcomeV2();
  return (
    <section aria-labelledby="parents-proof-title">
      <h2 id="parents-proof-title" className={s.srOnly}>
        {t('The Sunday letter', 'रविवार का पत्र')}
      </h2>
      <div className={s.wrap}>
        <p className={s.pricingNote}>
          {t(
            'Every Sunday, Foxy writes you a short letter — what moved, what slipped, and the one thing to revise next.',
            'हर रविवार फ़ॉक्सी आपको एक छोटा पत्र लिखता है — क्या आगे बढ़ा, क्या छूटा, और अगला एक काम।',
          )}{' '}
          <Link href="/welcome#results">{t('See a sample letter', 'नमूना पत्र देखें')}</Link>
        </p>
      </div>
    </section>
  );
}

/* ─── Page ─── */

export default function ForParentsPage() {
  return (
    <MarketingShell
      testId="for-parents-root"
      breadcrumbs={[
        { label: 'Home', href: '/welcome' },
        { label: 'Solutions' },
        { label: 'For Parents' },
      ]}
    >
      <PageHeroV3
        headingId="for-parents-hero-title"
        location="for_parents_hero"
        eyebrowEn="For parents"
        eyebrowHi="अभिभावकों के लिए"
        titleEn="See your child's week, every Sunday."
        titleHi="हर रविवार, अपने बच्चे का पूरा सप्ताह देखें।"
        ledeEn="Alfanumrik keeps you informed with real-time progress data, weekly reports, and exam readiness scores — so you always know where your child stands."
        ledeHi="Alfanumrik आपको रियल-टाइम प्रगति डेटा, साप्ताहिक रिपोर्ट, और परीक्षा तैयारी स्कोर के साथ अपडेट रखता है — ताकि आप हमेशा जानें कि आपका बच्चा कहाँ है।"
        ctas={[
          { href: '/login?role=parent', en: 'Join as Parent', hi: 'अभिभावक के रूप में जुड़ें' },
        ]}
      />

      <FeatureGridV3
        headingId="for-parents-features-title"
        eyebrowEn="What you get"
        eyebrowHi="आपको क्या मिलता है"
        titleEn="What You Get"
        titleHi="आपको क्या मिलता है"
        items={WHAT_YOU_GET}
      />

      <StepStripV3
        headingId="for-parents-connect-title"
        eyebrowEn="Two minutes"
        eyebrowHi="दो मिनट"
        titleEn="How to Connect"
        titleHi="कैसे जुड़ें"
        steps={CONNECT_STEPS}
      />

      <SundayProofNote />

      <FeatureGridV3
        headingId="for-parents-safety-title"
        columns={2}
        eyebrowEn="Built for trust"
        eyebrowHi="भरोसे के लिए बना"
        titleEn="Safety & Privacy"
        titleHi="सुरक्षा और गोपनीयता"
        items={SAFETY}
      />

      <QuoteBandV3
        headingId="for-parents-quote-title"
        quoteEn="“For the first time I don’t have to ask ‘did you study?’. The Sunday letter tells me exactly what moved and what needs work — in numbers, not reassurances. It’s measured, not promised.”"
        quoteHi="“पहली बार मुझे ‘पढ़ाई की?’ पूछना नहीं पड़ता। रविवार का पत्र ठीक-ठीक बताता है कि क्या आगे बढ़ा और कहाँ मेहनत चाहिए — संख्याओं में, दिलासों में नहीं। यह मापा हुआ है, वादा नहीं।”"
        name="Rekha Sharma"
        roleEn="Parent of a Class 8 student · Jaipur"
        roleHi="कक्षा 8 विद्यार्थी की अभिभावक · जयपुर"
        initials="RS"
      />

      <CtaBandV3
        headingId="for-parents-cta-title"
        location="for_parents_cta_band"
        titleEn="Start free tonight."
        titleHi="आज रात ही मुफ़्त शुरू करें।"
        bodyEn="Join thousands of parents who use Alfanumrik to support their children's education."
        bodyHi="हज़ारों अभिभावकों से जुड़ें जो अपने बच्चों की शिक्षा के लिए Alfanumrik का उपयोग करते हैं।"
        primary={{ href: '/login', en: 'Start free tonight', hi: 'आज रात ही मुफ़्त शुरू करें' }}
      />
    </MarketingShell>
  );
}
