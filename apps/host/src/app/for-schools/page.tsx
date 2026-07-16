'use client';

import MarketingShell from '@alfanumrik/ui/landing/v3/marketing/MarketingShell';
import PageHeroV3 from '@alfanumrik/ui/landing/v3/marketing/PageHeroV3';
import FeatureGridV3, {
  type FeatureGridItem,
} from '@alfanumrik/ui/landing/v3/marketing/FeatureGridV3';
import StepStripV3 from '@alfanumrik/ui/landing/v3/marketing/StepStripV3';
import CtaBandV3 from '@alfanumrik/ui/landing/v3/marketing/CtaBandV3';
import SchoolsBandV3 from '@alfanumrik/ui/landing/v3/SchoolsBandV3';
import {
  IconChart,
  IconClipboardCheck,
  IconClock,
  IconLayers,
  IconMessageCircle,
  IconTarget,
  IconTrendingUp,
  IconUsers,
} from '@alfanumrik/ui/landing/v3/marketing/MarketingIcons';

// SEO metadata is in layout.tsx (Server Component) for SSR indexing.
// Landing-v3 makeover 2026-07-16: body rebuilt on the shared V3 system.
// SchoolsBandV3 is reused as-is — its "from ₹99" anchor renders
// SCHOOL_PER_SEAT_MARKETING_LABEL from the pricing SoT (REG-65 family /
// REG-154: never a hardcoded rupee literal). Breadcrumb trail Home →
// Solutions (no URL) → For Schools preserved verbatim.

/* ─── Data (bilingual copy lifted from the pre-V3 page; emoji tiles
       replaced with lucide-style stroke icons per the V3 contract) ─── */

const BENEFITS: FeatureGridItem[] = [
  {
    icon: <IconTrendingUp />,
    titleEn: 'Better Learning Outcomes',
    titleHi: 'बेहतर सीखने के परिणाम',
    bodyEn:
      "AI adapts to each student's level, ensuring every learner progresses at their optimal pace.",
    bodyHi:
      'AI हर छात्र के स्तर के अनुसार ढलता है, जिससे हर विद्यार्थी अपनी सर्वोत्तम गति से आगे बढ़ता है।',
  },
  {
    icon: <IconChart />,
    titleEn: 'Real-Time Student Analytics',
    titleHi: 'रियल-टाइम छात्र एनालिटिक्स',
    bodyEn:
      'Track mastery, engagement, and performance across every class and section from one dashboard.',
    bodyHi: 'एक ही डैशबोर्ड से हर कक्षा और सेक्शन में दक्षता, जुड़ाव और प्रदर्शन ट्रैक करें।',
  },
  {
    icon: <IconClock />,
    titleEn: 'Reduced Teacher Workload',
    titleHi: 'शिक्षकों का कम कार्यभार',
    bodyEn:
      'Automated grading, report generation, and assignment creation save teachers hours every week.',
    bodyHi:
      'ऑटोमेटेड ग्रेडिंग, रिपोर्ट बनाना और असाइनमेंट बनाना शिक्षकों के हर हफ़्ते घंटों बचाता है।',
  },
  {
    icon: <IconTarget />,
    titleEn: 'Board Exam Readiness Tracking',
    titleHi: 'बोर्ड परीक्षा तैयारी ट्रैकिंग',
    bodyEn:
      'Track student preparedness for CBSE board examinations with subject-wise mastery data and gap analysis.',
    bodyHi:
      'विषयवार दक्षता डेटा और गैप एनालिसिस के साथ CBSE बोर्ड परीक्षा के लिए छात्रों की तैयारी ट्रैक करें।',
  },
];

const STEPS = [
  {
    titleEn: 'Onboard Your School',
    titleHi: 'अपने स्कूल को जोड़ें',
    bodyEn: 'We set up your institution with classes, teachers, and subjects in under a day.',
    bodyHi:
      'हम एक दिन से भी कम समय में आपके संस्थान को कक्षाओं, शिक्षकों और विषयों के साथ सेट अप करते हैं।',
  },
  {
    titleEn: 'Teachers Create Classes',
    titleHi: 'शिक्षक कक्षाएँ बनाएँ',
    bodyEn: 'Teachers add students, assign subjects, and configure their virtual classrooms.',
    bodyHi:
      'शिक्षक छात्रों को जोड़ते हैं, विषय असाइन करते हैं, और अपनी वर्चुअल कक्षाएँ कॉन्फ़िगर करते हैं।',
  },
  {
    titleEn: 'Students Learn Adaptively',
    titleHi: 'छात्र अनुकूली तरीके से सीखें',
    bodyEn:
      'Every student gets a personalized AI tutor that adapts to their learning pace and style.',
    bodyHi:
      'हर छात्र को एक व्यक्तिगत AI ट्यूटर मिलता है जो उनकी सीखने की गति और शैली के अनुसार ढलता है।',
  },
  {
    titleEn: 'Track Progress Institution-Wide',
    titleHi: 'पूरे संस्थान की प्रगति ट्रैक करें',
    bodyEn:
      'Admins see school-wide analytics, class comparisons, and individual student drill-downs.',
    bodyHi:
      'एडमिन स्कूल-व्यापी एनालिटिक्स, कक्षा तुलना, और व्यक्तिगत छात्र विवरण देखते हैं।',
  },
];

