'use client';

import MarketingShell from '@alfanumrik/ui/landing/v3/marketing/MarketingShell';
import PageHeroV3 from '@alfanumrik/ui/landing/v3/marketing/PageHeroV3';
import FeatureGridV3, {
  type FeatureGridItem,
} from '@alfanumrik/ui/landing/v3/marketing/FeatureGridV3';
import CtaBandV3 from '@alfanumrik/ui/landing/v3/marketing/CtaBandV3';
import LadderStripV3 from '@alfanumrik/ui/landing/v3/LadderStripV3';
import OutcomeV3 from '@alfanumrik/ui/landing/v3/OutcomeV3';
import {
  IconBell,
  IconBuilding,
  IconChart,
  IconClipboardCheck,
  IconFileText,
  IconFlask,
  IconLayers,
  IconMessageCircle,
  IconRepeat,
  IconSearch,
  IconTarget,
  IconTrendingUp,
  IconTrophy,
  IconUsers,
} from '@alfanumrik/ui/landing/v3/marketing/MarketingIcons';

// SEO metadata is in layout.tsx (Server Component) for SSR indexing.
// Landing-v3 makeover 2026-07-16: body rebuilt on the shared V3 system.
// Feature walkthrough reuses LadderStripV3 (NCERT → Board → Competition,
// single purple on step 03) and OutcomeV3 (the Sunday-letter sample card).
// Emoji tiles from the legacy page are gone — V3 uses FoxyMascot (in the
// shell chrome) + lucide-style stroke icons only.

/* ─── Data (bilingual copy lifted from the pre-V3 page) ─── */

const FOR_STUDENTS: FeatureGridItem[] = [
  {
    icon: <IconMessageCircle />,
    titleEn: 'Foxy',
    titleHi: 'Foxy',
    bodyEn:
      'Chat with your personal tutor in Hindi or English. Get step-by-step explanations tailored to your level.',
    bodyHi:
      'हिंदी या अंग्रेज़ी में अपने व्यक्तिगत ट्यूटर से बात करें। अपने स्तर के अनुसार स्टेप-बाय-स्टेप समझ पाएँ।',
  },
  {
    icon: <IconTarget />,
    titleEn: 'Adaptive Quizzes',
    titleHi: 'अनुकूली क्विज़',
    bodyEn:
      'Questions adjust difficulty in real-time based on your mastery. Always in your zone of proximal development.',
    bodyHi:
      'प्रश्न आपकी दक्षता के आधार पर रियल-टाइम में कठिनाई समायोजित करते हैं। हमेशा आपके निकटतम विकास क्षेत्र में।',
  },
  {
    icon: <IconRepeat />,
    titleEn: 'Spaced Repetition',
    titleHi: 'स्पेस्ड रिपीटिशन',
    bodyEn:
      'SM-2 algorithm schedules reviews at the optimal time to move knowledge from short-term to long-term memory.',
    bodyHi:
      'SM-2 एल्गोरिदम ज्ञान को अल्पकालिक से दीर्घकालिक स्मृति में ले जाने के लिए सही समय पर रिव्यू शेड्यूल करता है।',
  },
  {
    icon: <IconFlask />,
    titleEn: 'Interactive Simulations',
    titleHi: 'इंटरैक्टिव सिमुलेशन',
    bodyEn:
      'Explore physics, chemistry, and math through hands-on virtual experiments and visualizations.',
    bodyHi:
      'भौतिकी, रसायन विज्ञान और गणित को वर्चुअल प्रयोगों और विज़ुअलाइज़ेशन के ज़रिए सीखें।',
  },
  {
    icon: <IconTrophy />,
    titleEn: 'Gamified Learning',
    titleHi: 'गेमिफाइड लर्निंग',
    bodyEn:
      'Earn XP, maintain streaks, climb leaderboards, and unlock achievements as you learn.',
    bodyHi:
      'सीखते हुए XP कमाएँ, स्ट्रीक बनाए रखें, लीडरबोर्ड पर चढ़ें, और उपलब्धियाँ अनलॉक करें।',
  },
];

