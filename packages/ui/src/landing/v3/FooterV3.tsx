'use client';

import Link from 'next/link';
import { useWelcomeV2 } from '../WelcomeV2Context';
import FoxyMascot from './FoxyMascot';
import s from './welcome-v3.module.css';

/**
 * V3 footer — Tailark style: brand column + 4 link columns + trust line.
 * Preview hrefs pointed at "#"; production maps each label to the real route
 * (reusing FooterV2's established destinations where copy overlaps).
 */

interface Col {
  headEn: string;
  headHi: string;
  links: { en: string; hi: string; href: string }[];
}

const COLS: Col[] = [
  {
    headEn: 'Product',
    headHi: 'उत्पाद',
    links: [
      { en: 'Foxy AI tutor', hi: 'फ़ॉक्सी AI शिक्षक', href: '/foxy' },
      { en: 'Practice & quizzes', hi: 'अभ्यास और क्विज़', href: '/product' },
      { en: 'Mastery map', hi: 'महारत का नक़्शा', href: '/progress' },
      { en: 'Pricing', hi: 'मूल्य', href: '/pricing' },
    ],
  },
  {
    headEn: 'For families',
    headHi: 'परिवारों के लिए',
    links: [
      { en: 'Sunday parent letter', hi: 'रविवार का अभिभावक पत्र', href: '/for-parents' },
      { en: 'Progress reports', hi: 'प्रगति रिपोर्ट', href: '/parent' },
      { en: 'For schools', hi: 'विद्यालयों के लिए', href: '/for-schools' },
    ],
  },
  {
    headEn: 'Company',
    headHi: 'कम्पनी',
    links: [
      { en: 'About', hi: 'हमारे बारे में', href: '/about' },
      { en: 'Contact', hi: 'सम्पर्क', href: '/contact' },
      { en: 'Careers', hi: 'कैरियर', href: '/careers' },
    ],
  },
  {
    headEn: 'Legal',
    headHi: 'क़ानूनी',
    links: [
      { en: 'Privacy policy', hi: 'गोपनीयता नीति', href: '/privacy' },
      { en: 'Terms of service', hi: 'सेवा की शर्तें', href: '/terms' },
      { en: 'Refund policy', hi: 'धन-वापसी नीति', href: '/refunds' },
    ],
  },
];

export default function FooterV3() {
  const { isHi, t } = useWelcomeV2();

  return (
    <footer className={s.footer} aria-labelledby="footer-v3-title">
      <h2 id="footer-v3-title" className={s.srOnly}>
        {t('Site footer', 'साइट फ़ुटर')}
      </h2>
      <div className={s.wrap}>
        <div className={s.footerGrid}>
          <div className={s.footerBrand}>
            <Link href="/" className={s.navLogo} aria-label="Alfanumrik home">
              <FoxyMascot size={26} />
              <strong>Alfanumrik</strong>
            </Link>
            <p>
              {t(
                'The AI Learning OS for CBSE families — built on NCERT, measured in mastery.',
                'CBSE परिवारों के लिए AI लर्निंग OS — NCERT पर बना, महारत में मापा गया।',
              )}
            </p>
          </div>
          {COLS.map((col) => (
            <div key={col.headEn}>
              <h3>{t(col.headEn, col.headHi)}</h3>
              <ul>
                {col.links.map((link) => (
                  <li key={link.href + link.en}>
                    <Link href={link.href}>{isHi ? link.hi : link.en}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className={s.footerTrust}>
          <span>
            {t(
              'DPDPA compliant · ISO 27001 · Hosted in India · Ad-free',
              'DPDPA-अनुरूप · ISO 27001 · भारत में होस्ट · विज्ञापन-मुक्त',
            )}
          </span>
          <span>© 2026 Cusiosense Learning India Pvt. Ltd.</span>
        </div>
      </div>
    </footer>
  );
}
