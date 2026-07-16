'use client';

import MarketingShell from '@alfanumrik/ui/landing/v3/marketing/MarketingShell';
import PageHeroV3 from '@alfanumrik/ui/landing/v3/marketing/PageHeroV3';
import FeatureGridV3, {
  type FeatureGridItem,
} from '@alfanumrik/ui/landing/v3/marketing/FeatureGridV3';
import CtaBandV3 from '@alfanumrik/ui/landing/v3/marketing/CtaBandV3';
import CrossLinkStripV3 from '@alfanumrik/ui/landing/v3/marketing/CrossLinkStripV3';
import {
  IconChart,
  IconClipboardCheck,
  IconFileText,
  IconMail,
  IconSearch,
  IconTarget,
  IconTrendingUp,
  IconUsers,
} from '@alfanumrik/ui/landing/v3/marketing/MarketingIcons';

// SEO metadata is in layout.tsx (Server Component) for SSR indexing.
// Landing-v3 makeover 2026-07-16: body rebuilt on the shared V3 system.
// Breadcrumb trail Home → Solutions (no URL) → For Teachers preserved
// verbatim (BreadcrumbList JSON-LD is an SEO surface).

/* ─── Data (bilingual copy lifted from the pre-V3 page; emoji tiles
       replaced with lucide-style stroke icons per the V3 contract) ─── */

const PAIN_POINTS: FeatureGridItem[] = [
  {
    icon: <IconClipboardCheck />,
    kicker: {
      wasEn: 'Grading takes hours',
      wasHi: 'ग्रेडिंग में घंटों लगते हैं',
    },
    titleEn: 'Automated assessment',
    titleHi: 'ऑटोमेटेड मूल्यांकन',
    bodyEn:
      'AI grades quizzes instantly and generates detailed performance reports for every student.',
    bodyHi: 'AI तुरंत क्विज़ की ग्रेडिंग करता है और हर छात्र के लिए विस्तृत प्रदर्शन रिपोर्ट बनाता है।',
  },
  {
    icon: <IconChart />,
    kicker: {
      wasEn: "Can't track every student",
      wasHi: 'हर छात्र को ट्रैक नहीं कर सकते',
    },
    titleEn: 'Real-time mastery data',
    titleHi: 'रियल-टाइम दक्षता डेटा',
    bodyEn:
      'See exactly where each student stands on every topic with live mastery dashboards.',
    bodyHi: 'लाइव दक्षता डैशबोर्ड से हर विषय पर हर छात्र की स्थिति देखें।',
  },
  {
    icon: <IconTarget />,
    kicker: {
      wasEn: 'Generic assignments',
      wasHi: 'सामान्य असाइनमेंट',
    },
    titleEn: 'Adaptive difficulty',
    titleHi: 'अनुकूली कठिनाई',
    bodyEn:
      "Assignments automatically adjust difficulty to each student's level — challenging but never frustrating.",
    bodyHi:
      'असाइनमेंट स्वचालित रूप से हर छात्र के स्तर के अनुसार कठिनाई समायोजित करते हैं — चुनौतीपूर्ण लेकिन कभी निराशाजनक नहीं।',
  },
  {
    icon: <IconMail />,
    kicker: {
      wasEn: 'No parent engagement',
      wasHi: 'अभिभावक की भागीदारी नहीं',
    },
    titleEn: 'Automated parent reports',
    titleHi: 'ऑटोमेटेड अभिभावक रिपोर्ट',
    bodyEn: 'Parents receive weekly progress updates without you lifting a finger.',
    bodyHi: 'अभिभावकों को बिना आपकी मेहनत के साप्ताहिक प्रगति अपडेट मिलते हैं।',
  },
];