const FOR_TEACHERS: FeatureGridItem[] = [
  {
    icon: <IconUsers />,
    titleEn: 'Class Management',
    titleHi: 'कक्षा प्रबंधन',
    bodyEn:
      'Create and manage multiple classes. Add students, set subjects, and organize your virtual classroom.',
    bodyHi:
      'कई कक्षाएँ बनाएँ और प्रबंधित करें। छात्रों को जोड़ें, विषय सेट करें, और अपनी वर्चुअल कक्षा व्यवस्थित करें।',
  },
  {
    icon: <IconClipboardCheck />,
    titleEn: 'Assignment Creation',
    titleHi: 'असाइनमेंट बनाना',
    bodyEn: 'Generate quizzes and worksheets aligned to CBSE curriculum with one click.',
    bodyHi: 'एक क्लिक से CBSE पाठ्यक्रम से जुड़े क्विज़ और वर्कशीट बनाएँ।',
  },
  {
    icon: <IconChart />,
    titleEn: 'Student Analytics',
    titleHi: 'छात्र एनालिटिक्स',
    bodyEn:
      'Track individual and class-wide mastery levels, identify gaps, and see learning patterns.',
    bodyHi:
      'व्यक्तिगत और कक्षा-व्यापी दक्षता स्तर ट्रैक करें, कमियाँ पहचानें, और सीखने के पैटर्न देखें।',
  },
  {
    icon: <IconFileText />,
    titleEn: 'Worksheet Generator',
    titleHi: 'वर्कशीट जनरेटर',
    bodyEn: "AI-generated worksheets based on topic, difficulty, and Bloom's taxonomy level.",
    bodyHi: "विषय, कठिनाई, और Bloom's टैक्सोनॉमी स्तर पर आधारित AI-जनित वर्कशीट।",
  },
  {
    icon: <IconTrendingUp />,
    titleEn: 'Progress Tracking',
    titleHi: 'प्रगति ट्रैकिंग',
    bodyEn:
      'Real-time dashboards showing quiz completion, mastery growth, and study time per student.',
    bodyHi:
      'रियल-टाइम डैशबोर्ड जो क्विज़ पूरा होना, दक्षता वृद्धि, और प्रति छात्र पढ़ाई का समय दिखाते हैं।',
  },
];

const FOR_PARENTS: FeatureGridItem[] = [
  {
    icon: <IconChart />,
    titleEn: 'Child Progress Reports',
    titleHi: 'बच्चे की प्रगति रिपोर्ट',
    bodyEn:
      "See detailed breakdowns of your child's learning — subjects, topics, mastery levels, and more.",
    bodyHi:
      'अपने बच्चे की पढ़ाई का विस्तृत विवरण देखें — विषय, टॉपिक, दक्षता स्तर, और बहुत कुछ।',
  },
  {
    icon: <IconFileText />,
    titleEn: 'Weekly Summaries',
    titleHi: 'साप्ताहिक सारांश',
    bodyEn:
      'Receive clear, easy-to-understand weekly summaries of study time, quiz performance, and growth.',
    bodyHi:
      'पढ़ाई के समय, क्विज़ प्रदर्शन, और विकास का स्पष्ट, आसान साप्ताहिक सारांश प्राप्त करें।',
  },
  {
    icon: <IconBell />,
    titleEn: 'Alert System',
    titleHi: 'अलर्ट सिस्टम',
    bodyEn:
      'Get notified when streaks are at risk, when milestones are reached, or when attention is needed.',
    bodyHi:
      'जब स्ट्रीक खतरे में हो, माइलस्टोन पूरा हो, या ध्यान देने की ज़रूरत हो तब सूचना पाएँ।',
  },
  {
    icon: <IconSearch />,
    titleEn: 'Exam Tracking',
    titleHi: 'परीक्षा ट्रैकिंग',
    bodyEn:
      'Monitor board exam readiness with subject-wise progress and recommended focus areas.',
    bodyHi:
      'विषयवार प्रगति और सुझाए गए फोकस क्षेत्रों के साथ बोर्ड परीक्षा की तैयारी की निगरानी करें।',
  },
];

const FOR_SCHOOLS: FeatureGridItem[] = [
  {
    icon: <IconBuilding />,
    titleEn: 'Institutional Dashboard',
    titleHi: 'संस्थागत डैशबोर्ड',
    bodyEn:
      'School-wide analytics covering all classes, teachers, and students in one unified view.',
    bodyHi:
      'एक एकीकृत दृश्य में सभी कक्षाओं, शिक्षकों और छात्रों को कवर करने वाले स्कूल-व्यापी एनालिटिक्स।',
  },
  {
    icon: <IconLayers />,
    titleEn: 'Multi-Class Management',
    titleHi: 'मल्टी-क्लास प्रबंधन',
    bodyEn:
      'Manage multiple sections, grades, and subjects across your entire school from a single admin panel.',
    bodyHi:
      'एक ही एडमिन पैनल से अपने पूरे स्कूल में कई सेक्शन, ग्रेड और विषयों का प्रबंधन करें।',
  },
  {
    icon: <IconTarget />,
    titleEn: 'Board Exam Readiness',
    titleHi: 'बोर्ड परीक्षा की तैयारी',
    bodyEn:
      'Track student preparedness for CBSE board examinations with subject-wise mastery data.',
    bodyHi: 'विषयवार दक्षता डेटा के साथ CBSE बोर्ड परीक्षा के लिए छात्रों की तैयारी ट्रैक करें।',
  },
];

