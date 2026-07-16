'use client';

import { Fragment } from 'react';
import { useWelcomeV2 } from '../WelcomeV2Context';
import { track } from '@alfanumrik/lib/posthog/client';
import { V3_ACTIVE_ROLE } from './NavV3';
import s from './welcome-v3.module.css';

/**
 * /pricing V3 FAQ — Tailark faqs-component (variant Three) rendering the
 * FOUR production pricing FAQs lifted VERBATIM (EN + HI) from the legacy
 * apps/host/src/app/pricing/page.tsx.
 *
 * REG-65-adjacent: the annual-billing answer quotes "₹699" (and ₹5,599 /
 * ₹467) verbatim — these literals are part of the pinned pricing copy
 * contract and MUST stay in lock-step with plans.ts PRICING. None of the
 * answers quotes the retired ₹1,499 Unlimited price (verified against
 * PRICING.unlimited.monthly = ₹1,099).
 */

const FAQS = [
  {
    qEn: 'Can I try Alfanumrik for free before upgrading?',
    qHi: 'क्या मैं अपग्रेड करने से पहले Alfanumrik मुफ़्त में आज़मा सकता हूँ?',
    aEn: 'Yes! The Explorer plan is completely free with 5 Foxy chats and 5 quizzes per day across 2 subjects. No credit card required. Upgrade anytime when you need more.',
    aHi: 'हाँ! Explorer प्लान 2 विषयों में प्रतिदिन 5 Foxy चैट और 5 क्विज़ के साथ पूरी तरह मुफ़्त है। क्रेडिट कार्ड की ज़रूरत नहीं। जब ज़रूरत हो तब अपग्रेड करें।',
  },
  {
    qEn: 'How does the annual billing work?',
    qHi: 'वार्षिक बिलिंग कैसे काम करती है?',
    aEn: 'When you choose annual billing, you pay for the full year upfront and save 33% compared to monthly billing. For example, the Pro plan is ₹699/month or ₹5,599/year (equivalent to ₹467/month).',
    aHi: 'जब आप वार्षिक बिलिंग चुनते हैं, तो आप पूरे साल का अग्रिम भुगतान करते हैं और मासिक बिलिंग की तुलना में 33% बचाते हैं। उदाहरण के लिए, Pro प्लान ₹699/माह या ₹5,599/वर्ष (₹467/माह के बराबर) है।',
  },
  {
    qEn: 'What is your refund policy?',
    qHi: 'आपकी रिफंड नीति क्या है?',
    aEn: 'We offer a 7-day money-back guarantee on all paid plans. If you\'re not satisfied within the first 7 days of your subscription, contact us for a full refund. No questions asked.',
    aHi: 'हम सभी सशुल्क प्लान पर 7 दिन की मनी-बैक गारंटी देते हैं। अगर आप अपनी सब्सक्रिप्शन के पहले 7 दिनों में संतुष्ट नहीं हैं, तो पूर्ण रिफंड के लिए हमसे संपर्क करें। कोई सवाल नहीं पूछे जाएँगे।',
  },
  {
    qEn: 'Can I switch plans at any time?',
    qHi: 'क्या मैं किसी भी समय प्लान बदल सकता हूँ?',
    aEn: 'Absolutely. You can upgrade or downgrade your plan at any time. When upgrading, you\'ll be charged the prorated difference. When downgrading, the remaining credit will be applied to your next billing cycle.',
    aHi: 'बिल्कुल। आप किसी भी समय अपना प्लान अपग्रेड या डाउनग्रेड कर सकते हैं। अपग्रेड करने पर, आपसे आनुपातिक अंतर लिया जाएगा। डाउनग्रेड करने पर, शेष क्रेडिट आपके अगले बिलिंग चक्र में लागू होगा।',
  },
];

export default function PricingFaqV3() {
  const { isHi, t } = useWelcomeV2();

  return (
    <section className={s.section} id="faq" aria-labelledby="pricing-faq-title">
      <div className={s.wrap}>
        <div className={s.sectionHead}>
          <span className={s.eyebrow}>{t('FAQ', 'सामान्य प्रश्न')}</span>
          <h2 id="pricing-faq-title">
            {t('Frequently asked questions', 'अक्सर पूछे जाने वाले प्रश्न')}
          </h2>
        </div>
        <div className={s.faqWrap}>
          {FAQS.map((faq, i) => (
            <Fragment key={i}>
              <details
                className={s.faqItem}
                onToggle={(e) => {
                  // Fire only on open, not on close (same rule as FAQV3).
                  if ((e.target as HTMLDetailsElement).open) {
                    track('landing_faq_opened', {
                      faq_index: i + 1,
                      question_en: faq.qEn,
                      active_role: V3_ACTIVE_ROLE,
                    });
                  }
                }}
              >
                <summary>
                  <span lang={isHi ? 'hi' : undefined}>{isHi ? faq.qHi : faq.qEn}</span>
                  <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <div className={s.faqBody}>
                  <p lang={isHi ? 'hi' : undefined}>{isHi ? faq.aHi : faq.aEn}</p>
                </div>
              </details>
              {i < FAQS.length - 1 ? <hr className={s.faqDivider} /> : null}
            </Fragment>
          ))}
          <p className={s.faqFoot}>
            {t('Can’t find what you’re looking for?', 'जो ढूँढ रहे हैं वह नहीं मिला?')}{' '}
            <a
              href="/contact"
              onClick={() =>
                track('landing_nav_click', {
                  source: 'faq_foot',
                  destination: '/contact',
                  label: t('Talk to us', 'हमसे बात करें'),
                  active_role: V3_ACTIVE_ROLE,
                })
              }
            >
              {t('Talk to us', 'हमसे बात करें')}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
