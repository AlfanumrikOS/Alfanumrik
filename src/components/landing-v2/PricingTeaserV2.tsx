'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useWelcomeV2 } from './WelcomeV2Context';
import s from './welcome-v2.module.css';

interface Plan {
  lblEn: string;
  lblHi: string;
  titleEn: string;
  titleHi: string;
  subEn: string;
  subHi: string;
  price: React.ReactNode;
  features: { en: string; hi: string }[];
  ctaEn: string;
  ctaHi: string;
  href: string;
  featured?: boolean;
  tagEn?: string;
  tagHi?: string;
  ctaClass: string; // s.btnGhost | s.btnPrimary
}

const PLANS: Plan[] = [
  {
    lblEn: 'Plan i · Explorer',
    lblHi: 'योजना i · एक्सप्लोरर',
    titleEn: 'Free, forever.',
    titleHi: 'हमेशा के लिए मुफ्त।',
    subEn: 'For first families dipping a toe in.',
    subHi: 'पहली बार जुड़ने वाले परिवारों के लिए।',
    price: <>₹0<small>/mo</small></>,
    features: [
      { en: '3 Foxy sessions a day', hi: 'प्रतिदिन 3 फ़ॉक्सी सत्र' },
      { en: 'One subject of your choice', hi: 'अपनी पसंद का एक विषय' },
      { en: 'Weekly parent letter', hi: 'साप्ताहिक अभिभावक पत्र' },
      { en: 'Mastery x-ray (read-only)', hi: 'महारत एक्स-रे (सिर्फ़ देखने योग्य)' },
    ],
    ctaEn: 'Start free',
    ctaHi: 'मुफ्त शुरू करें',
    href: '/login',
    ctaClass: 'btnGhost',
  },
  {
    lblEn: 'Plan ii · Pro',
    lblHi: 'योजना ii · प्रो',
    titleEn: 'The full workbook.',
    titleHi: 'पूरी कार्यपुस्तिका।',
    subEn: 'For the family that means it.',
    subHi: 'गंभीर परिवारों के लिए।',
    price: <>₹699<small>/mo</small></>,
    features: [
      { en: 'Unlimited Foxy + NCERT solver', hi: 'असीमित फ़ॉक्सी + NCERT solver' },
      { en: 'All seven subjects, grades 6—12', hi: 'सभी सात विषय, कक्षा 6—12' },
      { en: 'Daily plan + spaced revision', hi: 'दैनिक योजना + दोहराव' },
      { en: 'Parent + teacher dashboard', hi: 'अभिभावक + शिक्षक डैशबोर्ड' },
      { en: 'Offline mode for the metro ride', hi: 'ऑफ़लाइन मोड' },
    ],
    ctaEn: 'Begin',
    ctaHi: 'शुरू करें',
    href: '/login',
    featured: true,
    tagEn: 'Most chosen',
    tagHi: 'सबसे लोकप्रिय',
    ctaClass: 'btnPrimary',
  },
  {
    lblEn: 'Plan iii · Family',
    lblHi: 'योजना iii · परिवार',
    titleEn: 'Two children, one bill.',
    titleHi: 'दो बच्चे, एक बिल।',
    subEn: 'Up to two siblings on one plan.',
    subHi: 'एक योजना पर दो भाई-बहन तक।',
    price: <>₹999<small>/mo</small></>,
    features: [
      { en: 'Everything in Pro · ×2', hi: 'प्रो की सब चीज़ें · ×2' },
      { en: 'Joint parent dashboard', hi: 'संयुक्त अभिभावक डैशबोर्ड' },
      { en: 'Sibling-aware spacing', hi: 'भाई-बहन के अनुसार दोहराव' },
      { en: 'Annual save · ₹2,000', hi: 'वार्षिक बचत · ₹2,000' },
    ],
    ctaEn: 'Choose Family',
    ctaHi: 'परिवार चुनें',
    href: '/pricing',
    ctaClass: 'btnGhost',
  },
];

export default function PricingTeaserV2() {
  const { isHi, t } = useWelcomeV2();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(1); // featured Pro plan as default

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const rect = track.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        let best = 0;
        let dmin = Infinity;
        for (let i = 0; i < track.children.length; i++) {
          const c = track.children[i] as HTMLElement;
          const r = c.getBoundingClientRect();
          const d = Math.abs((r.left + r.width / 2) - mid);
          if (d < dmin) {
            dmin = d;
            best = i;
          }
        }
        setActiveIdx(best);
        ticking = false;
      });
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      track.removeEventListener('scroll', onScroll);
    };
  }, []);

  const goTo = (i: number) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.children[i] as HTMLElement | undefined;
    card?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  return (
    <section className={s.pricing} id="pricing" aria-labelledby="pricing-title">
      <div className={s.wrap}>
        <div className={s.pricingHead}>
          <h2 id="pricing-title">
            {t('Three ', 'तीन ')}
            <em>{t('plans', 'योजनाएँ')}</em>
            {t(', no asterisks.', ', कोई शर्त नहीं।')}
          </h2>
          <div className="meta">
            {t('Section v · pricing', 'खंड v · मूल्य')}<br />
            {t('billed monthly · INR · cancel anytime', 'मासिक · INR · कभी भी रद्द करें')}
          </div>
        </div>

        <div className={s.pricingTrack} ref={trackRef} role="list">
          {PLANS.map((plan, i) => (
            <article
              key={i}
              className={`${s.plan} ${plan.featured ? s.planFeatured : ''}`}
              aria-labelledby={`plan-${i}-title`}
              role="listitem"
            >
              {plan.featured && plan.tagEn && (
                <span className="tag">{t(plan.tagEn, plan.tagHi || plan.tagEn)}</span>
              )}
              <div className="planLbl">{t(plan.lblEn, plan.lblHi)}</div>
              <h3 id={`plan-${i}-title`}>{t(plan.titleEn, plan.titleHi)}</h3>
              <div className="sub">{t(plan.subEn, plan.subHi)}</div>
              <div className="price">{plan.price}</div>
              <ul className="features">
                {plan.features.map((f, fi) => (
                  <li key={fi}>{t(f.en, f.hi)}</li>
                ))}
              </ul>
              <div className="cta">
                <Link
                  href={plan.href}
                  className={`${s.btn} ${plan.ctaClass === 'btnPrimary' ? s.btnPrimary : s.btnGhost} ${plan.ctaClass === 'btnPrimary' ? s.btnArrow : ''}`}
                >
                  {t(plan.ctaEn, plan.ctaHi)}
                </Link>
              </div>
            </article>
          ))}
        </div>

        <div className={s.pricingDots} role="tablist" aria-label={t('Choose plan', 'योजना चुनें')}>
          {PLANS.map((_, i) => (
            <button
              key={i}
              type="button"
              className={i === activeIdx ? 'active' : undefined}
              onClick={() => goTo(i)}
              aria-label={`${t('Show plan', 'योजना दिखाएँ')} ${i + 1}`}
            >
              <span className="dot" aria-hidden="true"></span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