const INCLUDED: FeatureGridItem[] = [
  {
    icon: <IconMessageCircle />,
    titleEn: 'Foxy for Every Student',
    titleHi: 'हर छात्र के लिए Foxy',
    bodyEn: 'Foxy teaches 16 subjects in Hindi and English with step-by-step explanations.',
    bodyHi: 'Foxy 16 विषय हिंदी और अंग्रेज़ी में स्टेप-बाय-स्टेप समझाता है।',
  },
  {
    icon: <IconLayers />,
    titleEn: 'Teacher Dashboards',
    titleHi: 'शिक्षक डैशबोर्ड',
    bodyEn: 'Class management, assignment creation, mastery tracking, and automated reports.',
    bodyHi: 'कक्षा प्रबंधन, असाइनमेंट बनाना, दक्षता ट्रैकिंग, और ऑटोमेटेड रिपोर्ट।',
  },
  {
    icon: <IconUsers />,
    titleEn: 'Parent Portal',
    titleHi: 'पैरेंट पोर्टल',
    bodyEn:
      "Weekly progress reports keep parents informed and engaged in their child's learning.",
    bodyHi: 'साप्ताहिक प्रगति रिपोर्ट अभिभावकों को उनके बच्चे की पढ़ाई से जोड़े रखती है।',
  },
  {
    icon: <IconClipboardCheck />,
    titleEn: 'Analytics & Reporting',
    titleHi: 'एनालिटिक्स और रिपोर्टिंग',
    bodyEn: 'Institution-level analytics, board readiness scores, and exportable reports.',
    bodyHi: 'संस्थान-स्तरीय एनालिटिक्स, बोर्ड तैयारी स्कोर, और एक्सपोर्ट करने योग्य रिपोर्ट।',
  },
];

/* ─── Page ─── */

export default function ForSchoolsPage() {
  return (
    <MarketingShell
      testId="for-schools-root"
      breadcrumbs={[
        { label: 'Home', href: '/welcome' },
        { label: 'Solutions' },
        { label: 'For Schools' },
      ]}
    >
      <PageHeroV3
        headingId="for-schools-hero-title"
        location="for_schools_hero"
        eyebrowEn="For schools"
        eyebrowHi="स्कूलों के लिए"
        titleEn="Transform your school with AI-powered learning."
        titleHi="अपने स्कूल को AI-संचालित शिक्षा से बदलें।"
        ledeEn="Give every student a personal AI tutor. Give every teacher real-time analytics. Give your school a competitive edge in board exam outcomes."
        ledeHi="हर छात्र को एक व्यक्तिगत AI ट्यूटर दें। हर शिक्षक को रियल-टाइम एनालिटिक्स दें। अपने स्कूल को बोर्ड परीक्षा परिणामों में प्रतिस्पर्धात्मक बढ़त दें।"
        ctas={[
          { href: '/demo', en: 'Book a Demo', hi: 'डेमो बुक करें' },
          { href: '/contact', en: 'Contact Sales', hi: 'सेल्स से संपर्क करें', variant: 'ghost' },
        ]}
      />

      <FeatureGridV3
        headingId="for-schools-benefits-title"
        columns={2}
        eyebrowEn="Why Alfanumrik"
        eyebrowHi="Alfanumrik क्यों"
        titleEn="Why Schools Choose Alfanumrik"
        titleHi="स्कूल Alfanumrik क्यों चुनते हैं"
        items={BENEFITS}
      />

      {/* Ink band with the SoT-priced "from ₹99/student/mo" anchor +
          Contact sales / Book a school demo CTAs (reused verbatim from
          /pricing — SCHOOL_PER_SEAT_MARKETING_LABEL inside). */}
      <SchoolsBandV3 />

      <StepStripV3
        headingId="for-schools-steps-title"
        eyebrowEn="Rollout"
        eyebrowHi="रोलआउट"
        titleEn="How It Works"
        titleHi="यह कैसे काम करता है"
        steps={STEPS}
      />

      <FeatureGridV3
        headingId="for-schools-included-title"
        columns={2}
        eyebrowEn="In the box"
        eyebrowHi="पैकेज में"
        titleEn="What's Included"
        titleHi="क्या शामिल है"
        items={INCLUDED}
      />

      <CtaBandV3
        headingId="for-schools-cta-title"
        location="for_schools_cta_band"
        titleEn="Ready to Transform Your School?"
        titleHi="अपने स्कूल को बदलने के लिए तैयार हैं?"
        bodyEn="Join forward-thinking schools using AI to deliver better learning outcomes."
        bodyHi="AI का उपयोग करके बेहतर सीखने के परिणाम देने वाले प्रगतिशील स्कूलों से जुड़ें।"
        primary={{ href: '/demo', en: 'Book a school demo', hi: 'स्कूल डेमो बुक करें' }}
        secondary={{ href: '/contact', en: 'Contact Sales', hi: 'सेल्स से संपर्क करें' }}
        showFoxy={false}
      />
    </MarketingShell>
  );
}
