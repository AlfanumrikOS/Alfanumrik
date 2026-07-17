'use client';

import { useWelcomeV2 } from '../WelcomeV2Context';
import { useReveal } from '../useReveal';
import { track } from '@alfanumrik/lib/posthog/client';
import { ThinkingGlyph } from './MotionPrimitives';
import s from './welcome-v3.module.css';

/**
 * /pricing V3 hero — eyebrow · H1 · lede · Monthly/Yearly segmented toggle.
 * Design source of truth: design-previews/marketing-page-ultra.html (.phero).
 *
 * The toggle is the preview's exact pattern: a role="group" of two buttons
 * with aria-pressed (screen readers announce "pressed"/"not pressed"), plus
 * the green "Save ~33%" chip. Billing state is LIFTED to PricingV3 so the
 * plan cards swap prices in step.
 */

export type BillingCycle = 'monthly' | 'yearly';

export default function PricingHeroV3({
  cycle,
  onCycleChange,
}: {
  cycle: BillingCycle;
  onCycleChange: (cycle: BillingCycle) => void;
}) {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(50);

  const setCycle = (next: BillingCycle) => {
    if (next === cycle) return;
    onCycleChange(next);
    track('pricing_billing_toggle', {
      cycle: next,
      language: isHi ? 'hi' : 'en',
    });
  };

  return (
    <section className={s.phero} aria-labelledby="pricing-hero-title">
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <span className={`${s.eyebrow} ${s.revealUp}`} data-reveal>
          <ThinkingGlyph />
          {t('Pricing', 'मूल्य')}
        </span>
        <h1 id="pricing-hero-title" className={`${s.pheroH1} ${s.revealUp}`} data-reveal>
          {t(
            'Less than a single tuition class a month.',
            'महीने की एक ट्यूशन क्लास से भी कम।',
          )}
        </h1>
        <p className={`${s.pheroSub} ${s.revealUp}`} data-reveal>
          {t(
            'Start free, upgrade when you’re ready. Every plan includes Foxy, your personal AI tutor.',
            'मुफ़्त शुरू करें, जब तैयार हों तब अपग्रेड करें। हर प्लान में फ़ॉक्सी, आपका व्यक्तिगत AI ट्यूटर शामिल है।',
          )}
        </p>

        <div
          className={`${s.billingToggle} ${s.revealUp}`}
          data-reveal
          role="group"
          aria-label={t('Billing period', 'बिलिंग अवधि')}
        >
          <button
            type="button"
            aria-pressed={cycle === 'monthly'}
            onClick={() => setCycle('monthly')}
          >
            {t('Monthly', 'मासिक')}
          </button>
          <button
            type="button"
            aria-pressed={cycle === 'yearly'}
            onClick={() => setCycle('yearly')}
          >
            {t('Yearly', 'वार्षिक')}
          </button>
          <span className={s.saveChip}>{t('Save ~33%', '~33% बचाएँ')}</span>
        </div>
      </div>
    </section>
  );
}
