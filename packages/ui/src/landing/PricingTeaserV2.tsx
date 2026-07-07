'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useWelcomeV2 } from './WelcomeV2Context';
import { useReveal } from './useReveal';
import { track as trackEvent } from '@alfanumrik/lib/posthog/client';
import { PRICING } from '@alfanumrik/lib/plans';
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
    titleEn: 'A free first look.',
    titleHi: 'पहली झलक, मुफ्त।',
    subEn: 'No card. No commitment.',
    subHi: 'कोई कार्ड नहीं, कोई प्रतिबद्धता नहीं।',
    price: <>₹<em>0</em><small>/mo</small></>,
    features: [
      { en: '5 Foxy chats a day', hi: 'प्रतिदिन 5 फ़ॉक्सी चैट' },
      { en: '5 quizzes a day', hi: 'प्रतिदिन 5 क्विज़' },
      { en: '2 subjects of your choice', hi: 'अपनी पसंद के 2 विषय' },
      { en: 'Progress reports', hi: 'प्रगति रिपोर्ट' },
      { en: 'Spaced repetition', hi: 'अंतराल-पुनरावृत्ति' },
    ],
    ctaEn: 'Start free',
    ctaHi: 'मुफ्त शुरू करें',
    href: '/login',
    ctaClass: 'btnGhost',
  },
  {
    lblEn: 'Plan ii · Starter',
    lblHi: 'योजना ii · स्टार्टर',
    titleEn: 'More chats, more subjects.',
    titleHi: 'ज़्यादा चैट, ज़्यादा विषय।',
    subEn: 'For the family getting serious.',
    subHi: 'गंभीर होते परिवारों के लिए।',
    price: <>₹<em>{PRICING.starter.monthly}</em><small>/mo</small></>,
    features: [
      { en: '30 Foxy chats a day', hi: 'प्रतिदिन 30 फ़ॉक्सी चैट' },
      { en: '20 quizzes a day', hi: 'प्रतिदिन 20 क्विज़' },
      { en: '4 subjects', hi: '4 विषय' },
      { en: 'STEM Lab access', hi: 'STEM लैब पहुँच' },
      { en: 'Progress reports + spaced revision', hi: 'प्रगति रिपोर्ट + दोहराव' },
    ],
    ctaEn: 'Get started',
    ctaHi: 'शुरू करें',
    href: '/login',
    ctaClass: 'btnGhost',
  },
  {
    lblEn: 'Plan iii · Pro',
    lblHi: 'योजना iii · प्रो',
    titleEn: 'The full workbook.',
    titleHi: 'पूरी कार्यपुस्तिका।',
    subEn: 'For the family that means it.',
    subHi: 'गंभीर परिवारों के लिए।',
    price: <>₹<em>{PRICING.pro.monthly}</em><small>/mo</small></>,
    features: [
      { en: '100 Foxy chats a day', hi: 'प्रतिदिन 100 फ़ॉक्सी चैट' },
      { en: 'Unlimited quizzes', hi: 'असीमित क्विज़' },
      { en: 'All subjects, grades 6—12', hi: 'सभी विषय, कक्षा 6—12' },
      { en: 'STEM Lab + parent dashboard', hi: 'STEM लैब + अभिभावक डैशबोर्ड' },
      { en: 'Daily plan + spaced revision', hi: 'दैनिक योजना + दोहराव' },
    ],
    ctaEn: 'Begin',
    ctaHi: 'शुरू करें',
    href: '/login',
    featured: true,
    tagEn: 'Most popular',
    tagHi: 'सबसे लोकप्रिय',
    ctaClass: 'btnPrimary',
  },
  {
    lblEn: 'Plan iv · Unlimited',
    lblHi: 'योजना iv · अनलिमिटेड',
    titleEn: 'No limits.',
    titleHi: 'कोई सीमा नहीं।',
    subEn: 'Unlimited chats, unlimited quizzes.',
    subHi: 'असीमित चैट, असीमित क्विज़।',
    price: <>₹<em>{PRICING.unlimited.monthly}</em><small>/mo</small></>,
    features: [
      { en: 'Unlimited Foxy chats', hi: 'असीमित फ़ॉक्सी चैट' },
      { en: 'Unlimited quizzes', hi: 'असीमित क्विज़' },
      { en: 'All subjects, grades 6—12', hi: 'सभी विषय, कक्षा 6—12' },
      { en: 'STEM Lab + priority support', hi: 'STEM लैब + प्राथमिकता सहायता' },
      { en: 'Everything in Pro', hi: 'प्रो की सब सुविधाएँ' },
    ],
    ctaEn: 'See all plans',
    ctaHi: 'सभी प्लान देखें',
    href: '/pricing',
    ctaClass: 'btnGhost',
  },
];

export default function PricingTeaserV2() {
  const { isHi, t, role } = useWelcomeV2();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const revealRef = useReveal();
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
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={`${s.pricingHead} ${s.revealUp}`} data-reveal>
          <h2 id="pricing-title">
            {t('Four ', 'चार ')}
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
              data-reveal
              className={`${s.plan} ${plan.featured ? s.planFeatured : ''} ${s.revealUp}`}
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
                  onClick={() =>
                    trackEvent('landing_cta_click', {
                      location: 'pricing_teaser',
                      destination: plan.href,
                      active_role: role,
                      language: isHi ? 'hi' : 'en',
                    })
                  }
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