/* ─── Page ─── */

export default function ProductPage() {
  return (
    <MarketingShell
      testId="product-root"
      breadcrumbs={[{ label: 'Home', href: '/welcome' }, { label: 'Product' }]}
    >
      <PageHeroV3
        headingId="product-hero-title"
        location="product_hero"
        eyebrowEn="Product"
        eyebrowHi="प्रोडक्ट"
        titleEn="The Complete School Intelligence OS"
        titleHi="संपूर्ण स्कूल इंटेलिजेंस OS"
        ledeEn="One platform that adapts to every stakeholder in the education ecosystem — students, teachers, parents, and school administrators."
        ledeHi="एक प्लेटफ़ॉर्म जो शिक्षा पारिस्थितिकी तंत्र के हर हितधारक के अनुसार ढलता है — छात्र, शिक्षक, अभिभावक, और स्कूल प्रशासक।"
        ctas={[{ href: '/demo', en: 'Book a Demo', hi: 'डेमो बुक करें' }]}
      />

      {/* NCERT Foundation → Board Mastery → Competition Scale (the page's
          single purple accent lives on step 03 inside this strip). */}
      <LadderStripV3 />

      <FeatureGridV3
        headingId="product-students-title"
        eyebrowEn="For students"
        eyebrowHi="छात्रों के लिए"
        titleEn="Your Personal AI Learning Companion"
        titleHi="आपका व्यक्तिगत AI लर्निंग साथी"
        ledeEn="Foxy adapts to your pace, speaks your language, and makes learning feel less like work."
        ledeHi="Foxy आपकी गति के अनुसार ढलता है, आपकी भाषा बोलता है, और पढ़ाई को आसान बनाता है।"
        items={FOR_STUDENTS}
      />

      <FeatureGridV3
        headingId="product-teachers-title"
        tint
        eyebrowEn="For teachers"
        eyebrowHi="शिक्षकों के लिए"
        titleEn="Manage, Track, and Support Every Student"
        titleHi="हर छात्र को प्रबंधित करें, ट्रैक करें, और सहायता दें"
        ledeEn="Save hours on administration. Focus on what matters — teaching."
        ledeHi="प्रशासन में घंटों बचाएँ। जो मायने रखता है उस पर ध्यान दें — पढ़ाना।"
        items={FOR_TEACHERS}
      />

      <FeatureGridV3
        headingId="product-parents-title"
        columns={2}
        eyebrowEn="For parents"
        eyebrowHi="अभिभावकों के लिए"
        titleEn="Stay Connected to Your Child's Learning"
        titleHi="अपने बच्चे की पढ़ाई से जुड़े रहें"
        ledeEn="Clear, actionable reports without needing to understand the technology."
        ledeHi="टेक्नोलॉजी समझने की ज़रूरत के बिना स्पष्ट, कार्रवाई योग्य रिपोर्ट।"
        items={FOR_PARENTS}
      />

      {/* The Sunday parent-letter sample card ("You'll know every Sunday.")
          reused from /welcome — the proof artefact for the parents section. */}
      <OutcomeV3 />

      <FeatureGridV3
        headingId="product-schools-title"
        tint
        eyebrowEn="For schools"
        eyebrowHi="स्कूलों के लिए"
        titleEn="Institutional Intelligence at Scale"
        titleHi="बड़े पैमाने पर संस्थागत इंटेलिजेंस"
        ledeEn="School-wide analytics, multi-class management, and board exam readiness tracking."
        ledeHi="स्कूल-व्यापी एनालिटिक्स, मल्टी-क्लास प्रबंधन, और बोर्ड परीक्षा तैयारी ट्रैकिंग।"
        items={FOR_SCHOOLS}
      />

      <CtaBandV3
        headingId="product-cta-title"
        location="product_cta_band"
        titleEn="Ready to Transform Learning?"
        titleHi="पढ़ाई को बदलने के लिए तैयार हैं?"
        bodyEn="See Alfanumrik in action. Schedule a personalized demo for your school or institution."
        bodyHi="Alfanumrik को काम करते देखें। अपने स्कूल या संस्थान के लिए एक व्यक्तिगत डेमो शेड्यूल करें।"
        primary={{ href: '/demo', en: 'Book a Demo', hi: 'डेमो बुक करें' }}
      />
    </MarketingShell>
  );
}