const FEATURES: FeatureGridItem[] = [
  {
    icon: <IconUsers />,
    titleEn: 'Class Management',
    titleHi: 'कक्षा प्रबंधन',
    bodyEn:
      'Create classes, add students, and organize sections. Students join with a simple class code.',
    bodyHi:
      'कक्षाएँ बनाएँ, छात्रों को जोड़ें, और सेक्शन व्यवस्थित करें। छात्र एक साधारण क्लास कोड से जुड़ते हैं।',
  },
  {
    icon: <IconFileText />,
    titleEn: 'Worksheet Generator',
    titleHi: 'वर्कशीट जनरेटर',
    bodyEn:
      'Generate CBSE-aligned worksheets in seconds. Choose topics, difficulty, and question types.',
    bodyHi: 'सेकंडों में CBSE-अनुरूप वर्कशीट बनाएँ। विषय, कठिनाई और प्रश्न प्रकार चुनें।',
  },
  {
    icon: <IconTrendingUp />,
    titleEn: 'Student Analytics',
    titleHi: 'छात्र एनालिटिक्स',
    bodyEn:
      'Individual and class-wide analytics. Identify struggling students before they fall behind.',
    bodyHi:
      'व्यक्तिगत और कक्षा-व्यापी एनालिटिक्स। पिछड़ने से पहले संघर्ष कर रहे छात्रों की पहचान करें।',
  },
  {
    icon: <IconClipboardCheck />,
    titleEn: 'Assignment Creation',
    titleHi: 'असाइनमेंट बनाना',
    bodyEn:
      'Create practice sets, homework, and tests. Set due dates and track completion rates.',
    bodyHi: 'अभ्यास सेट, होमवर्क और टेस्ट बनाएँ। ड्यू डेट सेट करें और पूरा होने की दर ट्रैक करें।',
  },
  {
    icon: <IconSearch />,
    titleEn: 'Progress Tracking',
    titleHi: 'प्रगति ट्रैकिंग',
    bodyEn:
      'Monitor mastery progression, study time, quiz scores, and learning velocity for every student.',
    bodyHi:
      'हर छात्र की दक्षता प्रगति, पढ़ाई का समय, क्विज़ स्कोर, और सीखने की गति की निगरानी करें।',
  },
];

/* ─── Page ─── */

export default function ForTeachersPage() {
  return (
    <MarketingShell
      testId="for-teachers-root"
      breadcrumbs={[
        { label: 'Home', href: '/welcome' },
        { label: 'Solutions' },
        { label: 'For Teachers' },
      ]}
    >
      <PageHeroV3
        headingId="for-teachers-hero-title"
        location="for_teachers_hero"
        eyebrowEn="For teachers"
        eyebrowHi="शिक्षकों के लिए"
        titleEn="Monday morning, already briefed."
        titleHi="सोमवार सुबह — ब्रीफ़ पहले से तैयार।"
        ledeEn="Alfanumrik gives you AI-powered tools to automate grading, track every student's progress, and create adaptive assignments — so you can focus on what matters most: teaching."
        ledeHi="Alfanumrik आपको AI-संचालित टूल देता है जो ग्रेडिंग ऑटोमेट करते हैं, हर छात्र की प्रगति ट्रैक करते हैं, और अनुकूली असाइनमेंट बनाते हैं — ताकि आप सबसे ज़रूरी काम पर ध्यान दे सकें: पढ़ाना।"
        ctas={[
          { href: '/login?role=teacher', en: 'Start Free', hi: 'मुफ़्त शुरू करें' },
          { href: '/demo', en: 'Book a Demo', hi: 'डेमो बुक करें', variant: 'ghost' },
        ]}
      />

      <FeatureGridV3
        headingId="for-teachers-pain-title"
        columns={2}
        tint
        eyebrowEn="Before → after"
        eyebrowHi="पहले → बाद में"
        titleEn="Problems We Solve"
        titleHi="हम कौन सी समस्याएँ हल करते हैं"
        items={PAIN_POINTS}
      />

      <FeatureGridV3
        headingId="for-teachers-features-title"
        eyebrowEn="The toolkit"
        eyebrowHi="टूलकिट"
        titleEn="Everything You Need"
        titleHi="वह सब कुछ जो आपको चाहिए"
        items={FEATURES}
      />

      <CtaBandV3
        headingId="for-teachers-cta-title"
        location="for_teachers_cta_band"
        titleEn="Ready to Save Hours Every Week?"
        titleHi="हर हफ़्ते घंटों बचाने के लिए तैयार हैं?"
        bodyEn="Join thousands of teachers who use Alfanumrik to teach more effectively."
        bodyHi="हज़ारों शिक्षकों से जुड़ें जो Alfanumrik का उपयोग करके अधिक प्रभावी तरीके से पढ़ाते हैं।"
        primary={{ href: '/login?role=teacher', en: 'Start Free', hi: 'मुफ़्त शुरू करें' }}
        secondary={{ href: '/demo', en: 'Book a Demo', hi: 'डेमो बुक करें' }}
      />

      <CrossLinkStripV3
        headingId="for-teachers-cross-links-title"
        location="for_teachers_cross_links"
        links={[
          { href: '/for-parents', en: 'For parents', hi: 'अभिभावकों के लिए' },
          { href: '/for-schools', en: 'For schools', hi: 'विद्यालयों के लिए' },
          { href: '/pricing', en: 'Pricing', hi: 'मूल्य' },
        ]}
      />
    </MarketingShell>
  );
}
