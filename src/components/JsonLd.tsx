export default function JsonLd() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Alfanumrik',
    alternateName: 'Alfanumrik Learning OS',
    url: 'https://alfanumrik.com',
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'INR',
      description: 'Adaptive learning platform for CBSE students — free trial available',
      availability: 'https://schema.org/InStock',
    },
    author: {
      '@type': 'Organization',
      name: 'Cusiosense Learning India Private Limited',
      url: 'https://alfanumrik.com',
    },
    description:
      'AI-powered adaptive learning platform for CBSE students. Foxy AI Tutor teaches in Hindi and English with Bayesian mastery tracking, spaced repetition, and gamified learning. Grades 6-12.',
    educationalLevel: ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
    inLanguage: ['en', 'hi'],
    isAccessibleForFree: false,
    audience: {
      '@type': 'EducationalAudience',
      educationalRole: 'student',
      audienceType: 'CBSE Students, Grades 6-12',
    },
    featureList: [
      'AI Tutor (Foxy)',
      'Adaptive Quizzes',
      'Spaced Repetition Review',
      'Interactive Simulations',
      'Bayesian Mastery Tracking',
      'Bilingual (Hindi & English)',
      'Gamified Learning with XP & Streaks',
      'Teacher Dashboard',
      'Parent Portal',
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  );
}
