import { PRICING } from '@alfanumrik/lib/plans';

/**
 * Site-wide JSON-LD structured data (Organization + WebApplication).
 *
 * Updated 2026-07-16 per CEO-approved SEO handoff:
 *  - Organization: real logo (icon-512.png — favicon.svg was rejected by
 *    Google's logo guidelines), Bengaluru address, DPIIT/ISO credentials.
 *  - WebApplication: AggregateOffer with the four real plans priced from
 *    PRICING in @alfanumrik/lib/plans (single source of truth — NO literal
 *    prices in this file), operatingSystem includes Android, @id declared so
 *    Google merges this entity with the review-carrying WebApplication block
 *    emitted by TestimonialsV3 (same @id contract, see landing/v3).
 */
export default function JsonLd() {
  const organizationData = {
    '@context': 'https://schema.org',
    '@type': ['Organization', 'EducationalOrganization'],
    '@id': 'https://alfanumrik.com/#organization',
    name: 'Cusiosense Learning India Private Limited',
    alternateName: 'Alfanumrik',
    url: 'https://alfanumrik.com',
    logo: 'https://alfanumrik.com/icon-512.png',
    description:
      'DPIIT-recognized Indian EdTech company building adaptive learning systems for CBSE students in Grades 6-12.',
    foundingDate: '2025',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Bengaluru',
      addressCountry: 'IN',
    },
    // TODO(ceo): sameAs pending real social profile URLs — intentionally
    // omitted until confirmed handles exist. Never ship placeholder URLs.
    award: 'ISO/IEC 27001:2022 Certified — Information Security Management System',
    hasCredential: [
      {
        '@type': 'EducationalOccupationalCredential',
        name: 'ISO/IEC 27001:2022 Information Security Management System',
        credentialCategory: 'certification',
      },
    ],
  };

  const webAppData = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    // Same @id as the review-carrying WebApplication block in TestimonialsV3
    // so Google merges the two into one entity.
    '@id': 'https://alfanumrik.com/#webapp',
    name: 'Alfanumrik',
    alternateName: 'Alfanumrik Learning OS',
    url: 'https://alfanumrik.com',
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web, Android',
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'INR',
      lowPrice: '0',
      highPrice: String(PRICING.unlimited.monthly),
      offerCount: '4',
      offers: [
        { '@type': 'Offer', name: 'Explorer', price: '0', priceCurrency: 'INR' },
        { '@type': 'Offer', name: 'Starter', price: String(PRICING.starter.monthly), priceCurrency: 'INR' },
        { '@type': 'Offer', name: 'Pro', price: String(PRICING.pro.monthly), priceCurrency: 'INR' },
        { '@type': 'Offer', name: 'Unlimited', price: String(PRICING.unlimited.monthly), priceCurrency: 'INR' },
      ],
    },
    provider: {
      '@type': 'Organization',
      '@id': 'https://alfanumrik.com/#organization',
    },
    description:
      'AI-powered adaptive learning platform for CBSE students. Foxy teaches in Hindi and English with Bayesian mastery tracking, spaced repetition, and NCERT-grounded practice. Grades 6-12.',
    educationalLevel: ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
    inLanguage: ['en', 'hi'],
    isAccessibleForFree: true,
    audience: {
      '@type': 'EducationalAudience',
      educationalRole: 'student',
      audienceType: 'CBSE Students, Grades 6-12',
    },
    featureList: [
      'Foxy',
      'Adaptive Quizzes',
      'Spaced Repetition Review',
      'Interactive Simulations',
      'Bayesian Mastery Tracking',
      'Bilingual (Hindi & English)',
      'Gamified Learning with XP & Streaks',
      'Teacher Dashboard',
      'Parent Portal',
      'ISO 27001 Certified Data Security',
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppData) }}
      />
    </>
  );
}
